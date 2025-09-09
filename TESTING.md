# Testing Guide

This guide covers testing strategies, commands, and best practices for the DP-1 Feed Operator API.

## 🧪 Testing Overview

The project uses a comprehensive testing strategy with multiple layers:

- **Unit Tests**: Individual function and component testing
- **Integration Tests**: API endpoint testing with real infrastructure
- **Performance Tests**: Load testing with K6
- **End-to-End Tests**: Full workflow testing

## 🚀 Quick Start

### Run All Tests

```bash
# Run complete test suite
npm run validate

# This includes:
# - Unit tests
# - Type checking
# - Linting
# - Code formatting
```

### Individual Test Commands

```bash
# Unit tests only
npm test

# Integration tests
npm run test:api

# Performance tests
npm run benchmark

# Coverage report
npm run test:coverage
```

## 📋 Test Commands Reference

### Shared Testing Commands

```bash
# Unit Testing
npm test                    # Run all unit tests
npm run test:watch         # Watch mode for development
npm run test:coverage      # Generate coverage report

# Code Quality
npm run lint              # ESLint code checking
npm run format            # Prettier code formatting
npm run type-check        # TypeScript type checking
npm run validate          # Full validation suite

# Performance Testing
npm run benchmark         # Standard K6 benchmark
npm run benchmark:light   # Light load test (CI/CD friendly)
npm run benchmark:stress  # Stress test with high load
npm run benchmark:spike   # Spike test for sudden load
npm run benchmark:soak    # Soak test for long-running stability
npm run benchmark:report  # Generate report from existing results
```

### Integration Testing

```bash
# Integration tests for local server (both CloudFlare and NodeJS)
npm run test:api
```

## 🧩 Unit Testing

### Test Framework

