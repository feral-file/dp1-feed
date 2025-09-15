import { Hono } from 'hono';
import { MIN_DP_VERSION, type Env } from './types';
import {
  authMiddleware,
  corsMiddleware,
  errorMiddleware,
  loggingMiddleware,
  validateJsonMiddleware,
} from './middleware/auth';
import { testEnvMiddleware } from './middleware/env-cloudflare';
import { playlists } from './routes/playlists';
import { channels } from './routes/channels';
import playlistItems from './routes/playlistItems';
import { queues as queueRoutes } from './routes/queues';

// Check if the runtime is self-hosted (Node.js)
const isSelfHosted =
  typeof globalThis !== 'undefined' &&
  typeof globalThis.process !== 'undefined' &&
  globalThis.process?.versions?.node;

/**
 * Create the shared Hono application with all routes and middleware
 * This is used by both Cloudflare Worker (index.ts) and Node.js server (server.ts)
 */
export function createApp<TBindings extends Record<string, any> = any>(envMiddleware?: any) {
  // Create main Hono app
  const app = new Hono<{ Bindings: TBindings; Variables: { env: Env } }>();

  // Global middleware stack
  app.use('*', errorMiddleware); // Error handling (first)
  app.use('*', loggingMiddleware); // Request logging
  app.use('*', corsMiddleware); // CORS headers

  // Environment middleware (runtime-specific)
  if (envMiddleware) {
    app.use('*', envMiddleware);
  }

  app.use('*', authMiddleware); // Authentication (after env setup)
  app.use('*', validateJsonMiddleware); // Content-Type validation (last)

  // API version info
  app.get('/api/v1', c => {
    let deployment = 'unknown';
    let runtime = 'unknown';

    if (isSelfHosted) {
      deployment = 'self-hosted';
      runtime = 'node.js';
    } else {
      deployment = 'cloudflare-worker';
      runtime = 'workerd';
    }

    return c.json({
      name: 'DP-1 Feed Operator API',
      version: MIN_DP_VERSION,
      description:
        'REST interface for creating, updating, and retrieving DP-1 playlists and channels',
      specification: 'DP-1 v1.1.0',
      openapi: '3.1.0',
      deployment,
      runtime,
      endpoints: {
        playlists: '/api/v1/playlists',
        channels: '/api/v1/channels',
        playlistItems: '/api/v1/playlist-items',
        health: '/api/v1/health',
        ...(isSelfHosted && { queues: '/queues' }),
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
      environment: c.get('env')?.ENVIRONMENT || 'development',
      runtime: isSelfHosted ? 'node.js' : 'cloudflare-worker',
    });
  });

  // Mount route modules under /api/v1
  app.route('/api/v1/playlists', playlists);
  app.route('/api/v1/channels', channels);
  app.route('/api/v1/playlist-items', playlistItems);

  // For backward compatibility
  app.route('/api/v1/playlist-groups', channels);

  if (isSelfHosted) {
    // Mount queue API routes for self-hosted deployment
    app.route('/queues', queueRoutes);
  }

  // 404 handler for unmatched routes
  app.notFound(c => {
    const endpoints = [
      'GET /api/v1',
      'GET /api/v1/health',
      'GET /api/v1/playlists',
      'POST /api/v1/playlists',
      'GET /api/v1/playlists/:id',
      'PUT /api/v1/playlists/:id',
      'PATCH /api/v1/playlists/:id',
      'DELETE /api/v1/playlists/:id',
      'GET /api/v1/channels',
      'POST /api/v1/channels',
      'GET /api/v1/channels/:id',
      'PUT /api/v1/channels/:id',
      'PATCH /api/v1/channels/:id',
      'GET /api/v1/playlist-items',
      'GET /api/v1/playlist-items/:id',
    ];

    // Add queue endpoints for Node.js (self-hosted) deployment
    if (isSelfHosted) {
      endpoints.push('POST /queues/process-message', 'POST /queues/process-batch');
    }

    return c.json(
      {
        error: 'not_found',
        message: 'The requested resource was not found',
        available_endpoints: endpoints,
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

  return app;
}

/**
 * Create test app with test environment middleware
 * Used by test files to create a properly configured app for testing
 */
export function createTestApp() {
  return createApp<any>(testEnvMiddleware);
}
