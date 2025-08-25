# Development Guide

This guide covers local development setup, project structure, and configuration for both Cloudflare Workers and Node.js deployments.

## 🛠️ Local Development Setup

### Prerequisites

- Node.js 22+
- npm or yarn
- Git
- For Cloudflare Workers: Wrangler CLI (`npm install -g wrangler`)
- For Node.js: etcd + NATS JetStream (or Docker)

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/display-protocol/dp1-feed.git
cd dp1-feed

# Install dependencies
npm install

# Verify installation
npm run type-check
```

## 🚀 Development Scripts

### Script Organization

Scripts are organized by deployment type with clear prefixes:

#### Shared Scripts (Both Deployments)
```bash
# Testing
npm test                    # Run all tests
npm run test:watch         # Watch mode
npm run test:coverage      # Coverage report

# Code Quality
npm run lint              # ESLint
npm run format            # Prettier
npm run type-check        # TypeScript check
npm run validate          # Full validation

# Performance
npm run benchmark         # K6 benchmarks
npm run benchmark:light   # Light load test
npm run benchmark:stress  # Stress test
npm run benchmark:spike   # Spike test
npm run benchmark:soak    # Soak test
```

#### Cloudflare Workers Scripts
```bash
# Development
npm run worker:dev        # Start CF Workers dev server
npm run worker:dev:port   # Dev server on specific port
npm run worker:dev:live   # Dev server with live reload

# Build & Deploy
npm run worker:build      # TypeScript check
npm run worker:deploy     # Deploy to dev environment
npm run worker:deploy:production  # Deploy to production

# Setup & Configuration
npm run worker:setup:kv   # Create KV namespaces
npm run worker:setup:secrets  # Set API secrets
npm run worker:setup:queues   # Create queues
npm run worker:init:data  # Initialize sample data

# Monitoring
npm run worker:logs       # View dev logs
npm run worker:logs:production  # View production logs
npm run worker:kv:list    # List KV namespaces
npm run worker:kv:get     # Get KV value
npm run worker:kv:put     # Put KV value
```

#### Node.js Server Scripts
```bash
# Development
npm run node:dev          # Start Node.js dev server
npm run node:start        # Start production server
npm run node:start:dev    # Start dev server with tsx

# Build
npm run node:build        # Build with esbuild

# Testing
npm run test:headless     # Test with headless server
npm run test:api          # API integration tests
```

## 🔧 Development Environment

### Cloudflare Workers Development

#### 1. Setup Wrangler

```bash
# Install Wrangler CLI
npm install -g wrangler

# Authenticate with Cloudflare
npx wrangler login
```

#### 2. Configure Development Environment

```bash
# Create development KV namespaces
npm run worker:setup:kv

# Set development secrets
npm run worker:setup:secrets

# Create development queue
npm run worker:setup:queues:dev
```

#### 3. Start Development Server

```bash
# Start with live reload
npm run worker:dev

# Start on specific port
npm run worker:dev:port

# Start with live reload
npm run worker:dev:live
```

The development server will be available at `http://localhost:8787`

### Node.js Development

#### 1. Setup Infrastructure

**Option A: Docker Compose (Recommended)**

```bash
# Start required services
docker compose up -d etcd nats

# Verify services are running
docker compose ps
```

**Option B: Manual Setup**

```bash
# Start etcd
etcd --listen-client-urls http://0.0.0.0:2379 --advertise-client-urls http://localhost:2379

# Start NATS with JetStream
nats-server -js
```

#### 2. Configure Environment

**Option A: Docker Compose Setup**

The `docker-compose.yml` file includes pre-configured environment variables for development. No additional `.env` file is needed for Docker Compose.

**Note**: The Docker Compose setup uses hardcoded development values. For production, you should modify the environment variables in `docker-compose.yml`.

**Option B: Manual Setup (without Docker)**

Create `.env` file:

```bash
# Required
API_SECRET=dev-api-secret
ED25519_PRIVATE_KEY=dev-ed25519-private-key

# etcd configuration
ETCD_ENDPOINT=http://localhost:2379

# NATS JetStream configuration
NATS_ENDPOINT=nats://localhost:4222
NATS_STREAM_NAME=DP1_WRITE_OPERATIONS
NATS_SUBJECT_NAME=dp1.write.operations

# Optional
ENVIRONMENT=development
```

#### 3. Start Development Server

**Option A: Direct Node.js Development**

```bash
# Start with live reload
npm run node:dev

# Or start production build
npm run node:build
npm run node:start
```

**Option B: Docker Compose Development**

```bash
# Start all services including the API
docker compose up -d

# Or start just the infrastructure and run API locally
docker compose up -d etcd nats
npm run node:dev

# View logs
docker compose logs -f dp1-server

# Stop all services
docker compose down
```

**Option C: Full Docker Development**

```bash
# Build and run the API in Docker
docker compose up -d --build

# The API will be available at http://localhost:8787
```

## 🏗️ Project Structure

