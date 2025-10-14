import { Hono, Context } from 'hono';
import { z } from 'zod';
import type { Env, ChannelInput, ChannelUpdate, Channel } from '../types';
import type { CreateChannelMessage, UpdateChannelMessage } from '../queue/interfaces';
import {
  ChannelInputSchema,
  ChannelUpdateSchema,
  createChannelFromInput,
  validateNoProtectedFields,
} from '../types';
import { listAllChannels, getChannelByIdOrSlug } from '../storage';
import { queueWriteOperation, generateMessageId } from '../queue/processor';
import type { EnvironmentBindings } from '../env/types';
import { signChannel, getServerKeyPair } from '../crypto';
import { shouldUseAsyncPersistence } from '../rfc7240';
import { saveChannel } from '../storage';

// Create channels router
const channels = new Hono<{ Bindings: EnvironmentBindings; Variables: { env: Env } }>();

/**
 * Validate identifier format (UUID or slug)
 */
function validateIdentifier(identifier: string): {
  isValid: boolean;
  isUuid: boolean;
  isSlug: boolean;
} {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
  const isSlug = /^[a-zA-Z0-9-]+$/.test(identifier);

  return {
    isValid: isUuid || isSlug,
    isUuid,
    isSlug,
  };
}

/**
 * Validate request body against Zod schema
 */
async function validateChannelBody(
  c: Context
): Promise<ChannelInput | { error: string; message: string; status: number }> {
  try {
    const body = await c.req.json();
    const result = ChannelInputSchema.parse(body);
    return result;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      return {
        error: 'validation_error',
        message: `Invalid channel data: ${errorMessage}`,
        status: 400,
      };
    } else {
      return {
        error: 'invalid_json',
        message: 'Request body must be valid JSON',
        status: 400,
      };
    }
  }
}

/**
 * Validate request body for channel updates (PATCH - excludes protected fields)
 */
async function validateChannelUpdateBody(
  c: Context
): Promise<ChannelUpdate | { error: string; message: string; status: number }> {
  try {
    const body = await c.req.json();

    // Check for protected fields first
    const protectedValidation = validateNoProtectedFields(body, 'channel');
    if (!protectedValidation.isValid) {
      return {
        error: 'protected_fields',
        message: `Cannot update protected fields: ${protectedValidation.protectedFields?.join(', ')}. Protected fields are read-only.`,
        status: 400,
      };
    }

    const result = ChannelUpdateSchema.parse(body);
    return result;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      return {
        error: 'validation_error',
        message: `Invalid channel update data: ${errorMessage}`,
        status: 400,
      };
    } else {
      return {
        error: 'invalid_json',
        message: 'Request body must be valid JSON',
        status: 400,
      };
    }
  }
}

/**
 * GET /channels - List all channels with pagination
 * Query params:
 * - limit: number of items per page (max 100)
 * - cursor: pagination cursor from previous response
 * - sort: asc | desc (by created time)
 */
channels.get('/', async c => {
  try {
    // Parse query parameters
    const limit = parseInt(c.req.query('limit') || '100');
    const cursor = c.req.query('cursor') || undefined;
    const sortParam = (c.req.query('sort') || '').toLowerCase();
    const sort: 'asc' | 'desc' = sortParam === 'desc' ? 'desc' : 'asc'; // Default to 'asc' when no sort or invalid sort

    // Validate limit
    if (limit < 1 || limit > 100) {
      return c.json(
        {
          error: 'invalid_limit',
          message: 'Limit must be between 1 and 100',
        },
        400
      );
    }

    const result = await listAllChannels(c.var.env, { limit, cursor, sort });
    return c.json(result);
  } catch (error) {
    console.error('Error retrieving channels:', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to retrieve channels',
      },
      500
    );
  }
});

/**
 * GET /channels/:id - Get specific channel by UUID or slug
 */
