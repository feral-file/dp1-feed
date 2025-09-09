import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'miniflare',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'coverage/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        'vitest.config.ts',
        '.eslintrc.js',
        'scripts/**',
        'eslint.config.js',
        'k6/**',
        'storage/index.ts',
        'queue/index.ts',
        'test-helpers.ts',
        'worker.ts',
        'server.ts',
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'dist', '.wrangler'],
  },
  esbuild: {
    target: 'es2022',
  },
  define: {
    global: 'globalThis',
  },
});
