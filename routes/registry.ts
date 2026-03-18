import { Hono } from 'hono';
import type { Env } from '../types';
import { validateCuratedRegistry } from '../types';
import { getCuratedRegistry, saveCuratedRegistry } from '../storage';

/**
 * Routes for managing curated channel registry
 * GET /api/v1/registry/channels - Get the curated registry
 * PUT /api/v1/registry/channels - Update the curated registry (authenticated)
 */

export const registry = new Hono<{ Bindings: any; Variables: { env: Env } }>();

/**
 * GET /api/v1/registry/channels
 * Returns the curated channel registry JSON file
 */
registry.get('/channels', async c => {
  const env = c.get('env');

  try {
    const content = await getCuratedRegistry(env);

    if (!content) {
      return c.json(
        {
          error: 'not_found',
          message: 'Curated registry not found',
        },
        404
      );
    }

    // Parse to ensure it's valid JSON
    const data = JSON.parse(content);

    return c.json(data, 200, {
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      'Content-Type': 'application/json',
    });
  } catch (error) {
    console.error('Error reading curated registry:', error);
    return c.json(
      {
        error: 'read_error',
        message: 'Failed to read curated registry',
      },
      500
    );
  }
});

/**
 * PUT /api/v1/registry/channels
 * Updates the curated channel registry JSON file
 * Requires authentication
 */
registry.put('/channels', async c => {
  const env = c.get('env');

  // Parse and validate the request body
  let requestData: unknown;
  try {
    requestData = await c.req.json();
  } catch {
    return c.json(
      {
        error: 'invalid_json',
        message: 'Request body must be valid JSON',
      },
      400
    );
  }

  // Validate the structure using Zod schema
  const validation = validateCuratedRegistry(requestData);

  if (!validation.success) {
    return c.json(
      {
        error: 'validation_error',
        message: validation.error!.message,
        issues: validation.error!.issues,
      },
      400
    );
  }

  try {
    // Pretty-print JSON for readability
    const content = JSON.stringify(validation.data, null, 2);

    // Write with backup enabled (keeps last version)
    await saveCuratedRegistry(content, env);

    return c.json(
      {
        success: true,
        message: 'Curated registry updated successfully',
        items_count: validation.data!.length,
        total_channels: validation.data!.reduce((sum, item) => sum + item.channel_urls.length, 0),
      },
      200
    );
  } catch (error) {
    console.error('Error writing curated registry:', error);
    return c.json(
      {
        error: 'write_error',
        message: 'Failed to write curated registry',
      },
      500
    );
  }
});