channels.get('/:id', async c => {
  try {
    const channelId = c.req.param('id');

    // Validate ID format (UUID or slug)
    const validation = validateIdentifier(channelId);

    if (!channelId || !validation.isValid) {
      return c.json(
        {
          error: 'invalid_id',
          message: 'Channel ID must be a valid UUID or slug (alphanumeric with hyphens)',
        },
        400
      );
    }

    const channel = await getChannelByIdOrSlug(channelId, c.var.env);

    if (!channel) {
      return c.json(
        {
          error: 'not_found',
          message: 'Channel not found',
        },
        404
      );
    }

    return c.json(channel);
  } catch (error) {
    console.error('Error retrieving channel:', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to retrieve channel',
      },
      500
    );
  }
});

/**
 * POST /channels - Create new channel
 * Supports RFC 7240: synchronous by default, async if "Prefer: respond-async" header present
 */
channels.post('/', async c => {
  try {
    const validatedData = await validateChannelBody(c);

    // Check if validation returned an error
    if ('error' in validatedData) {
      return c.json(
        {
          error: validatedData.error,
          message: validatedData.message,
        },
        validatedData.status as 400
      );
    }

    // Create channel with server-generated ID, timestamp, and slug
    const channel = createChannelFromInput(validatedData);

    // Sign the channel using ed25519 as per DP-1 specification
    const keyPair = await getServerKeyPair(c.var.env);

    // Sign the channel
    channel.signature = await signChannel(channel, keyPair.privateKey);

    // Check if client prefers async processing (RFC 7240)
    const useAsync = shouldUseAsyncPersistence(c);

    if (useAsync) {
      // Async processing: queue the operation and return 202 Accepted
      const queueMessage: CreateChannelMessage = {
        id: generateMessageId('create_channel', channel.id),
        timestamp: new Date().toISOString(),
        operation: 'create_channel',
        data: {
          channel: channel,
        },
      };

      try {
        await queueWriteOperation(queueMessage, c.var.env);
        return c.json(channel, 202);
      } catch (queueError) {
        console.error('Failed to queue channel creation:', queueError);
        return c.json(
          {
            error: 'queue_error',
            message: 'Failed to queue channel for processing',
          },
          500
        );
      }
    } else {
      // Sync processing: persist immediately and return 201 Created
      try {
        await saveChannel(channel, c.var.env, false);
        return c.json(channel, 201);
      } catch (storageError) {
        console.error('Failed to save channel synchronously:', storageError);
        return c.json(
          {
            error: 'storage_error',
            message: 'Failed to save channel',
          },
          500
        );
      }
    }
  } catch (error) {
    console.error('Error creating channel:', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to create channel',
      },
      500
    );
  }
});

/**
 * PUT /channels/:id - Replace existing channel (requires full resource fields)
 */
channels.put('/:id', async c => {
  try {
    const channelId = c.req.param('id');

    // Validate ID format (UUID or slug)
    const validation = validateIdentifier(channelId);

    if (!channelId || !validation.isValid) {
      return c.json(
        {
          error: 'invalid_id',
          message: 'Channel ID must be a valid UUID or slug (alphanumeric with hyphens)',
        },
        400
      );
    }

    // Validate full body using creation schema
    const validatedData = await validateChannelBody(c);

    if ('error' in validatedData) {
      return c.json(
        {
          error: validatedData.error,
          message: validatedData.message,
        },
        validatedData.status as 400
      );
    }

    // Check if channel exists first
    const existingChannel = await getChannelByIdOrSlug(channelId, c.var.env);
    if (!existingChannel) {
      return c.json(
        {
          error: 'not_found',
          message: 'Channel not found',
        },
        404
      );
    }

    // Create updated channel keeping original ID, slug, and created timestamp
    const updatedChannel: Channel = {
      id: existingChannel.id,
      slug: existingChannel.slug,
      title: validatedData.title,
      curator: validatedData.curator,
      curators: validatedData.curators,
      summary: validatedData.summary,
      publisher: validatedData.publisher,
      playlists: validatedData.playlists,
      created: existingChannel.created,
      coverImage: validatedData.coverImage,
    };

    // Sign the channel
    const keyPair = await getServerKeyPair(c.var.env);
    updatedChannel.signature = await signChannel(updatedChannel, keyPair.privateKey);

    // Check if client prefers async processing (RFC 7240)
    const useAsync = shouldUseAsyncPersistence(c);

    if (useAsync) {
      // Async processing: queue the operation and return 202 Accepted
      const queueMessage: UpdateChannelMessage = {
        id: generateMessageId('update_channel', updatedChannel.id),
        timestamp: new Date().toISOString(),
        operation: 'update_channel',
        data: {
          channelId: updatedChannel.id,
          channel: updatedChannel,
        },
      };

      try {
        await queueWriteOperation(queueMessage, c.var.env);
        return c.json(updatedChannel, 202);
      } catch (queueError) {
        console.error('Failed to queue channel update:', queueError);
        return c.json(
          {
            error: 'queue_error',
            message: 'Failed to queue channel for processing',
          },
          500
        );
      }
    } else {
      // Sync processing: persist immediately and return 200 OK
      try {
        await saveChannel(updatedChannel, c.var.env, true);
        return c.json(updatedChannel, 200);
      } catch (storageError) {
        console.error('Failed to save channel synchronously:', storageError);
        return c.json(
          {
            error: 'storage_error',
            message: 'Failed to save channel',
          },
          500
        );
      }
    }
  } catch (error) {
    console.error('Error updating channel (PUT):', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to update channel',
      },
      500
    );
  }
});