The project uses **Vitest** for unit testing with the following configuration:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'miniflare',
    environmentOptions: {
      bindings: {
        // Test environment bindings
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
```

### Test Structure

```
├── api.test.ts           # API endpoint tests
├── crypto.test.ts        # Cryptography tests
├── storage.test.ts       # Storage layer tests
├── middleware/
│   └── auth.test.ts      # Authentication tests
└── test-helpers.ts       # Test utilities
```

### Writing Unit Tests

```typescript
// Example unit test
import { describe, it, expect } from 'vitest';
import { createPlaylist } from '../routes/playlists';

describe('Playlist Creation', () => {
  it('should create a valid playlist', async () => {
    const playlistData = {
      dpVersion: '1.0.0',
      id: 'test-playlist',
      items: [
        {
          id: 'artwork-1',
          source: 'https://example.com/art.html',
          duration: 300,
          license: 'open',
        },
      ],
    };

    const result = await createPlaylist(playlistData);

    expect(result).toHaveProperty('id', 'test-playlist');
    expect(result).toHaveProperty('signature');
    expect(result.items).toHaveLength(1);
  });

  it('should reject invalid playlist data', async () => {
    const invalidData = {
      dpVersion: '1.0.0',
      id: 'test-playlist',
      items: [
        {
          id: 'artwork-1',
          source: 'https://example.com/art.html',
          duration: 'invalid', // Should be number
          license: 'open',
        },
      ],
    };

    await expect(createPlaylist(invalidData)).rejects.toThrow();
  });
});
```

### Test Coverage

```bash
# Generate coverage report
npm run test:coverage

# View coverage in browser
open coverage/index.html
```

Coverage targets:

- **Statements**: > 90%
- **Branches**: > 85%
- **Functions**: > 90%
- **Lines**: > 90%

## 🔗 Integration Testing

### API Integration Tests

The project includes comprehensive API integration tests that verify:

- Endpoint functionality
- Request/response validation
- Authentication
- Error handling
- Data persistence

```bash
# Start development server (CF Worker)
npm run worker:dev:port

# Or NodeJS server
npm run node:start:dev

# Run integration tests
npm run test:api
```

### Test Scenarios

The integration tests cover:

1. **Health Check**
   - API status endpoint
   - Environment information

2. **Playlist Operations**
   - Create playlist (with validation)
   - Get playlist by ID
   - List playlists with pagination
   - Update playlist
   - Error handling for invalid data

3. **Channel Operations**
   - Create channel
   - Get channel by ID
   - List channels
   - Update channel

4. **Playlist Item Operations**
   - Get playlist item by ID
   - List playlist items with filtering
   - Pagination support

5. **Authentication**
   - Bearer token validation
   - Unauthorized access handling

6. **Error Handling**
   - Validation errors
   - Not found errors
   - Server errors

### Test Data Management

```typescript
// test-helpers.ts
export const createTestPlaylist = () => ({
  dpVersion: '1.0.0',
  id: `test-playlist-${Date.now()}`,
  items: [
    {
      id: 'artwork-1',
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

## ⚡ Performance Testing

### K6 Performance Testing

The project uses **K6** for comprehensive performance testing with multiple scenarios.

#### Installation

```bash
# macOS
brew install k6

# Linux
sudo apt-get install k6

# Windows
choco install k6
```

#### Test Scenarios

| Scenario   | Duration | Users  | Purpose                         |
| ---------- | -------- | ------ | ------------------------------- |
| **Light**  | 25s      | 2      | CI/CD pipeline testing          |
| **Normal** | 90s      | 5-10   | Standard performance validation |
| **Stress** | 140s     | 10-30  | High load performance testing   |
| **Spike**  | 50s      | 5→50→5 | Sudden load resilience          |
| **Soak**   | 5min 20s | 5      | Long-running stability          |

#### Running Performance Tests

```bash
# Standard benchmark
npm run benchmark

# Specific scenarios
npm run benchmark:light
npm run benchmark:stress
npm run benchmark:spike
npm run benchmark:soak

# Custom URL and scenario
npm run benchmark https://your-api.workers.dev stress

# Generate report
npm run benchmark:report
```

#### Performance Criteria

- **GET requests**: P95 ≤ 300ms
- **POST/PUT requests**: P95 ≤ 450ms (async processing)
- **Success rate**: ≥ 99%
- **Check success rate**: ≥ 99%

#### K6 Test Features

- **Real Data Testing**: Creates and uses actual API resources
- **HTTP Method Analysis**: Separate thresholds for GET/POST/PUT
- **Comprehensive Reporting**: Detailed metrics and visual reports
- **CI/CD Integration**: Automated testing in GitHub Actions

### Benchmark Reports

Performance tests generate comprehensive reports:

```bash
# View latest report
cat benchmark-report.md

# Raw K6 results
ls k6-results/
```

Report includes:

- P90, P95, P99 response times
- Success rates by HTTP method
- Error analysis
- Performance vs. threshold compliance
- Test configuration details

## 🔍 Test Configuration

### Environment Setup

#### Test Environment Variables

```bash
# .env.test
API_SECRET=test-api-secret
ED25519_PRIVATE_KEY=test-ed25519-private-key
ENVIRONMENT=test
```

#### Cloudflare Workers Test Environment

```typescript
// env/env.test.ts
export const testBindings = {
  DP1_PLAYLISTS: new Map(),
  DP1_CHANNELS: new Map(),
  DP1_PLAYLIST_ITEMS: new Map(),
  API_SECRET: 'test-api-secret',
  ED25519_PRIVATE_KEY: 'test-ed25519-private-key',
  ENVIRONMENT: 'test',
};
```

#### Node.js Test Environment

```typescript
// Test environment setup
export const setupTestEnvironment = async () => {
  // Start test etcd instance
  // Start test NATS instance
  // Initialize test data
};
```

### Test Utilities

```typescript
// test-helpers.ts
export const createTestApp = () => {
  // Create test application instance
};

export const createTestRequest = (method: string, path: string, body?: any) => {
  // Create test request object
};

export const cleanupTestData = async () => {
  // Clean up test data
};
```

## 🚦 CI/CD Testing

### GitHub Actions Integration

The project includes automated testing in CI/CD:

```yaml
# .github/workflows/test.yaml
name: Test Server

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run test:coverage
      - run: npm run benchmark:light
```

### Automated Testing Pipeline

1. **Code Quality Checks**
   - ESLint validation
   - Prettier formatting
   - TypeScript type checking

2. **Unit Tests**
   - Run all unit tests
   - Generate coverage report
   - Upload to Codecov

3. **Integration Tests**
   - Test Cloudflare Workers deployment
   - Test Node.js deployment
   - Verify API functionality

4. **Performance Tests**
   - Light load testing
   - Performance regression detection
   - Generate performance reports

## 📊 Test Reporting

### Coverage Reports

```bash
# Generate coverage report
npm run test:coverage

# View in browser
open coverage/index.html
```

### Performance Reports

```bash
# Generate performance report
npm run benchmark:report

# View report
cat benchmark-report.md
```

### Test Results

Test results are available in multiple formats:

- **Console Output**: Real-time test progress
- **Coverage Reports**: HTML and JSON coverage data
- **Performance Reports**: K6 metrics and analysis
- **CI/CD Artifacts**: GitHub Actions artifacts

## 🐛 Debugging Tests

### Common Test Issues

#### Test Failures

```bash
# Run tests with verbose output
npm test -- --verbose

# Run specific test file
npm test -- api.test.ts

# Run tests in watch mode
npm run test:watch
```

#### Integration Test Issues

```bash
# Check if development server is running
curl http://localhost:8787/api/v1/health

# Verify environment variables
echo $API_SECRET
echo $ED25519_PRIVATE_KEY
```

#### Performance Test Issues

```bash
# Check K6 installation
k6 version

# Run K6 with debug output
k6 run --verbose k6/api-benchmark.js

# Test with minimal load
k6 run --vus 1 --duration 10s k6/api-benchmark.js
```

### Debugging Commands

```bash
# Debug TypeScript issues
npm run type-check

# Debug linting issues
npm run lint

# Debug formatting issues
npm run format:check

# Full validation
npm run validate
```

## 🔄 Test Maintenance

### Updating Tests

When adding new features:

1. **Add Unit Tests**

   ```typescript
   // Add tests for new functionality
   describe('New Feature', () => {
     it('should work correctly', () => {
       // Test implementation
     });
   });
   ```

2. **Add Integration Tests**

   ```typescript
   // Add API endpoint tests
   it('should handle new endpoint', async () => {
     const response = await app.request('/api/v1/new-endpoint');
     expect(response.status).toBe(200);
   });
   ```

3. **Update Performance Tests**
   ```javascript
   // Add new endpoint to K6 tests
   group('New Endpoint', () => {
     http.get(`${BASE_URL}/api/v1/new-endpoint`);
   });
   ```

### Test Data Management

```bash
# Clean up test data
npm run clean

## 📚 Additional Resources

- **[k6/README.md](k6/README.md)** - Detailed K6 performance testing guide
- **[Vitest Documentation](https://vitest.dev/)** - Unit testing framework docs
- **[K6 Documentation](https://k6.io/docs/)** - Performance testing framework docs
```
