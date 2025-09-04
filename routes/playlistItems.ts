import { Hono } from 'hono';
import type { Env } from '../types';
import type { EnvironmentBindings } from '../env/types';
import { getPlaylistItemById, listAllPlaylistItems } from '../storage';

// Create playlist items router
const playlistItems = new Hono<{ Bindings: EnvironmentBindings; Variables: { env: Env } }>();

/**
 * Validate identifier format (UUID only for playlist items)
 */
function validatePlaylistItemId(identifier: string): {
  isValid: boolean;
  isUuid: boolean;
} {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

  return {
    isValid: isUuid,
    isUuid,
  };
}

/**
 * GET /playlist-items/:id - Get specific playlist item by UUID
 */
playlistItems.get('/:id', async c => {
  try {
    const itemId = c.req.param('id');

    // Validate ID format (UUID only)
    const validation = validatePlaylistItemId(itemId);

    if (!itemId || !validation.isValid) {
      return c.json(
        {
          error: 'invalid_id',
          message: 'Playlist item ID must be a valid UUID',
        },
        400
      );
    }

    const playlistItem = await getPlaylistItemById(itemId, c.var.env);

    if (!playlistItem) {
      return c.json(
        {
          error: 'not_found',
          message: 'Playlist item not found',
        },
        404
      );
    }

    return c.json(playlistItem);
  } catch (error) {
    console.error('Error retrieving playlist item:', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to retrieve playlist item',
      },
      500
    );
  }
});

/**
 * GET /playlist-items - List all playlist items
 * Query params:
 * - limit: number of items per page (max 100)
 * - cursor: pagination cursor from previous response
 * - sort: asc | desc (by created time)
 */
playlistItems.get('/', async c => {
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

    // List all playlist items
    const result = await listAllPlaylistItems(c.var.env, {
      limit,
      cursor,
      sort,
    });

    return c.json(result);
  } catch (error) {
    console.error('Error retrieving playlist items:', error);
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to retrieve playlist items',
      },
      500
    );
  }
});

export default playlistItems;
