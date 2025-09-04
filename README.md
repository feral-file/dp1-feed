# DP-1 Feed Operator API

[![Build Status](https://img.shields.io/github/actions/workflow/status/display-protocol/dp1-feed/test.yaml?branch=main&label=build%20status&logo=github)](https://github.com/display-protocol/dp1-feed/actions/workflows/test.yaml)
[![Linter](https://img.shields.io/github/actions/workflow/status/display-protocol/dp1-feed/lint.yaml?branch=main&label=linter&logo=github)](https://github.com/display-protocol/dp1-feed/actions/workflows/lint.yaml)
[![Code Coverage](https://img.shields.io/codecov/c/github/display-protocol/dp1-feed/main?label=code%20coverage&logo=codecov)](https://codecov.io/gh/display-protocol/dp1-feed)
[![Benchmark](https://img.shields.io/github/actions/workflow/status/display-protocol/dp1-feed/benchmark.yaml?branch=main&label=benchmark%20status&logo=github)](https://github.com/display-protocol/dp1-feed/actions/workflows/benchmark.yaml)

A modern API server implementing the DP-1 Feed Operator specification for blockchain-native digital art playlists. Supports both **Cloudflare Workers** (serverless) and **Node.js** (self-hosted) deployments.

## 🚀 Features

- **DP-1 Compliant**: Full OpenAPI 3.1.0 implementation of DP-1 v1.0.0
- **Dual Deployment**: Cloudflare Workers (serverless) + Node.js (self-hosted)
- **Type Safety**: End-to-end TypeScript with Zod validation
- **Modern Stack**: Hono framework, Ed25519 signatures, async processing
- **Production Ready**: KV storage, queues, authentication, CORS, monitoring

## 📦 Quick Start

### Prerequisites

- Node.js 22+
- npm or yarn
- For Cloudflare Workers: Cloudflare account + Wrangler CLI
- For Node.js: etcd + NATS JetStream

### Installation

```bash
git clone https://github.com/display-protocol/dp1-feed.git
cd dp1-feed
npm install
```

### Quick Deploy

**Cloudflare Workers:**

```bash
npm run worker:setup:kv
npm run worker:setup:secrets
npm run worker:deploy
```

**Node.js Server:**

```bash
npm run node:build
npm run node:start:dev
```

## 🛠️ Development

```bash
# Cloudflare Workers development
npm run worker:dev

# Node.js development
npm run node:dev

# Run tests
npm test

# Code quality
npm run lint && npm run format
```

📖 **For detailed development guide, see [DEVELOPMENT.md](DEVELOPMENT.md)**

## 📡 API Reference

### Base URL

- **Cloudflare Workers**: `https://your-worker.your-subdomain.workers.dev`
- **Node.js**: `http://localhost:8787` (default)

### Authentication

All write operations require Bearer token authentication:

```bash
Authorization: Bearer YOUR_API_SECRET
```

### Core Endpoints

| Method | Endpoint                      | Description     | Auth Required |
| ------ | ----------------------------- | --------------- | ------------- |
| `GET`  | `/api/v1`                     | API information | No            |
| `GET`  | `/api/v1/health`              | Health check    | No            |
| `GET`  | `/api/v1/playlists`           | List playlists  | No            |
| `GET`  | `/api/v1/playlists/{id}`      | Get playlist    | No            |
| `POST` | `/api/v1/playlists`           | Create playlist | Yes           |
| `PUT`  | `/api/v1/playlists/{id}`      | Update playlist | Yes           |
| `GET`  | `/api/v1/playlist-items`      | List items      | No            |
| `GET`  | `/api/v1/playlist-items/{id}` | Get item        | No            |

### Example Requests

#### Create Playlist

```bash
curl -X POST https://your-api.workers.dev/api/v1/playlists \
  -H "Authorization: Bearer YOUR_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "dpVersion": "1.0.0",
    "title": "my-first-playlist",
    "items": [
      {
        "source": "https://example.com/art.html",
        "duration": 300,
        "license": "open"
      }
    ]
  }'
```

#### Get Playlists

```bash
curl -X GET "https://your-api.workers.dev/api/v1/playlists?sort=desc&limit=10"
```

#### Health Check

```bash
curl -X GET https://your-api.workers.dev/api/v1/health
```

### Response Format

**Success Response:**

```json
{
  "dpVersion": "1.0.0",
  "id": "playlist-id",
  "items": [...],
  "signature": "ed25519-signature",
  "created": "2024-01-15T14:30:00.000Z"
}
```

**Error Response:**

```json
{
  "error": "validation_error",
  "message": "Invalid playlist data: items.0.duration: Expected number, received string"
}
```

### Error Codes

| Code  | Description                          |
| ----- | ------------------------------------ |
| `400` | Bad Request (validation error)       |
| `401` | Unauthorized (missing/invalid token) |
| `404` | Not Found                            |
| `500` | Internal Server Error                |

## 🧪 Testing

```bash
# Unit tests
npm test

# Integration tests
npm run test:api

# Performance benchmarks
npm run benchmark

# Coverage report
npm run test:coverage
```

📖 **For detailed testing guide, see [TESTING.md](TESTING.md)**

## 📚 Documentation

- **[DEVELOPMENT.md](DEVELOPMENT.md)** - Local development setup and project structure
- **[TESTING.md](TESTING.md)** - Testing strategies and performance benchmarking
- **[k6/README.md](k6/README.md)** - Performance testing with K6

## 🔗 References

- [DP-1 Specification](https://github.com/display-protocol/dp1/blob/main/docs/spec.md)
- [OpenAPI Schema](https://github.com/display-protocol/dp1/blob/main/docs/feed-api.yaml)
- [Hono Framework](https://hono.dev/)
- [Zod Validation](https://zod.dev/)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with proper TypeScript types
4. Add Zod validation for new fields
5. Update tests and documentation
6. Run validation: `npm run validate`
7. Submit a pull request

### Code Standards

- **TypeScript**: Strict mode with comprehensive typing
- **Zod Schemas**: All API inputs must be validated
- **ESLint + Prettier**: Consistent code formatting
- **DP-1 Compliance**: Maintain DP-1 specification compliance

## 📄 License

Mozilla Public License 2.0

Copyright (c) 2025 Feral File

---

**Built with ❤️ by Feral File for the DP-1 ecosystem.**
