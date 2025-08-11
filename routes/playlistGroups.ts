import { Hono, Context } from 'hono';
import { z } from 'zod';
import type {
  Env,
  PlaylistGroupInput,
  PlaylistGroupUpdate,
  PlaylistGroup,
  CreatePlaylistGroupMessage,
  UpdatePlaylistGroupMessage,
} from '../types';
import {
  PlaylistGroupInputSchema,
  PlaylistGroupUpdateSchema,
  createPlaylistGroupFromInput,
  validateNoProtectedFields,
} from '../types';
import { listAllPlaylistGroups, getPlaylistGroupByIdOrSlug } from '../storage';
import { queueWriteOperation, generateMessageId } from '../queue/processor';

// Create playlist groups router
const playlistGroups = new Hono<{ Bindings: Env }>();

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
async function validatePlaylistGroupBody(
  c: Context
): Promise<PlaylistGroupInput | { error: string; message: string; status: number }> {
  try {
    const body = await c.req.json();
    const result = PlaylistGroupInputSchema.parse(body);
    return result;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      return {
        error: 'validation_error',
        message: `Invalid playlist group data: ${errorMessage}`,
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
 * Validate request body for playlist group updates (PATCH - excludes protected fields)
 */
async function validatePlaylistGroupUpdateBody(
  c: Context
): Promise<PlaylistGroupUpdate | { error: string; message: string; status: number }> {
  try {
    const body = await c.req.json();

    // Check for protected fields first
    const protectedValidation = validateNoProtectedFields(body, 'playlistGroup');
    if (!protectedValidation.isValid) {
      return {
        error: 'protected_fields',
        message: `Cannot update protected fields: ${protectedValidation.protectedFields?.join(', ')}. Protected fields are read-only.`,
        status: 400,
      };
    }

    const result = PlaylistGroupUpdateSchema.parse(body);
    return result;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      return {
        error: 'validation_error',
        message: `Invalid playlist group update data: ${errorMessage}`,
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
 * GET /playlist-groups - List all playlist groups with pagination
 * Query params:
 * - limit: number of items per page (max 100)
 * - cursor: pagination cursor from previous response
 * - sort: asc | desc (by created time)
 */
playlistGroups.get('/', async c => {
  try {
    // Parse query parameters
    const limit = parseInt(c.req.query('limit') || '100');
    const cursor = c.req.query('cursor') || undefined;
    const sortParam = (c.req.query('sort') || '').toLowerCase();
    const sort: 'asc' | 'desc' = sortParam === 'asc' ? 'asc' : 'desc'; // Default to 'desc' when no sort or invalid sort

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

    const result = await listAllPlaylistGroups(c.env, { limit, cursor, sort });
    return c.json(result);
  } catch (error) {
    console.error('Error retrieving playlist groups:', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to retrieve playlist groups',
      },
      500
    );
  }
});

/**
 * GET /playlist-groups/:id - Get specific playlist group by UUID or slug
 */
playlistGroups.get('/:id', async c => {
  try {
    const groupId = c.req.param('id');

    // Validate ID format (UUID or slug)
    const validation = validateIdentifier(groupId);

    if (!groupId || !validation.isValid) {
      return c.json(
        {
          error: 'invalid_id',
          message: 'Playlist group ID must be a valid UUID or slug (alphanumeric with hyphens)',
        },
        400
      );
    }

    const group = await getPlaylistGroupByIdOrSlug(groupId, c.env);

    if (!group) {
      return c.json(
        {
          error: 'not_found',
          message: 'Playlist group not found',
        },
        404
      );
    }

    return c.json(group);
  } catch (error) {
    console.error('Error retrieving playlist group:', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to retrieve playlist group',
      },
      500
    );
  }
});

/**
 * POST /playlist-groups - Create new playlist group
 * Fast response: validates, queues for async processing
 */
playlistGroups.post('/', async c => {
  try {
    const validatedData = await validatePlaylistGroupBody(c);

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

    // Create playlist group with server-generated ID, timestamp, and slug
    const playlistGroup = createPlaylistGroupFromInput(validatedData);

    // Create queue message for async processing
    const queueMessage: CreatePlaylistGroupMessage = {
      id: generateMessageId('create_playlist_group', playlistGroup.id),
      timestamp: new Date().toISOString(),
      operation: 'create_playlist_group',
      data: {
        playlistGroup: playlistGroup,
      },
    };

    // Queue the save operation for async processing
    try {
      await queueWriteOperation(queueMessage, c.env);
    } catch (queueError) {
      console.error('Failed to queue playlist group creation:', queueError);
      return c.json(
        {
          error: 'queue_error',
          message: 'Failed to queue playlist group for processing',
        },
        500
      );
    }

    // Return immediately with the playlist group (before saving)
    return c.json(playlistGroup, 201);
  } catch (error) {
    console.error('Error creating playlist group:', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to create playlist group',
      },
      500
    );
  }
});

/**
 * PUT /playlist-groups/:id - Replace existing playlist group (requires full resource fields)
 */
playlistGroups.put('/:id', async c => {
  try {
    const groupId = c.req.param('id');

    // Validate ID format (UUID or slug)
    const validation = validateIdentifier(groupId);

    if (!groupId || !validation.isValid) {
      return c.json(
        {
          error: 'invalid_id',
          message: 'Playlist group ID must be a valid UUID or slug (alphanumeric with hyphens)',
        },
        400
      );
    }

    // Validate full body using creation schema
    const validatedData = await validatePlaylistGroupBody(c);

    if ('error' in validatedData) {
      return c.json(
        {
          error: validatedData.error,
          message: validatedData.message,
        },
        validatedData.status as 400
      );
    }

    // Check if playlist group exists first
    const existingGroup = await getPlaylistGroupByIdOrSlug(groupId, c.env);
    if (!existingGroup) {
      return c.json(
        {
          error: 'not_found',
          message: 'Playlist group not found',
        },
        404
      );
    }

    // Create updated playlist group keeping original ID, slug, and created timestamp
    const updatedGroup: PlaylistGroup = {
      id: existingGroup.id,
      slug: existingGroup.slug,
      title: validatedData.title,
      curator: validatedData.curator,
      summary: validatedData.summary,
      playlists: validatedData.playlists,
      created: existingGroup.created,
      coverImage: validatedData.coverImage,
    };

    // Create queue message for async processing
    const queueMessage: UpdatePlaylistGroupMessage = {
      id: generateMessageId('update_playlist_group', updatedGroup.id),
      timestamp: new Date().toISOString(),
      operation: 'update_playlist_group',
      data: {
        groupId: updatedGroup.id,
        playlistGroup: updatedGroup,
      },
    };

    // Queue the update operation for async processing
    try {
      await queueWriteOperation(queueMessage, c.env);
    } catch (queueError) {
      console.error('Failed to queue playlist group update:', queueError);
      return c.json(
        {
          error: 'queue_error',
          message: 'Failed to queue playlist group for processing',
        },
        500
      );
    }

    // Return immediately with the updated playlist group (before saving)
    return c.json(updatedGroup, 200);
  } catch (error) {
    console.error('Error updating playlist group (PUT):', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to update playlist group',
      },
      500
    );
  }
});

/**
 * PATCH /playlist-groups/:id - Partial update (excludes protected fields)
 */
playlistGroups.patch('/:id', async c => {
  try {
    const groupId = c.req.param('id');

    // Validate ID format (UUID or slug)
    const validation = validateIdentifier(groupId);

    if (!groupId || !validation.isValid) {
      return c.json(
        {
          error: 'invalid_id',
          message: 'Playlist group ID must be a valid UUID or slug (alphanumeric with hyphens)',
        },
        400
      );
    }

    const validatedData = await validatePlaylistGroupUpdateBody(c);

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

    // Check if playlist group exists first
    const existingGroup = await getPlaylistGroupByIdOrSlug(groupId, c.env);
    if (!existingGroup) {
      return c.json(
        {
          error: 'not_found',
          message: 'Playlist group not found',
        },
        404
      );
    }

    // Create updated playlist group keeping original ID, slug, and created timestamp
    const updatedGroup: PlaylistGroup = {
      id: existingGroup.id,
      slug: existingGroup.slug,
      title: validatedData.title || existingGroup.title,
      curator: validatedData.curator || existingGroup.curator,
      summary: validatedData.summary || existingGroup.summary,
      playlists: validatedData.playlists || existingGroup.playlists,
      created: existingGroup.created,
      coverImage: validatedData.coverImage || existingGroup.coverImage,
    };

    // Create queue message for async processing
    const queueMessage: UpdatePlaylistGroupMessage = {
      id: generateMessageId('update_playlist_group', updatedGroup.id),
      timestamp: new Date().toISOString(),
      operation: 'update_playlist_group',
      data: {
        groupId: updatedGroup.id,
        playlistGroup: updatedGroup,
      },
    };

    // Queue the update operation for async processing
    try {
      await queueWriteOperation(queueMessage, c.env);
    } catch (queueError) {
      console.error('Failed to queue playlist group update:', queueError);
      return c.json(
        {
          error: 'queue_error',
          message: 'Failed to queue playlist group for processing',
        },
        500
      );
    }

    // Return immediately with the updated playlist group (before saving)
    return c.json(updatedGroup, 200);
  } catch (error) {
    console.error('Error updating playlist group (PATCH):', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to update playlist group',
      },
      500
    );
  }
});

export { playlistGroups };
