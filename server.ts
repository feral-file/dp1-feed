import { serve } from '@hono/node-server';
import { type SelfHostedBindings, initializeSelfHostedEnv } from './env/selfhosted';
import { selfHostedEnvMiddleware } from './middleware/env-selfhosted';
import { createApp } from './app';

/**
 * Node.js adapter for the DP-1 Feed Operator API Server
 *
 * This adapter runs the same Hono application that's used for Cloudflare Workers
 * but in a Node.js environment with self-hosted infrastructure (etcd + NATS)
 */

// Create Node.js app with self-hosted environment middleware
const app = createApp<SelfHostedBindings>(selfHostedEnvMiddleware);

/**
 * Initialize the Node.js server with self-hosted environment
 */
async function startServer() {
  const port = parseInt(process.env.PORT || '8787');
  const host = process.env.HOST || '0.0.0.0';

  console.log('🚀 Starting DP-1 Feed Operator API Server (Node.js)...');
  console.log(`📡 Server will listen on ${host}:${port}`);

  // Build environment bindings from process.env
  const bindings: SelfHostedBindings = {
    API_SECRET: process.env.API_SECRET || '',
    ED25519_PRIVATE_KEY: process.env.ED25519_PRIVATE_KEY || '',

    // etcd configuration
    ETCD_ENDPOINT: process.env.ETCD_ENDPOINT || 'http://localhost:2379',
    ETCD_USERNAME: process.env.ETCD_USERNAME,
    ETCD_PASSWORD: process.env.ETCD_PASSWORD,
    ETCD_PREFIX: process.env.ETCD_PREFIX,

    // NATS JetStream configuration
    NATS_ENDPOINT: process.env.NATS_ENDPOINT || 'nats://localhost:4222',
    NATS_USERNAME: process.env.NATS_USERNAME,
    NATS_PASSWORD: process.env.NATS_PASSWORD,
    NATS_TOKEN: process.env.NATS_TOKEN,
    NATS_STREAM_NAME: process.env.NATS_STREAM_NAME || 'DP1_WRITE_OPERATIONS',
    NATS_SUBJECT_NAME: process.env.NATS_SUBJECT_NAME || 'dp1.write.operations',

    // NATS JetStream configuration for facts (optional)
    NATS_FACTS_STREAM_NAME: process.env.NATS_FACTS_STREAM_NAME,
    NATS_FACTS_SUBJECT_NAME: process.env.NATS_FACTS_SUBJECT_NAME,

    // Registry webhook secret for HMAC verification
    REGISTRY_WEBHOOK_SECRET: process.env.REGISTRY_WEBHOOK_SECRET,

    // Optional environment variables
    ENVIRONMENT: process.env.ENVIRONMENT || 'self-hosted',
    SELF_HOSTED_DOMAINS: process.env.SELF_HOSTED_DOMAINS,
  };

  // Validate required environment variables
  if (!bindings.API_SECRET) {
    console.error('❌ Missing required environment variable: API_SECRET');
    process.exit(1);
  }

  if (!bindings.ED25519_PRIVATE_KEY) {
    console.error('❌ Missing required environment variable: ED25519_PRIVATE_KEY');
    process.exit(1);
  }

  try {
    // Initialize the environment once to validate connections
    console.log('🔧 Initializing environment and connections...');
    await initializeSelfHostedEnv(bindings);

    console.log('✅ Environment initialized successfully');
    console.log(`   - Storage: etcd at ${bindings.ETCD_ENDPOINT}`);
    console.log(`   - Queue: NATS JetStream at ${bindings.NATS_ENDPOINT}`);
    console.log(`   - Stream: ${bindings.NATS_STREAM_NAME}`);
    console.log(`   - Subject: ${bindings.NATS_SUBJECT_NAME}`);

    // Create server with environment context
    const nodeApp = {
      fetch: (request: Request) => {
        // Add bindings to the request context
        return app.fetch(request, bindings);
      },
    };

    // Start the server
    serve({
      fetch: nodeApp.fetch,
      port,
      hostname: host,
    });

    console.log(`✅ DP-1 Feed Operator API Server running on http://${host}:${port}`);
    console.log(`📋 API documentation: http://${host}:${port}/api/v1`);
    console.log(`🏥 Health check: http://${host}:${port}/api/v1/health`);
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
function setupGracefulShutdown() {
  const gracefulShutdown = (signal: string) => {
    console.log(`\n📴 Received ${signal}, shutting down gracefully...`);
    // Give the server a moment to finish ongoing requests
    globalThis.setTimeout(() => {
      console.log('✅ Server shut down complete');
      process.exit(0);
    }, 1000);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupGracefulShutdown();
  startServer().catch(error => {
    console.error('❌ Fatal error starting server:', error);
    process.exit(1);
  });
}

// Export the app for testing or external use
export { app };
