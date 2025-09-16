import { Hono, Context } from 'hono';
import { z } from 'zod';
import type { Env, PlaylistInput, PlaylistUpdate, Playlist } from '../types';
import type { EnvironmentBindings } from '../env/types';
import type { CreatePlaylistMessage, UpdatePlaylistMessage } from '../queue/interfaces';
import {
  PlaylistInputSchema,
  PlaylistUpdateSchema,
  createPlaylistFromInput,
  validateNoProtectedFields,
} from '../types';
import { signObj, getServerKeyPair } from '../crypto';
import { listAllPlaylists, getPlaylistByIdOrSlug, listPlaylistsByChannelId } from '../storage';
import { queueWriteOperation, generateMessageId } from '../queue/processor';
import { shouldUseAsyncPersistence } from '../rfc7240';
import { savePlaylist, deletePlaylist } from '../storage';

// Create playlist router
const playlists = new Hono<{ Bindings: EnvironmentBindings; Variables: { env: Env } }>();

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
 * Validate request body against Zod schema (input schema without server-generated fields)
 */
async function validatePlaylistBody(
  c: Context
): Promise<PlaylistInput | { error: string; message: string; status: number }> {
  try {
    const body = await c.req.json();
    const result = PlaylistInputSchema.parse(body);
    return result;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      return {
        error: 'validation_error',
        message: `Invalid playlist data: ${errorMessage}`,
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
 * Validate request body for playlist updates (PATCH - excludes protected fields)
 */
async function validatePlaylistUpdateBody(
  c: Context
): Promise<PlaylistUpdate | { error: string; message: string; status: number }> {
  try {
    const body = await c.req.json();

    // Check for protected fields first
    const protectedValidation = validateNoProtectedFields(body, 'playlist');
    if (!protectedValidation.isValid) {
      return {
        error: 'protected_fields',
        message: `Cannot update protected fields: ${protectedValidation.protectedFields?.join(', ')}. Protected fields are read-only.`,
        status: 400,
      };
    }

    const result = PlaylistUpdateSchema.parse(body);
    return result;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      return {
        error: 'validation_error',
        message: `Invalid playlist update data: ${errorMessage}`,
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
 * GET /playlists - List all playlists with pagination and filtering
 * Query params:
 * - limit: number of items per page (max 100)
 * - cursor: pagination cursor from previous response
 * - channel: filter by channel ID
 * - sort: asc | desc (by created time)
 */
playlists.get('/', async c => {
  try {
    // Parse query parameters
    const limit = parseInt(c.req.query('limit') || '100');
    const cursor = c.req.query('cursor') || undefined;
    const channelId = c.req.query('channel') || c.req.query('playlist-group');
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

    let result;
    if (channelId) {
      // Filter by channel
      result = await listPlaylistsByChannelId(channelId, c.var.env, { limit, cursor, sort });
    } else {
      // List all playlists
      result = await listAllPlaylists(c.var.env, { limit, cursor, sort });
    }

    return c.json(result);
  } catch (error) {
    console.error('Error retrieving playlists:', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to retrieve playlists',
      },
      500
    );
  }
});

/**
 * GET /playlists/:id - Get specific playlist by UUID or slug
 */
playlists.get('/:id', async c => {
  try {
    const playlistId = c.req.param('id');

    // Validate ID format (UUID or slug)
    const validation = validateIdentifier(playlistId);

    if (!playlistId || !validation.isValid) {
      return c.json(
        {
          error: 'invalid_id',
          message: 'Playlist ID must be a valid UUID or slug (alphanumeric with hyphens)',
        },
        400
      );
    }

    const playlist = await getPlaylistByIdOrSlug(playlistId, c.var.env);

    if (!playlist) {
      return c.json(
        {
          error: 'not_found',
          message: 'Playlist not found',
        },
        404
      );
    }

    return c.json(playlist);
  } catch (error) {
    console.error('Error retrieving playlist:', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to retrieve playlist',
      },
      500
    );
  }
});

/**
 * POST /playlists - Create new playlist (server-generated ID)
 * Supports RFC 7240: synchronous by default, async if "Prefer: respond-async" header present
 */
playlists.post('/', async c => {
  try {
    const validatedData = await validatePlaylistBody(c);

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

    // Create playlist with server-generated ID, timestamp, and slug
    const playlist = createPlaylistFromInput(validatedData);

    // Sign the playlist using ed25519 as per DP-1 specification
    const keyPair = await getServerKeyPair(c.var.env);

    // Sign the playlist
    playlist.signature = await signObj(playlist, keyPair.privateKey);

    // Check if client prefers async processing (RFC 7240)
    const useAsync = shouldUseAsyncPersistence(c);

    if (useAsync) {
      // Async processing: queue the operation and return 202 Accepted
      const queueMessage: CreatePlaylistMessage = {
        id: generateMessageId('create_playlist', playlist.id),
        timestamp: new Date().toISOString(),
        operation: 'create_playlist',
        data: {
          playlist: playlist,
        },
      };

      try {
        await queueWriteOperation(queueMessage, c.var.env);
        // Return 202 Accepted for async processing
        return c.json(playlist, 202);
      } catch (queueError) {
        console.error('Failed to queue playlist creation:', queueError);
        return c.json(
          {
            error: 'queue_error',
            message: 'Failed to queue playlist for processing',
          },
          500
        );
      }
    } else {
      // Sync processing: persist immediately and return 201 Created
      try {
        await savePlaylist(playlist, c.var.env, false);
        return c.json(playlist, 201);
      } catch (storageError) {
        console.error('Failed to save playlist synchronously:', storageError);
        return c.json(
          {
            error: 'storage_error',
            message: 'Failed to save playlist',
          },
          500
        );
      }
    }
  } catch (error) {
    console.error('Error creating playlist:', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to create playlist',
      },
      500
    );
  }
});

/**
 * PUT /playlists/:id - Replace existing playlist (requires full resource fields)
 */
playlists.put('/:id', async c => {
  try {
    const playlistId = c.req.param('id');

    // Validate ID format (UUID or slug)
    const validation = validateIdentifier(playlistId);

    if (!playlistId || !validation.isValid) {
      return c.json(
        {
          error: 'invalid_id',
          message: 'Playlist ID must be a valid UUID or slug (alphanumeric with hyphens)',
        },
        400
      );
    }

    // Validate full body using creation schema (no protected fields)
    const validatedData = await validatePlaylistBody(c);

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

    // Check if playlist exists first
    const existingPlaylist = await getPlaylistByIdOrSlug(playlistId, c.var.env);
    if (!existingPlaylist) {
      return c.json(
        {
          error: 'not_found',
          message: 'Playlist not found',
        },
        404
      );
    }

    // Generate IDs and created timestamps for items being replaced
    const itemsWithIds = validatedData.items.map((item, index) => {
      // Create a unique timestamp for each item by adding milliseconds based on index
      const itemTimestamp = new Date(Date.now() + index).toISOString();
      return {
        ...item,
        id: crypto.randomUUID(),
        created: itemTimestamp,
      };
    });

    // Create updated playlist by replacing non-protected fields
    const updatedPlaylist: Playlist = {
      dpVersion: validatedData.dpVersion,
      id: existingPlaylist.id, // Keep original server-generated ID
      slug: existingPlaylist.slug,
      title: validatedData.title,
      curators: validatedData.curators,
      summary: validatedData.summary,
      coverImage: validatedData.coverImage,
      created: existingPlaylist.created,
      defaults: validatedData.defaults,
      dynamicQueries: validatedData.dynamicQueries,
      items: itemsWithIds,
    };

    // Re-sign the playlist
    const keyPair = await getServerKeyPair(c.var.env);
    updatedPlaylist.signature = await signObj(updatedPlaylist, keyPair.privateKey);

    // Check if client prefers async processing (RFC 7240)
    const useAsync = shouldUseAsyncPersistence(c);

    if (useAsync) {
      // Async processing: queue the operation and return 202 Accepted
      const queueMessage: UpdatePlaylistMessage = {
        id: generateMessageId('update_playlist', updatedPlaylist.id),
        timestamp: new Date().toISOString(),
        operation: 'update_playlist',
        data: {
          playlistId: updatedPlaylist.id,
          playlist: updatedPlaylist,
        },
      };

      try {
        await queueWriteOperation(queueMessage, c.var.env);
        return c.json(updatedPlaylist, 202);
      } catch (queueError) {
        console.error('Failed to queue playlist update:', queueError);
        return c.json(
          {
            error: 'queue_error',
            message: 'Failed to queue playlist for processing',
          },
          500
        );
      }
    } else {
      // Sync processing: persist immediately and return 200 OK
      try {
        await savePlaylist(updatedPlaylist, c.var.env, true);
        return c.json(updatedPlaylist, 200);
      } catch (storageError) {
        console.error('Failed to save playlist synchronously:', storageError);
        return c.json(
          {
            error: 'storage_error',
            message: 'Failed to save playlist',
          },
          500
        );
      }
    }
  } catch (error) {
    console.error('Error updating playlist (PUT):', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to update playlist',
      },
      500
    );
  }
});

/**
 * PATCH /playlists/:id - Partial update of existing playlist (excludes protected fields)
 */
playlists.patch('/:id', async c => {
  try {
    const playlistId = c.req.param('id');

    // Validate ID format (UUID or slug)
    const validation = validateIdentifier(playlistId);

    if (!playlistId || !validation.isValid) {
      return c.json(
        {
          error: 'invalid_id',
          message: 'Playlist ID must be a valid UUID or slug (alphanumeric with hyphens)',
        },
        400
      );
    }

    const validatedData = await validatePlaylistUpdateBody(c);

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

    // Check if playlist exists first
    const existingPlaylist = await getPlaylistByIdOrSlug(playlistId, c.var.env);
    if (!existingPlaylist) {
      return c.json(
        {
          error: 'not_found',
          message: 'Playlist not found',
        },
        404
      );
    }

    let itemsWithIds = existingPlaylist.items;
    if (validatedData.items) {
      itemsWithIds = validatedData.items.map((item, index) => {
        // Create a unique timestamp for each item by adding milliseconds based on index
        const itemTimestamp = new Date(Date.now() + index).toISOString();
        return {
          ...item,
          id: crypto.randomUUID(),
          created: itemTimestamp,
        };
      });
    }

    // Create updated playlist, allow updating non-protected fields
    const updatedPlaylist: Playlist = {
      dpVersion: validatedData.dpVersion || existingPlaylist.dpVersion,
      id: existingPlaylist.id,
      slug: existingPlaylist.slug,
      title: validatedData.title || existingPlaylist.title,
      curators: validatedData.curators || existingPlaylist.curators,
      summary: validatedData.summary || existingPlaylist.summary,
      coverImage: validatedData.coverImage || existingPlaylist.coverImage,
      created: existingPlaylist.created,
      defaults: validatedData.defaults ?? existingPlaylist.defaults,
      dynamicQueries: validatedData.dynamicQueries || existingPlaylist.dynamicQueries,
      items: itemsWithIds,
    };

    // Re-sign the playlist
    const keyPair = await getServerKeyPair(c.var.env);
    updatedPlaylist.signature = await signObj(updatedPlaylist, keyPair.privateKey);

    // Check if client prefers async processing (RFC 7240)
    const useAsync = shouldUseAsyncPersistence(c);

    if (useAsync) {
      // Async processing: queue the operation and return 202 Accepted
      const queueMessage: UpdatePlaylistMessage = {
        id: generateMessageId('update_playlist', updatedPlaylist.id),
        timestamp: new Date().toISOString(),
        operation: 'update_playlist',
        data: {
          playlistId: updatedPlaylist.id,
          playlist: updatedPlaylist,
        },
      };

      try {
        await queueWriteOperation(queueMessage, c.var.env);
        return c.json(updatedPlaylist, 202);
      } catch (queueError) {
        console.error('Failed to queue playlist update:', queueError);
        return c.json(
          {
            error: 'queue_error',
            message: 'Failed to queue playlist for processing',
          },
          500
        );
      }
    } else {
      // Sync processing: persist immediately and return 200 OK
      try {
        await savePlaylist(updatedPlaylist, c.var.env, true);
        return c.json(updatedPlaylist, 200);
      } catch (storageError) {
        console.error('Failed to save playlist synchronously:', storageError);
        return c.json(
          {
            error: 'storage_error',
            message: 'Failed to save playlist',
          },
          500
        );
      }
    }
  } catch (error) {
    console.error('Error updating playlist (PATCH):', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to update playlist',
      },
      500
    );
  }
});

/**
 * DELETE /playlists/:id - Delete playlist by UUID or slug
 * Supports RFC 7240: synchronous by default, async if "Prefer: respond-async" header present
 */
playlists.delete('/:id', async c => {
  try {
    const playlistId = c.req.param('id');

    // Validate ID format (UUID or slug)
    const validation = validateIdentifier(playlistId);

    if (!playlistId || !validation.isValid) {
      return c.json(
        {
          error: 'invalid_id',
          message: 'Playlist ID must be a valid UUID or slug (alphanumeric with hyphens)',
        },
        400
      );
    }

    // Check if playlist exists first
    const existingPlaylist = await getPlaylistByIdOrSlug(playlistId, c.var.env);
    if (!existingPlaylist) {
      return c.json(
        {
          error: 'not_found',
          message: 'Playlist not found',
        },
        404
      );
    }

    // Check if client prefers async processing (RFC 7240)
    const useAsync = shouldUseAsyncPersistence(c);

    if (useAsync) {
      // Async processing: queue the operation and return 202 Accepted
      const queueMessage: import('../queue/interfaces').DeletePlaylistMessage = {
        id: generateMessageId('delete_playlist', existingPlaylist.id),
        timestamp: new Date().toISOString(),
        operation: 'delete_playlist',
        data: {
          playlistId: existingPlaylist.id,
        },
      };

      try {
        await queueWriteOperation(queueMessage, c.var.env);
        // Return 202 Accepted for async processing
        return c.json({ message: 'Playlist deletion queued for processing' }, 202);
      } catch (queueError) {
        console.error('Failed to queue playlist deletion:', queueError);
        return c.json(
          {
            error: 'queue_error',
            message: 'Failed to queue playlist for deletion',
          },
          500
        );
      }
    } else {
      // Sync processing: delete immediately and return 204 No Content
      try {
        await deletePlaylist(existingPlaylist.id, c.var.env);
        return new Response(null, { status: 204 });
      } catch (storageError) {
        console.error('Failed to delete playlist synchronously:', storageError);
        return c.json(
          {
            error: 'storage_error',
            message: 'Failed to delete playlist',
          },
          500
        );
      }
    }
  } catch (error) {
    console.error('Error deleting playlist:', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to delete playlist',
      },
      500
    );
  }
});

export { playlists };
