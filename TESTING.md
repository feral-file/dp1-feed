# Testing Guide

Comprehensive testing guide for the DP-1 Feed API covering unit tests, integration tests, and performance benchmarks.

## Quick Start

```bash
# Run all tests and checks
npm run validate

# Individual test types
npm test                 # Unit tests
npm run test:api        # Integration tests
npm run benchmark       # Performance tests
npm run test:coverage   # Coverage report
```

## Test Types

### Unit Tests

Test individual functions and components using Vitest.

```bash
npm test                # Run all unit tests
npm run test:watch     # Watch mode
npm run test:coverage  # Generate coverage report
```

**Coverage targets:** >90% statements, >85% branches

**Test files:**

- `api.test.ts` - API endpoint tests
- `crypto.test.ts` - Cryptography tests
- `storage.test.ts` - Storage layer tests
- `middleware/*.test.ts` - Middleware tests

### Integration Tests

Test complete API workflows with real server.

```bash
# Start development server first
npm run worker:dev:port  # Cloudflare Workers
# OR
npm run node:dev         # Node.js

# Then run integration tests
npm run test:api
```

Tests cover:

- Full request/response cycles
- Authentication flows
- Data persistence
- Error handling

### Performance Tests

Load and stress testing with K6.

**Prerequisites:** Install K6

```bash
# macOS
brew install k6

# Linux
sudo apt-get install k6

# Windows
choco install k6
```

**Run benchmarks:**

```bash
npm run benchmark         # Standard test (90s, 5-10 users)
npm run benchmark:light   # Light test (25s, 2 users) - CI/CD
npm run benchmark:stress  # Stress test (140s, 10-30 users)
npm run benchmark:spike   # Spike test (50s, 5→50→5 users)
npm run benchmark:soak    # Soak test (5m20s, 5 users)

# Custom URL
npm run benchmark https://your-api.workers.dev stress
```

**Performance criteria:**

- GET requests: P95 ≤ 300ms
- POST/PUT requests: P95 ≤ 450ms
- Success rate: ≥ 99%

**View reports:**

```bash
cat benchmark-report.md   # Latest benchmark results
ls k6-results/           # All test results
```

## Code Quality

```bash
npm run lint           # Check code style
npm run lint:fix       # Auto-fix issues
npm run format         # Format code
npm run format:check   # Check formatting
npm run type-check     # TypeScript validation
npm run validate       # Run all checks + tests
```

## Writing Tests

### Unit Test Example

```typescript
import { describe, it, expect } from 'vitest';
import { createPlaylist } from '../routes/playlists';

describe('Playlist Creation', () => {
  it('should create valid playlist', async () => {
    const data = {
      dpVersion: '1.0.0',
      id: 'test-playlist',
      items: [
        {
          source: 'https://example.com/art.html',
          duration: 300,
          license: 'open',
        },
      ],
    };

    const result = await createPlaylist(data);

    expect(result).toHaveProperty('id', 'test-playlist');
    expect(result).toHaveProperty('signature');
    expect(result.items).toHaveLength(1);
  });

  it('should reject invalid data', async () => {
    const invalid = {
      dpVersion: '1.0.0',
      items: [{ duration: 'invalid' }], // Should be number
    };

    await expect(createPlaylist(invalid)).rejects.toThrow();
  });
});
```

### Test Helpers

```typescript
// test-helpers.ts
export const createTestPlaylist = () => ({
  dpVersion: '1.0.0',
  id: `test-playlist-${Date.now()}`,
  items: [
    {
      source: 'https://example.com/art.html',
      duration: 300,
      license: 'open',
    },
  ],
});

export const createTestChannel = (playlistIds: string[]) => ({
  dpVersion: '1.0.0',
  id: `test-channel-${Date.now()}`,
  playlists: playlistIds,
});
```

## CI/CD Integration

The project includes automated GitHub Actions workflows:

```yaml
# .github/workflows/test.yaml
- Unit tests with coverage
- Integration tests
- Light performance tests
- Code quality checks
```

**Workflows:**

- **test.yaml** - Unit tests and coverage
- **lint.yaml** - Code quality checks
- **benchmark.yaml** - Performance tests

## Debugging Tests

```bash
# Verbose test output
npm test -- --verbose

# Run specific test file
npm test -- api.test.ts

# Debug integration tests
curl http://localhost:8787/api/v1/health

# K6 debug mode
k6 run --verbose k6/api-benchmark.js

# Check environment
echo $API_SECRET
echo $ED25519_PRIVATE_KEY
```

## Test Configuration

### Environment Variables

```bash
# .env for testing
API_SECRET=test-api-secret
ED25519_PRIVATE_KEY=test-key
ENVIRONMENT=test
```

### Vitest Configuration

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
```

## Additional Resources

- **[k6/README.md](k6/README.md)** - Detailed K6 testing guide
- **[Vitest Docs](https://vitest.dev/)** - Unit testing framework
- **[K6 Docs](https://k6.io/docs/)** - Performance testing
