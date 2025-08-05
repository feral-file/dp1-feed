# DP-1 Feed Operator API

[![Build Status](https://img.shields.io/github/actions/workflow/status/display-protocol/dp1-feed/test.yaml?branch=main&label=build%20status&logo=github)](https://github.com/display-protocol/dp1-feed/actions/workflows/test.yaml)
[![Linter](https://img.shields.io/github/actions/workflow/status/display-protocol/dp1-feed/lint.yaml?branch=main&label=linter&logo=github)](https://github.com/display-protocol/dp1-feed/actions/workflows/lint.yaml)
[![Code Coverage](https://img.shields.io/codecov/c/github/display-protocol/dp1-feed/main?label=code%20coverage&logo=codecov)](https://codecov.io/gh/display-protocol/dp1-feed)
[![Benchmark](https://img.shields.io/github/actions/workflow/status/display-protocol/dp1-feed/benchmark.yaml?branch=main&label=benchmark%20status&logo=github)](https://github.com/display-protocol/dp1-feed/actions/workflows/benchmark.yaml)

A modern, serverless API server built for Cloudflare Workers using the **Hono framework**. Implements OpenAPI 3.1.0 specification for DP-1 playlists and playlist-groups with comprehensive middleware, schema validation, and modular architecture.

## 🚀 Features

### Modern Architecture

- **Hono Framework**: Express-like routing and middleware for Cloudflare Workers
- **Zod Schema Validation**: Runtime type-safe request validation
- **Modular Design**: Organized routes, middleware, and utilities
- **TypeScript First**: Full type safety and excellent DX

### DP-1 Compliance

- **OpenAPI 3.1.0 Compliant**: Full REST interface matching the DP-1 Feed Operator API specification
- **DP-1 Specification**: Complete implementation of DP-1 v1.0.0 for blockchain-native digital art
- **Ed25519 Signatures**: Cryptographic playlist signing as per DP-1 specification
- **Schema Validation**: Comprehensive validation against DP-1 JSON schemas

### Production Ready

- **Cloudflare Workers**: Serverless deployment with global edge performance
- **KV Storage**: Distributed key-value storage for playlists and metadata
- **Cloudflare Queue**: Asynchronous processing for write operations with automatic retries
- **Authentication Middleware**: Bearer token authentication for write operations
- **CORS Middleware**: Cross-origin resource sharing for web applications
- **Request Logging**: Structured logging with performance metrics
- **Error Handling**: Comprehensive error handling with proper HTTP status codes

### Developer Experience

- **Hot Reload**: Fast development with live reloading
- **Type Safety**: End-to-end TypeScript with Zod validation
- **ESLint + Prettier**: Code quality and consistent formatting
- **Multi-Environment**: Development, staging, and production configurations

## 📦 Quick Start

### Prerequisites

- Node.js 22+
- npm or yarn
- Cloudflare account
- Wrangler CLI (`npm install -g wrangler`)

### 1. Install Dependencies

```bash
npm install
```

### 2. Authenticate with Cloudflare

```bash
npx wrangler login
```

### 3. Create KV Namespaces and Queue

```bash
npm run setup:kv
```

This will create KV namespaces and print their IDs. Copy these IDs to update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "DP1_PLAYLISTS"
id = "YOUR_PLAYLISTS_KV_ID_HERE"
preview_id = "YOUR_PLAYLISTS_PREVIEW_KV_ID_HERE"

[[kv_namespaces]]
binding = "DP1_PLAYLIST_GROUPS"
id = "YOUR_PLAYLIST_GROUPS_KV_ID_HERE"
preview_id = "YOUR_PLAYLIST_GROUPS_PREVIEW_KV_ID_HERE"

[[kv_namespaces]]
binding = "DP1_PLAYLIST_ITEMS"
id = "YOUR_PLAYLIST_ITEMS_KV_ID_HERE"
preview_id = "YOUR_PLAYLIST_ITEMS_PREVIEW_KV_ID_HERE"

# Queue configuration for async processing
[[queues.producers]]
binding = "DP1_WRITE_QUEUE"
queue = "dp1-write-operations"

[[queues.consumers]]
queue = "dp1-write-operations"
max_batch_size = 1
max_batch_timeout = 1
```

### 4. Set API Secrets

```bash
npm run setup:secrets
```

When prompted, enter:

1. **API_SECRET**: A secure API key (generate with `openssl rand -hex 32`)
2. **ED25519_PRIVATE_KEY**: Ed25519 private key for playlist signing

Generate an Ed25519 private key with:

```bash
# Method 1: PKCS#8 format (recommended)
openssl genpkey -algorithm Ed25519 -out private.pem && openssl pkey -in private.pem -outform DER | xxd -p -c 256

# Method 2: Raw 32-byte seed
openssl rand -hex 32
```

### 5. Initialize Sample Data (Optional)

```bash
npm run init:data
```

This creates sample playlists and playlist groups for testing.

### 6. Deploy

```bash
npm run deploy
```

Your API will be available at `https://dp1-feed-operator-api.your-subdomain.workers.dev`

## 🛠️ Development

### Local Development

```bash
# Start development server with live reload
npm run dev

# Or specify a custom port
npm run dev:port
```

### Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# API integration tests
npm run test:api

# Performance benchmarks (K6)
npm run benchmark

# Different K6 test scenarios
npm run benchmark:light      # CI/CD friendly
npm run benchmark:stress     # High load testing
npm run benchmark:spike      # Sudden load testing
npm run benchmark:soak       # Long-running stability

# Generate report from existing results
npm run benchmark:report
```

### Code Quality

```bash
# Lint and format
npm run lint
npm run format

# Type checking
npm run type-check

# Full validation (lint + test + type-check)
npm run validate
```

## 🏗️ Architecture

### Modern Framework Stack

The API is built using modern web standards optimized for edge computing:

```
┌─────────────────────────────────────────┐
│                Hono App                 │
├─────────────────────────────────────────┤
│ Middleware Stack:                       │
│ • Error Handling                        │
│ • Request Logging                       │
│ • CORS Headers                         │
│ • Content-Type Validation             │
│ • Bearer Token Authentication         │
├─────────────────────────────────────────┤
│ Routes:                                │
│ • /api/v1/playlists (Zod validation)   │
│ • /api/v1/playlist-groups (Zod validation) │
│ • /api/v1/playlist-items (Zod validation) │
│ • /api/v1/health (Health checks)       │
├─────────────────────────────────────────┤
│ Services:                              │
│ • KV Storage Operations                │
│ • Ed25519 Cryptography                 │
│ • Schema Validation                    │
│ • Queue Processing                     │
└─────────────────────────────────────────┘
```

### Project Structure

```
src/
├── index.ts                 # Main Hono app with middleware
├── types.ts                 # TypeScript types + Zod schemas
├── middleware/
│   └── auth.ts             # Authentication, CORS, logging
├── routes/
│   ├── playlists.ts        # Playlist CRUD operations
│   ├── playlistGroups.ts   # Playlist group operations
│   └── playlistItems.ts    # Playlist item read operations
├── storage.ts              # KV storage operations
├── crypto.ts               # Ed25519 signing utilities
├── queue/
│   └── processor.ts        # Queue message processing
└── scripts/                # Deployment and testing scripts
```

### Middleware Pipeline

1. **Error Handling**: Global error catching and proper HTTP responses
2. **Request Logging**: Structured logging with timing
3. **CORS**: Cross-origin headers and preflight handling
4. **Content-Type Validation**: JSON validation for write operations
5. **Authentication**: Bearer token validation for protected routes

### Queue Processing

1. **Message Creation**: Write operations create queue messages with operation details
2. **Async Processing**: Queue processor handles storage operations in the background
3. **Automatic Retries**: Failed operations are retried automatically by Cloudflare Queue
4. **Batch Processing**: Configurable batch size and timeout for optimal performance

### Schema Validation

All requests are validated using **Zod schemas** that mirror the DP-1 specification:

```typescript
// Example: Playlist validation
const result = PlaylistSchema.parse(requestBody);
// Automatic validation with detailed error messages
```

## 🌍 Production Deployment

### Production Environment

```bash
# Create production KV namespaces
npm run setup:kv:production

# Update wrangler.toml with production KV IDs

# Set production secrets
npm run setup:secrets:production

# Initialize production data
npm run init:data:production

# Deploy to production
npm run deploy:production
```

## 📡 API Usage

### API Behavior

The API follows REST principles with comprehensive validation:

- **Schema Validation**: All requests validated against Zod schemas
- **Type Safety**: Full TypeScript support end-to-end
- **Error Handling**: Detailed error messages with proper HTTP status codes
- **Authentication**: Bearer token required for write operations
- **Async Processing**: Write operations (POST/PUT) are queued for asynchronous processing

### Authentication

All write operations (`POST`, `PUT`) require Bearer token authentication:

```bash
curl -H "Authorization: Bearer YOUR_API_SECRET" \
     -H "Content-Type: application/json" \
     -X POST https://your-api.workers.dev/playlists \
     -d @playlist.json
```

### Endpoints

#### Core API

```bash
# API Information
GET  /                                   # API info and available endpoints
GET  /health                            # Health check with environment info

# Playlists (with full Zod validation)
GET  /playlists                         # List all playlists (array)
GET  /playlists/{id}                    # Get specific playlist
POST /playlists                         # Create playlist (async, requires auth + validation)
PUT  /playlists/{id}                    # Update playlist (async, requires auth + validation)

# Playlist Groups (with full Zod validation)
GET  /playlist-groups                   # List all groups (array)
GET  /playlist-groups/{id}              # Get specific group
POST /playlist-groups                   # Create group (async, requires auth + validation)
PUT  /playlist-groups/{id}              # Update group (async, requires auth + validation)

# Playlist Items (read-only access)
GET  /playlist-items                    # List all playlist items (with optional filtering)
GET  /playlist-items/{id}               # Get specific playlist item by UUID
```

#### Legacy Compatibility

```bash
# Legacy v1 routes (for backward compatibility)
GET  /api/v1/playlists
POST /api/v1/playlists
GET  /api/v1/playlist-groups
POST /api/v1/playlist-groups
GET  /api/v1/playlist-items
GET  /api/v1/playlist-items/{id}
# ... (mirrors main API)
```

### Example Requests

#### Create a Playlist (with async processing)

```bash
curl -X POST https://your-api.workers.dev/playlists \
  -H "Authorization: Bearer YOUR_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "dpVersion": "1.0.0",
    "id": "my-playlist",
    "items": [
      {
        "id": "artwork-1",
        "source": "https://example.com/art.html",
        "duration": 300,
        "license": "open"
      }
    ]
  }'
```

**Response**: The API returns the signed playlist immediately (before persistence) with a 201 status code. The playlist is queued for asynchronous storage processing.

#### Response with Validation Errors

```json
{
  "error": "validation_error",
  "message": "Invalid playlist data: items.0.duration: Expected number, received string; dpVersion: String must contain at least 1 character(s)"
}
```

#### Get Playlist Items (read-only)

```bash
# List all playlist items with pagination
curl -X GET "https://your-api.workers.dev/playlist-items?limit=50&cursor=abc123"

# Filter playlist items by playlist group
curl -X GET "https://your-api.workers.dev/playlist-items?playlist-group=385f79b6-a45f-4c1c-8080-e93a192adccc"

# Get a specific playlist item by UUID
curl -X GET "https://your-api.workers.dev/playlist-items/123e4567-e89b-12d3-a456-426614174000"
```

## 🔧 Configuration

### Environment Variables

Copy `env.example` to `.env` and configure:

```bash
# Required
API_SECRET=your-super-secret-api-key
ED25519_PRIVATE_KEY=your-ed25519-private-key-hex

# Optional
ENVIRONMENT=development
IPFS_GATEWAY_URL=https://ipfs.io
ARWEAVE_GATEWAY_URL=https://arweave.net
```

### Wrangler Configuration

The `wrangler.toml` file configures:

- KV namespace bindings
- Queue configuration for async processing
- Environment-specific settings
- Route patterns for custom domains
- Build and deployment settings

## 🗄️ Data Storage & Queue Architecture

### KV Namespace Structure

**DP1_PLAYLISTS:**

- `playlist:{id}` - Individual playlists (containing playlist items)

**DP1_PLAYLIST_GROUPS:**

- `playlist-group:{id}` - Individual groups

**Note:** Playlist items are stored within playlists but can be accessed individually via dedicated endpoints for read operations.

### Queue Architecture

**DP1_WRITE_QUEUE:**

- **Purpose**: Asynchronous processing of write operations
- **Operations**: Create/update playlists and playlist groups
- **Benefits**: Fast API responses, automatic retries, improved reliability
- **Processing**: Batch processing with configurable batch size and timeout

### Async Processing Flow

1. **Request Validation**: API validates and authenticates the request
2. **Queue Message**: Creates a queue message with operation details
3. **Fast Response**: Returns the resource immediately (before persistence)
4. **Background Processing**: Queue processor saves to KV storage
5. **Automatic Retries**: Failed operations are retried automatically

### Data Persistence

- All data persists in Cloudflare KV storage
- Eventual consistency across global edge locations
- Automatic replication and backup
- No local file system dependencies

## 🔐 Security

### Modern Security Stack

- **Schema Validation**: Zod prevents injection attacks via strict typing
- **Middleware Pipeline**: Layered security with authentication, CORS, content validation
- **Bearer Token Authentication**: Secure API key authentication
- **Ed25519 Cryptography**: Modern cryptographic signatures
- **Input Sanitization**: Automatic sanitization via Zod schemas

### Authentication Flow

```typescript
// Middleware validates all write operations
if (['POST', 'PUT', 'DELETE'].includes(method)) {
  const token = req.header('Authorization')?.replace(/^Bearer\s+/, '');
  if (token !== env.API_SECRET) {
    return unauthorized();
  }
}
```

## 📊 Monitoring & Debugging

### Performance Benchmarking with K6

The API uses **K6**, the industry-standard performance testing tool, to ensure optimal response times and reliability:

```bash
# Run standard benchmark test
npm run benchmark

# Run different test scenarios
npm run benchmark:light     # Light load (CI/CD friendly)
npm run benchmark:stress    # Stress test with higher load
npm run benchmark:spike     # Spike test for sudden load
npm run benchmark:soak      # Long-running stability test

# Run against custom URL with specific test type
npm run benchmark https://your-api.workers.dev stress

# Generate report from existing results
npm run benchmark:report
```

**Performance Criteria:**

- GET requests: P95 ≤ 300ms
- POST/PUT requests: P95 ≤ 450ms (async processing)
- Success rate: ≥ 99%
- Check success rate: ≥ 99%

**K6 Benchmark Features:**

- **Industry Standard**: Uses K6 for professional-grade performance testing
- **Multiple Test Scenarios**: Light, normal, stress, spike, and soak tests
- **Advanced Metrics**: P90, P95, P99 response times with detailed breakdowns
- **Real Data Testing**: Creates and uses actual API resources for testing
- **HTTP Method Analysis**: Separate thresholds and reporting for GET/POST/PUT
- **Comprehensive Reporting**: Detailed markdown reports with visual status indicators
- **CI/CD Integration**: Automated testing in GitHub Actions
- **Performance Badges**: Automatic README badge updates

**Test Scenarios:**

- **Light** (25s @ 2 users): Perfect for CI/CD pipelines
- **Normal** (90s @ 5-10 users): Standard performance validation
- **Stress** (140s @ 10-30 users): High load performance testing
- **Spike** (50s with sudden spike to 50 users): Sudden load resilience
- **Soak** (5min 20s @ 5 users): Long-running stability testing

**Report Output:**

- `benchmark-report.md`: Comprehensive K6 performance report
- `k6-results/`: Raw K6 JSON and HTML reports
- Automatic README badge updates with current performance status
- HTTP method breakdown and detailed metrics analysis

**Installation Requirements:**
K6 must be installed separately:

```bash
# macOS
brew install k6

# Linux
sudo apt-get install k6

# Windows
choco install k6
```

### Structured Logging

The API includes comprehensive request logging:

```bash
→ POST /playlists
← POST /playlists 201 (45ms)
```

### Health Checks

```bash
# Check API status and environment
curl https://your-api.workers.dev/health

# Response includes:
{
  "status": "healthy",
  "timestamp": "2024-01-15T14:30:00.000Z",
  "version": "0.4.0",
  "environment": "production"
}
```

### Error Monitoring

- Global error handling with stack traces
- Validation error details with field-level feedback
- HTTP status codes following REST conventions
- Request/response logging for debugging

### KV Operations

```bash
# List KV namespaces
npm run kv:list

# Get a specific key
npx wrangler kv:key get "playlist:my-playlist-id" --binding DP1_PLAYLISTS

# Put a key manually
npx wrangler kv:key put "playlist:test" "test value" --binding DP1_PLAYLISTS
```

## 🔄 Updating & Maintenance

### Code Updates

```bash
# Pull latest changes
git pull

# Install dependencies
npm install

# Validate changes
npm run validate

# Deploy updates
npm run deploy
```

### Schema Migration

When updating Zod schemas, the validation will automatically handle new requirements:

```typescript
// Schema evolution example
const PlaylistSchema = z.object({
  // ... existing fields
  newField: z.string().optional(), // Add optional fields safely
});
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with proper TypeScript types
4. Add Zod validation for new fields
5. Update tests and documentation
6. Run the validation suite: `npm run validate`
7. Submit a pull request

### Code Standards

- **TypeScript**: Strict mode with comprehensive typing
- **Zod Schemas**: All API inputs must be validated
- **Hono Patterns**: Follow Hono middleware and routing conventions
- **ESLint + Prettier**: Consistent code formatting
- **DP-1 Compliance**: All changes must maintain DP-1 specification compliance

## 📚 Documentation

- [DP-1 Specification](https://github.com/display-protocol/dp1/blob/main/docs/spec.md)
- [OpenAPI Schema](https://github.com/display-protocol/dp1/blob/main/docs/feed-api.yaml)
- [Hono Documentation](https://hono.dev/)
- [Zod Documentation](https://zod.dev/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)

## 🐛 Troubleshooting

### Common Issues

**Schema validation errors:**

```bash
# Check the specific validation error message
# Zod provides detailed field-level feedback
```

**KV namespace not found:**

```bash
# Recreate namespaces
npm run setup:kv
# Update wrangler.toml with new IDs
```

**Authentication failed:**

```bash
# Reset API secret and ED25519 private key
npm run setup:secrets
```

**Missing ED25519_PRIVATE_KEY:**

```bash
# Generate and set ED25519 private key
openssl genpkey -algorithm Ed25519 -out private.pem && \
openssl pkey -in private.pem -outform DER | xxd -p -c 256 | \
wrangler secret put ED25519_PRIVATE_KEY
```

**TypeScript errors:**

```bash
# Check types and schemas
npm run type-check
```

**Queue processing issues:**

```bash
# Check queue status
npx wrangler queue list

# View queue messages
npx wrangler queue peek dp1-write-operations
```

### Getting Help

- Check the [issues page](https://github.com/display-protocol/dp1-feed/issues)
- Review Hono [documentation](https://hono.dev/)
- Review Zod [documentation](https://zod.dev/)
- Contact support at support@feralfile.com

## 📄 License

Mozilla Public License 2.0

Copyright (c) 2025 Feral File

For detailed terms and conditions, please refer to the [LICENSE](LICENSE) file.

---

**Built with ❤️ by Feral File for the DP-1 ecosystem using modern web standards.**