```
dp1-feed/
├── app.ts                 # Main Hono application
├── worker.ts              # Cloudflare Workers entry point
├── server.ts              # Node.js server entry point
├── types.ts               # TypeScript types and Zod schemas
├── crypto.ts              # Ed25519 signing utilities
├── storage.ts             # Storage abstraction layer
├── test-helpers.ts        # Test utilities
├── vitest.config.ts       # Test configuration
├── wrangler.toml          # Cloudflare Workers configuration
├── docker-compose.yml     # Docker services
├── Dockerfile.server      # Docker image for server
├── Dockerfile.consumer    # Docker image for queue consumer
│
├── env/                   # Environment configurations
│   ├── cloudflare.ts      # Cloudflare Workers environment
│   ├── selfhosted.ts      # Node.js environment
│   ├── types.ts           # Environment type definitions
│   └── env.test.ts        # Test environment
│
├── middleware/            # Hono middleware
│   ├── auth.ts            # Authentication middleware
│   ├── env-cloudflare.ts  # Cloudflare environment middleware
│   └── env-selfhosted.ts  # Node.js environment middleware
│
├── routes/                # API routes
│   ├── playlists.ts       # Playlist CRUD operations
│   ├── playlistGroups.ts  # Playlist group operations
│   ├── playlistItems.ts   # Playlist item operations
│   └── queues.ts          # Queue management
│
├── storage/               # Storage implementations
│   ├── cloudflare-kv.ts   # Cloudflare KV storage
│   ├── etcd-kv.ts         # etcd storage
│   ├── interfaces.ts      # Storage interfaces
│   └── service.ts         # Storage service layer
│
├── queue/                 # Queue processing
│   ├── cloudflare-queue.ts # Cloudflare Queue implementation
│   ├── nats-jetstream.ts  # NATS JetStream implementation
│   ├── interfaces.ts      # Queue interfaces
│   ├── processor.ts       # Queue message processing
│   └── service.ts         # Queue service layer
│
├── scripts/               # Utility scripts
│   ├── init-kv-data.js    # Initialize sample data
│   ├── test-api.js        # API testing script
│   └── k6-benchmark.js    # Performance testing
│
├── k6/                    # K6 performance tests
│   ├── api-benchmark.js   # Main benchmark script
│   ├── config.js          # Test configurations
│   └── README.md          # K6 documentation
│
├── docker/                # Docker configurations
│   ├── nats/              # NATS configuration
│
├── consumer/              # Queue consumer
│   ├── index.ts           # Consumer entry point
│   ├── package.json       # Consumer dependencies
│   └── tsconfig.json      # Consumer TypeScript config
│
└── .github/               # GitHub Actions
    └── workflows/         # CI/CD workflows
```

## 🔧 Configuration

### Environment Variables

#### Cloudflare Workers Environment

```typescript
// env/cloudflare.ts
export interface CloudFlareBindings {
  // KV Storage
  DP1_PLAYLISTS: KVNamespace;
  DP1_PLAYLIST_GROUPS: KVNamespace;
  DP1_PLAYLIST_ITEMS: KVNamespace;
  
  // Queue
  DP1_WRITE_QUEUE: Queue;
  
  // Secrets
  API_SECRET: string;
  ED25519_PRIVATE_KEY: string;
  
  // Environment
  ENVIRONMENT: string;
}
```

#### Node.js Environment

```typescript
// env/selfhosted.ts
export interface SelfHostedBindings {
  // API Configuration
  API_SECRET: string;
  ED25519_PRIVATE_KEY: string;
  
  // etcd Configuration
  ETCD_ENDPOINT: string;
  ETCD_USERNAME?: string;
  ETCD_PASSWORD?: string;
  ETCD_PREFIX?: string;
  
  // NATS Configuration
  NATS_ENDPOINT: string;
  NATS_USERNAME?: string;
  NATS_PASSWORD?: string;
  NATS_TOKEN?: string;
  NATS_STREAM_NAME: string;
  NATS_SUBJECT_NAME: string;
  
  // Environment
  ENVIRONMENT: string;
  SELF_HOSTED_DOMAINS?: string;
}
```

### Wrangler Configuration

```toml
# wrangler.toml
name = "dp1-feed-operator-api"
main = "worker.ts"
compatibility_date = "2024-01-15"

[env.dev]
name = "dp1-feed-operator-api-dev"

[env.production]
name = "dp1-feed-operator-api-prod"

# KV Namespaces
[[kv_namespaces]]
binding = "DP1_PLAYLISTS"
id = "your-playlists-kv-id"
preview_id = "your-playlists-preview-kv-id"

[[kv_namespaces]]
binding = "DP1_PLAYLIST_GROUPS"
id = "your-playlist-groups-kv-id"
preview_id = "your-playlist-groups-preview-kv-id"

[[kv_namespaces]]
binding = "DP1_PLAYLIST_ITEMS"
id = "your-playlist-items-kv-id"
preview_id = "your-playlist-items-preview-kv-id"

# Queue Configuration
[[queues.producers]]
binding = "DP1_WRITE_QUEUE"
queue = "dp1-write-operations"

[[queues.consumers]]
queue = "dp1-write-operations"
max_batch_size = 1
max_batch_timeout = 1
```

