# Development Guide

Quick start guide for local development of the DP-1 Feed API.

## Prerequisites

- Node.js 22+
- **Cloudflare Workers**: Wrangler CLI (`npm install -g wrangler`)
- **Node.js**: Docker (recommended) or etcd + NATS JetStream

## Quick Start

### Cloudflare Workers

```bash
# 1. Install Wrangler and authenticate
npm install -g wrangler
wrangler login

# 2. Setup resources
npm run worker:setup:kv
npm run worker:setup:secrets
npm run worker:setup:queues:dev

# 3. Start development
npm run worker:dev
# Server runs at http://localhost:8787
```

### Node.js (Docker Compose)

```bash
# Start everything (recommended)
docker compose up -d

# View logs
docker compose logs -f dp1-server

# Stop
docker compose down
```

Server runs at `http://localhost:8787`

### Node.js (Local Development)

```bash
# 1. Start infrastructure
docker compose up -d etcd nats

# 2. Configure environment (optional)
cp .env.sample .env
# Edit .env with your custom values

# 3. Start API server
npm run node:dev
```

## Development Commands

```bash
# Development
npm run worker:dev       # Start Cloudflare Workers dev server
npm run node:dev         # Start Node.js dev server with live reload

# Code Quality
npm run validate         # Run all checks (lint + format + type-check + tests)
npm run lint             # Check code style
npm run lint:fix         # Auto-fix linting issues
npm run type-check       # TypeScript validation

# Utilities
npm run jwt:generate-keys  # Generate RSA key pair for JWT testing
npm run clean            # Clean build artifacts
```

See [TESTING.md](TESTING.md) for testing commands.

## Configuration

### Cloudflare Workers

**wrangler.toml** - Configuration file:

```toml
name = "dp1-feed-operator-api"
main = "worker.ts"

[vars]
ENVIRONMENT = "development"
# JWT configuration (optional)
JWT_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----..."
JWT_ISSUER = "your-issuer"
JWT_AUDIENCE = "your-audience"

[[kv_namespaces]]
binding = "DP1_PLAYLISTS"
id = "your-kv-id"

[[queues.producers]]
binding = "DP1_WRITE_QUEUE"
queue = "dp1-write-operations"
```

**Secrets**:

```bash
# Set all required secrets for dev environment
npm run worker:setup:secrets

# Or for production
npm run worker:setup:secrets:production
```

### Node.js

**.env** - Environment configuration:

```bash
# Required
API_SECRET=your-api-secret
ED25519_PRIVATE_KEY=your-ed25519-key

# Infrastructure
ETCD_ENDPOINT=http://localhost:2379
NATS_ENDPOINT=nats://localhost:4222
NATS_STREAM_NAME=DP1_WRITE_OPERATIONS
NATS_SUBJECT_NAME=dp1.write.operations

# Optional: JWT authentication
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----..."
JWT_ISSUER=your-issuer
JWT_AUDIENCE=your-audience
```

**Note:** Docker Compose uses `.env.sample` as defaults. Create `.env` only for custom overrides.

## Docker Services

```bash
# Start all services
docker compose up -d

# Start infrastructure only (run API locally)
docker compose up -d etcd nats

# With debug tools (etcd UI on port 8080)
docker compose --profile debug up -d

# View service logs
docker compose logs -f dp1-server
docker compose logs -f dp1-consumer

# Check service status
docker compose ps
```

**Services:**

- `etcd` - Key-value store (port 2379)
- `nats` - Message queue (port 4222)
- `dp1-server` - API server (port 8787)
- `dp1-consumer` - Queue processor
- `etcd-keeper` - etcd UI (port 8080, debug profile)

## Workflow

### Daily Development

```bash
# Start dev server
npm run worker:dev  # or npm run node:dev

# Make changes (auto-reload enabled)

# Check your work
npm run lint
npm test

# Commit
git add .
git commit -m "feat: add feature"
```

### Before Push

```bash
npm run validate  # Runs all checks
```

## Debugging

### Cloudflare Workers

```bash
# View logs
npm run worker:logs

# Check KV data
npm run worker:kv:list
```

**Advanced debugging:** Use `wrangler dev --inspect` to debug with Chrome DevTools.

### Node.js

```bash
# Debug mode
node --inspect-brk dist/server.js

# Check etcd data
docker exec -it dp1-etcd etcdctl get /dp1/playlists/ --prefix

# Check NATS streams
docker exec -it dp1-nats nats stream ls

# View logs
docker compose logs -f dp1-server
```

## Troubleshooting

### Build Errors

```bash
npm run clean
npm install
npm run type-check
```

### Service Issues

```bash
# Check services are running
docker compose ps
curl http://localhost:8787/api/v1/health

# Restart services
docker compose restart dp1-server
```

### Environment Issues

```bash
# Verify configuration
docker compose config
```

## Deployment

### Cloudflare Workers

```bash
# Deploy to dev
npm run worker:deploy

# Deploy to production
npm run worker:deploy:production
```

### Node.js

```bash
# Build and run
npm run node:build
npm run node:start

# Or rebuild Docker images
docker compose up -d --build
```

## Additional Resources

- **[README.md](README.md)** - API documentation and usage
- **[TESTING.md](TESTING.md)** - Testing guide and benchmarks
- **[openapi.yaml](openapi.yaml)** - Complete API specification