/**
 * PATCH /channels/:id - Partial update (excludes protected fields)
 */
channels.patch('/:id', async c => {
  try {
    const channelId = c.req.param('id');

    // Validate ID format (UUID or slug)
    const validation = validateIdentifier(channelId);

    if (!channelId || !validation.isValid) {
      return c.json(
        {
          error: 'invalid_id',
          message: 'Channel ID must be a valid UUID or slug (alphanumeric with hyphens)',
        },
        400
      );
    }

    const validatedData = await validateChannelUpdateBody(c);

    // Check if validation returned an error
    if ('error' in validatedData) {
      return c.json(
        {
          error: validatedData.error,
          message: validatedData.message,
        },
        validatedData.status as 400
      );
    }

    // Check if channel exists first
    const existingChannel = await getChannelByIdOrSlug(channelId, c.var.env);
    if (!existingChannel) {
      return c.json(
        {
          error: 'not_found',
          message: 'Channel not found',
        },
        404
      );
    }

    // Create updated channel keeping original ID, slug, and created timestamp
    const updatedChannel: Channel = {
      id: existingChannel.id,
      slug: existingChannel.slug,
      title: validatedData.title || existingChannel.title,
      curator: validatedData.curator || existingChannel.curator,
      curators: validatedData.curators || existingChannel.curators,
      summary: validatedData.summary || existingChannel.summary,
      publisher: validatedData.publisher || existingChannel.publisher,
      playlists: validatedData.playlists || existingChannel.playlists,
      created: existingChannel.created,
      coverImage: validatedData.coverImage || existingChannel.coverImage,
    };

    // Sign the channel
    const keyPair = await getServerKeyPair(c.var.env);
    updatedChannel.signature = await signChannel(updatedChannel, keyPair.privateKey);

    // Check if client prefers async processing (RFC 7240)
    const useAsync = shouldUseAsyncPersistence(c);

    if (useAsync) {
      // Async processing: queue the operation and return 202 Accepted
      const queueMessage: UpdateChannelMessage = {
        id: generateMessageId('update_channel', updatedChannel.id),
        timestamp: new Date().toISOString(),
        operation: 'update_channel',
        data: {
          channelId: updatedChannel.id,
          channel: updatedChannel,
        },
      };

      try {
        await queueWriteOperation(queueMessage, c.var.env);
        return c.json(updatedChannel, 202);
      } catch (queueError) {
        console.error('Failed to queue channel update:', queueError);
        return c.json(
          {
            error: 'queue_error',
            message: 'Failed to queue channel for processing',
          },
          500
        );
      }
    } else {
      // Sync processing: persist immediately and return 200 OK
      try {
        await saveChannel(updatedChannel, c.var.env, true);
        return c.json(updatedChannel, 200);
      } catch (storageError) {
        console.error('Failed to save channel synchronously:', storageError);
        return c.json(
          {
            error: 'storage_error',
            message: 'Failed to save channel',
          },
          500
        );
      }
    }
  } catch (error) {
    console.error('Error updating channel (PATCH):', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to update channel',
      },
      500
    );
  }
});

export { channels };