### Docker Configuration

The project includes a comprehensive `docker-compose.yml` file with pre-configured services:

```yaml
# Key services in docker-compose.yml
services:
  etcd:                    # Key-value store (replaces CloudFlare KV)
    image: quay.io/coreos/etcd:v3.5.15
    ports: ["2379:2379"]
    
  nats:                    # Message streaming (replaces CloudFlare Queue)
    image: nats:2.10-alpine
    ports: ["4222:4222"]
    
  dp1-server:              # Main API server
    build: { context: ., dockerfile: Dockerfile.server }
    ports: ["8787:8787"]
    environment:
      - API_SECRET=dev-secret-key-change-in-production
      - ED25519_PRIVATE_KEY=302e020100300506032b6570042204205e42cad90e34efb36d84b8dbbcf15777ac33f4126a80c087cdedfb030138ac6f
      - ETCD_ENDPOINT=http://etcd:2379
      - NATS_ENDPOINT=nats://nats:4222
      
  dp1-consumer:            # Queue message processor
    build: { context: ., dockerfile: Dockerfile.consumer }
    
  nats-box:                # NATS management UI (debug profile)
    image: natsio/nats-box:latest
    profiles: ["debug"]
    
  etcd-keeper:             # etcd management UI (debug profile)
    image: nikfoundas/etcd-viewer:latest
    ports: ["8080:8080"]
    profiles: ["debug"]
```

**Development Options:**

1. **Infrastructure Only**: `docker compose up -d etcd nats` + run API locally
2. **Full Stack**: `docker compose up -d` (runs everything)
3. **With Debug Tools**: `docker compose --profile debug up -d` (includes management UIs)

**Key Features:**
- Pre-configured development environment variables
- Health checks for all services
- Persistent volumes for etcd and NATS data
- Optional debug tools (NATS UI, etcd viewer)
- Separate consumer service for queue processing

## 🧪 Testing

### Unit Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Integration Tests

```bash
# Test Cloudflare Workers API
npm run test:api

# Test Node.js API
npm run test:headless
```

### Performance Tests

```bash
# Run K6 benchmarks
npm run benchmark

# Different test scenarios
npm run benchmark:light
npm run benchmark:stress
npm run benchmark:spike
npm run benchmark:soak
```

## 🔍 Debugging

### Cloudflare Workers Debugging

```bash
# View logs
npm run worker:logs

# Debug with Wrangler
npx wrangler dev --inspect

# Check KV data
npm run worker:kv:list
npm run worker:kv:get "playlist:my-playlist"
```

### Node.js Debugging

```bash
# Debug with Node.js
node --inspect-brk dist/server.js

# Debug with tsx
npx tsx --inspect-brk server.ts

# Check etcd data
etcdctl get /dp1/playlists/my-playlist

# Check NATS streams
nats stream list
```

### Common Debugging Commands

```bash
# Check TypeScript types
npm run type-check

# Lint code
npm run lint

# Format code
npm run format

# Full validation
npm run validate
```

## 🔄 Development Workflow

### 1. Feature Development

```bash
# Create feature branch
git checkout -b feature/new-feature

# Start development server
npm run worker:dev  # or npm run node:dev

# Make changes and test
npm test
npm run lint
npm run type-check

# Commit changes
git add .
git commit -m "feat: add new feature"
```

### 2. Testing

```bash
# Run all tests
npm run validate

# Run performance tests
npm run benchmark

# Test deployment
npm run test:api
```

### 3. Deployment

```bash
# Deploy to development
npm run worker:deploy    # Cloudflare Workers
# or
npm run node:build && npm run node:start  # Node.js

# Deploy to production (Only CloudFlare Worker)
npm run worker:deploy:production
```

## 🐛 Troubleshooting

### Common Development Issues

#### TypeScript Errors

```bash
# Check for type errors
npm run type-check

# Common fixes:
# 1. Import missing types
# 2. Add proper Zod validation
# 3. Update environment interfaces
```

#### Test Failures

```bash
# Run tests with verbose output
npm test -- --verbose

# Check test environment
npm run test:coverage
```

#### Build Errors

```bash
# Clean and rebuild
npm run clean
npm install
npm run node:build
```

#### Environment Issues

```bash
# Verify environment setup
# Cloudflare Workers
npm run worker:setup:kv
npm run worker:setup:secrets

# Node.js
docker-compose up -d etcd nats
# or
etcd --listen-client-urls http://0.0.0.0:2379
nats-server -js
```

### Getting Help

- Check the [issues page](https://github.com/display-protocol/dp1-feed/issues)
- Review [TESTING.md](TESTING.md) for testing strategies
- Contact support at support@feralfile.com
