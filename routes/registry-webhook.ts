import { Hono } from 'hono';
import type { Env } from '../types';

/**
 * Registry webhook payload structure
 */
export interface RegistryWebhookPayload {
  id: number;
  kind: string;
  subject: {
    origin: string;
    type: string;
    ref: string;
  };
  issuer_did: string;
  status: 'active' | 'revoked';
  issued_at: string;
}

/**
 * Parsed signature header
 */
interface ParsedSignature {
  timestamp: number;
  v1: string;
  nonce: string;
}

/**
 * Registry webhook route handler
 * Validates HMAC signature and enqueues facts to facts-ingest queue
 */
const registryWebhook = new Hono<{ Variables: { env: Env } }>();

/**
 * Parse X-Signature header
 * Format: t=<timestamp>, v1=<hex-hmac>, nonce=<uuid>
 */
function parseSignatureHeader(header: string): ParsedSignature | null {
  const parts = header.split(',').map(p => p.trim());
  let timestamp: number | null = null;
  let v1: string | null = null;
  let nonce: string | null = null;

  for (const part of parts) {
    if (part.startsWith('t=')) {
      timestamp = parseInt(part.substring(2), 10);
    } else if (part.startsWith('v1=')) {
      v1 = part.substring(3);
    } else if (part.startsWith('nonce=')) {
      nonce = part.substring(6);
    }
  }

  if (timestamp === null || v1 === null || nonce === null) {
    return null;
  }

  return { timestamp, v1, nonce };
}

/**
 * Verify HMAC signature using Web Crypto API
 * Message format: t=<timestamp>\nm=<HTTP_METHOD>\np=<request_path_with_query>\nb=<raw_body_bytes>
 */
async function verifyHMAC(
  secret: string,
  timestamp: number,
  method: string,
  path: string,
  rawBody: string,
  expectedSignature: string
): Promise<boolean> {
  const message = `t=${timestamp}\nm=${method}\np=${path}\nb=${rawBody}`;

  // Use Web Crypto API for HMAC-SHA256
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  // Convert signature to hex string
  const hashArray = Array.from(new Uint8Array(signature));
  const computedSignature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return computedSignature === expectedSignature;
}

/**
 * Check if nonce has been used (replay protection)
 */
async function isNonceUsed(env: Env, nonce: string): Promise<boolean> {
  try {
    // Use a KV namespace for nonces - we'll use playlist storage as a temporary solution
    // In production, you might want a dedicated KV namespace
    const nonceKey = `nonce:${nonce}`;
    const existing = await env.storageProvider.getPlaylistStorage().get(nonceKey);
    return existing !== null;
  } catch (error) {
    console.error('Error checking nonce:', error);
    // If we can't check, fail safe and reject
    return true;
  }
}

/**
 * Store nonce to prevent replay attacks
 * Nonces expire after 24 hours (we'll use TTL if supported, or manual cleanup)
 */
async function storeNonce(env: Env, nonce: string, timestamp: number): Promise<void> {
  try {
    const nonceKey = `nonce:${nonce}`;
    // Store with timestamp as value for potential cleanup
    await env.storageProvider.getPlaylistStorage().put(nonceKey, timestamp.toString());
  } catch (error) {
    console.error('Error storing nonce:', error);
    // Don't throw - nonce storage failure shouldn't block the webhook
  }
}

/**
 * POST /registry-webhook
 * Receives webhooks from Registry, validates HMAC, and enqueues to facts-ingest queue
 */
registryWebhook.post('/registry-webhook', async c => {
  try {
    const env = c.var.env;

    // Get webhook secret from environment
    const webhookSecret = env.REGISTRY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('Missing REGISTRY_WEBHOOK_SECRET in environment');
      return c.json(
        {
          error: 'configuration_error',
          message: 'Webhook secret not configured',
        },
        500
      );
    }

    // Get signature header
    const signatureHeader = c.req.header('X-Signature');
    if (!signatureHeader) {
      return c.json(
        {
          error: 'missing_signature',
          message: 'X-Signature header is required',
        },
        401
      );
    }

    // Parse signature header
    const signature = parseSignatureHeader(signatureHeader);
    if (!signature) {
      return c.json(
        {
          error: 'invalid_signature_format',
          message: 'X-Signature header format is invalid',
        },
        401
      );
    }

    // Check timestamp (prevent replay attacks - allow 5 minute window)
    const now = Math.floor(Date.now() / 1000);
    const timeDiff = Math.abs(now - signature.timestamp);
    if (timeDiff > 300) {
      // 5 minutes
      return c.json(
        {
          error: 'timestamp_expired',
          message: 'Request timestamp is too old or too far in the future',
        },
        401
      );
    }

    // Check nonce (replay protection)
    if (await isNonceUsed(env, signature.nonce)) {
      return c.json(
        {
          error: 'nonce_reused',
          message: 'Nonce has already been used',
        },
        401
      );
    }

    // Get raw body for HMAC verification
    const rawBody = await c.req.text();
    if (!rawBody) {
      return c.json(
        {
          error: 'empty_body',
          message: 'Request body is required',
        },
        400
      );
    }

    // Get request path with query string (url.search already includes '?')
    const url = new URL(c.req.url);
    const path = url.pathname + url.search;

    // Verify HMAC signature
    const isValid = await verifyHMAC(
      webhookSecret,
      signature.timestamp,
      'POST',
      path,
      rawBody,
      signature.v1
    );

    if (!isValid) {
      return c.json(
        {
          error: 'invalid_signature',
          message: 'HMAC signature verification failed',
        },
        401
      );
    }

    // Store nonce to prevent replay
    await storeNonce(env, signature.nonce, signature.timestamp);

    // Parse payload
    let payload: RegistryWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      console.error('Error parsing payload:', error);
      return c.json(
        {
          error: 'invalid_json',
          message: 'Request body is not valid JSON',
        },
        400
      );
    }

    // Validate payload structure
    if (!payload.id || !payload.kind || !payload.subject || !payload.issuer_did || !payload.status) {
      return c.json(
        {
          error: 'invalid_payload',
          message: 'Webhook payload is missing required fields',
        },
        400
      );
    }

    // Get facts-ingest queue
    const factsQueue = env.queueProvider.getFactsQueue();
    if (!factsQueue) {
      console.error('Facts ingest queue not available');
      return c.json(
        {
          error: 'queue_unavailable',
          message: 'Facts ingest queue is not configured',
        },
        500
      );
    }

    // Enqueue to facts-ingest queue
    try {
      await factsQueue.send({
        id: `fact:${payload.id}`,
        timestamp: new Date().toISOString(),
        payload,
      });
      console.log(`Enqueued fact ${payload.id} (${payload.kind}) to facts-ingest queue`);
    } catch (error) {
      console.error('Error enqueueing fact:', error);
      return c.json(
        {
          error: 'enqueue_failed',
          message: 'Failed to enqueue fact to processing queue',
        },
        500
      );
    }

    // Return 204 No Content on success
    return c.body(null, 204);
  } catch (error) {
    console.error('Error processing registry webhook:', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'An unexpected error occurred while processing the webhook',
      },
      500
    );
  }
});

export { registryWebhook };

