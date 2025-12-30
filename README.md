# DP-1 Feed Operator API

[![Build Status](https://img.shields.io/github/actions/workflow/status/feral-file/dp1-feed/test.yaml?branch=main&label=build%20status&logo=github)](https://github.com/feral-file/dp1-feed/actions/workflows/test.yaml)
[![Linter](https://img.shields.io/github/actions/workflow/status/feral-file/dp1-feed/lint.yaml?branch=main&label=linter&logo=github)](https://github.com/feral-file/dp1-feed/actions/workflows/lint.yaml)
[![Code Coverage](https://img.shields.io/codecov/c/github/feral-file/dp1-feed/main?label=code%20coverage&logo=codecov)](https://codecov.io/gh/feral-file/dp1-feed)
[![Benchmark](https://img.shields.io/github/actions/workflow/status/feral-file/dp1-feed/benchmark.yaml?branch=main&label=benchmark%20status&logo=github)](https://github.com/feral-file/dp1-feed/actions/workflows/benchmark.yaml)

A REST API server implementing the [DP-1 specification](https://github.com/display-protocol/dp1/blob/main/docs/spec.md) for managing blockchain-native digital art playlists. Deploy as serverless (Cloudflare Workers) or self-hosted (Node.js).

## Features

- **DP-1 v1.1.0 Compliant** - Full OpenAPI 3.1.0 implementation
- **Dual Deployment** - Cloudflare Workers (serverless) or Node.js (self-hosted)
- **Type-Safe** - TypeScript with Zod validation
- **Production Ready** - Ed25519 signatures, JWT auth, async processing (RFC 7240)

## Quick Start

### Prerequisites

- Node.js 22+
- **Cloudflare Workers**: Cloudflare account + Wrangler CLI
- **Node.js**: Docker or etcd + NATS JetStream

### Installation

```bash
git clone https://github.com/feral-file/dp1-feed.git
cd dp1-feed
npm install
```

### Deploy

**Cloudflare Workers (Serverless)**

```bash
# Setup and deploy
npm run worker:setup:kv
npm run worker:setup:secrets
npm run worker:deploy
```

**Node.js (Self-Hosted)**

```bash
# Option 1: Docker Compose (recommended)
docker compose up -d

# Option 2: Local development
npm run node:dev
```

Server runs on `http://localhost:8787` by default.

## API Reference

### Authentication

Write operations (`POST`, `PUT`, `DELETE`) require authentication:

```bash
# API Key
Authorization: Bearer YOUR_API_SECRET

# JWT Token (RS256)
Authorization: Bearer JWT_TOKEN
```

**JWT Configuration:**

```bash
# Use either JWT_PUBLIC_KEY or JWT_JWKS_URL (not both)
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----..."  # PEM format or base64 encoded
JWT_JWKS_URL="https://auth.example.com/.well-known/jwks.json"  # Or JWKS URL

# Optional validation
JWT_ISSUER="your-issuer"       # Expected 'iss' claim
JWT_AUDIENCE="your-audience"   # Expected 'aud' claim
```

Generate test keys: `npm run jwt:generate-keys`

### Endpoints

| Method   | Endpoint                      | Description     | Auth |
| -------- | ----------------------------- | --------------- | ---- |
| `GET`    | `/api/v1`                     | API info        | No   |
| `GET`    | `/api/v1/health`              | Health check    | No   |
| `GET`    | `/api/v1/playlists`           | List playlists  | No   |
| `POST`   | `/api/v1/playlists`           | Create playlist | Yes  |
| `GET`    | `/api/v1/playlists/{id}`      | Get playlist    | No   |
| `PUT`    | `/api/v1/playlists/{id}`      | Update playlist | Yes  |
| `DELETE` | `/api/v1/playlists/{id}`      | Delete playlist | Yes  |
| `GET`    | `/api/v1/channels`            | List channels   | No   |
| `POST`   | `/api/v1/channels`            | Create channel  | Yes  |
| `GET`    | `/api/v1/channels/{id}`       | Get channel     | No   |
| `PUT`    | `/api/v1/channels/{id}`       | Update channel  | Yes  |
| `DELETE` | `/api/v1/channels/{id}`       | Delete channel  | Yes  |
| `GET`    | `/api/v1/playlist-items`      | List items      | No   |
| `GET`    | `/api/v1/playlist-items/{id}` | Get item        | No   |

### Examples

**Create Playlist**

```bash
curl -X POST http://localhost:8787/api/v1/playlists \
  -H "Authorization: Bearer YOUR_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "dpVersion": "1.0.0",
    "title": "my-playlist",
    "items": [{
      "source": "https://example.com/art.html",
      "duration": 300,
      "license": "open"
    }]
  }'
```

**List Playlists**

```bash
curl "http://localhost:8787/api/v1/playlists?sort=desc&limit=10"
```

### Async Processing

Add `Prefer: respond-async` header for background processing:

```bash
curl -X POST http://localhost:8787/api/v1/playlists \
  -H "Authorization: Bearer YOUR_API_SECRET" \
  -H "Prefer: respond-async" \
  -H "Content-Type: application/json" \
  -d '{...}'
```

- **Synchronous** (default): Returns `201` after data is persisted
- **Asynchronous**: Returns `202` immediately, queues for background processing

## Development

```bash
# Cloudflare Workers
npm run worker:dev

# Node.js
npm run node:dev

# Tests
npm test
npm run test:api         # Integration tests
npm run benchmark        # Performance tests

# Code quality
npm run validate         # Run all checks
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed setup and [TESTING.md](TESTING.md) for testing guide.

## Documentation

- **[DEVELOPMENT.md](DEVELOPMENT.md)** - Setup, configuration, and project structure
- **[TESTING.md](TESTING.md)** - Testing strategies and benchmarking
- **[OpenAPI Spec](openapi.yaml)** - Full API specification
- **[DP-1 Specification](https://github.com/display-protocol/dp1/blob/main/docs/spec.md)** - Protocol documentation

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Write tests and ensure they pass (`npm run validate`)
4. Commit changes (`git commit -m 'Add amazing feature'`)
5. Push to branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## License

Mozilla Public License 2.0 - See [LICENSE](LICENSE)

Copyright (c) 2025 Feral File
