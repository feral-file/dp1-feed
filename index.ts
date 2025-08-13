import { Hono } from 'hono';
import { MIN_DP_VERSION, type Env } from './types';
import { type CloudFlareBindings, type EnvironmentBindings, initializeCloudFlareEnv } from './env';
import {
  authMiddleware,
  corsMiddleware,
  errorMiddleware,
  loggingMiddleware,
  validateJsonMiddleware,
} from './middleware/auth';
import { envMiddleware } from './middleware/env';
import { playlists } from './routes/playlists';
import { playlistGroups } from './routes/playlistGroups';
import playlistItems from './routes/playlistItems';
import { processWriteOperations } from './queue/processor';
import { MessageBatch, ExecutionContext } from '@cloudflare/workers-types';

/**
 * DP-1 Feed Operator API Server
 *
 * Modern Hono-based implementation with:
 * - Express-like routing and middleware
 * - Zod schema validation
 * - Modular route organization
 * - Comprehensive middleware stack
 * - OpenAPI 3.1.0 compliance
 * - DP-1 v1.0.0 specification implementation
 */

// Create main Hono app with support for multiple environment types
const app = new Hono<{ Bindings: EnvironmentBindings; Variables: { env: Env } }>();

// Global middleware stack
app.use('*', errorMiddleware); // Error handling (first)
app.use('*', loggingMiddleware); // Request logging
app.use('*', corsMiddleware); // CORS headers
app.use('*', envMiddleware); // Environment initialization (before auth)
app.use('*', authMiddleware); // Authentication (after env setup)
app.use('*', validateJsonMiddleware); // Content-Type validation (last)

// API version info
app.get('/api/v1', c => {
  return c.json({
    name: 'DP-1 Feed Operator API',
    version: MIN_DP_VERSION,
    description:
      'REST interface for creating, updating, and retrieving DP-1 playlists and playlist-groups',
    specification: 'DP-1 v1.0.0',
    openapi: '3.1.0',
    endpoints: {
      playlists: '/api/v1/playlists',
      playlistGroups: '/api/v1/playlist-groups',
      playlistItems: '/api/v1/playlist-items',
      health: '/api/v1/health',
    },
    documentation: 'https://github.com/display-protocol/dp1/blob/main/docs/spec.md',
  });
});

// Health check endpoint
app.get('/api/v1/health', c => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: MIN_DP_VERSION,
    environment: c.var.env?.ENVIRONMENT || 'development',
  });
});

// Mount route modules under /api/v1
app.route('/api/v1/playlists', playlists);
app.route('/api/v1/playlist-groups', playlistGroups);
app.route('/api/v1/playlist-items', playlistItems);

// 404 handler for unmatched routes
app.notFound(c => {
  return c.json(
    {
      error: 'not_found',
      message: 'The requested resource was not found',
      available_endpoints: [
        'GET /api/v1',
        'GET /api/v1/health',
        'GET /api/v1/playlists',
        'POST /api/v1/playlists',
        'GET /api/v1/playlists/:id',
        'PUT /api/v1/playlists/:id',
        'PATCH /api/v1/playlists/:id',
        'GET /api/v1/playlist-groups',
        'POST /api/v1/playlist-groups',
        'GET /api/v1/playlist-groups/:id',
        'PUT /api/v1/playlist-groups/:id',
        'PATCH /api/v1/playlist-groups/:id',
        'GET /api/v1/playlist-items',
        'GET /api/v1/playlist-items/:id',
      ],
    },
    404
  );
});

// Global error handler (fallback)
app.onError((error, c) => {
  console.error('Global error handler:', error);

  return c.json(
    {
      error: 'internal_error',
      message: 'An unexpected error occurred',
    },
    500
  );
});

// Queue consumer for async write operations
async function queue(
  batch: MessageBatch,
  bindings: CloudFlareBindings,
  _ctx: ExecutionContext
): Promise<void> {
  const env = initializeCloudFlareEnv(bindings);
  await processWriteOperations(batch, env);
}

// Export for Cloudflare Workers
export default {
  fetch: app.fetch,
  queue,
};
