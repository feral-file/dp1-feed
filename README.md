# DP-1 Feed Operator API

[![Build Status](https://img.shields.io/github/actions/workflow/status/feral-file/dp1-feed/test.yaml?branch=main&label=build%20status&logo=github)](https://github.com/feral-file/dp1-feed/actions/workflows/test.yaml)
[![Linter](https://img.shields.io/github/actions/workflow/status/feral-file/dp1-feed/lint.yaml?branch=main&label=linter&logo=github)](https://github.com/feral-file/dp1-feed/actions/workflows/lint.yaml)
[![Code Coverage](https://img.shields.io/codecov/c/github/feral-file/dp1-feed/main?label=code%20coverage&logo=codecov)](https://codecov.io/gh/feral-file/dp1-feed)
[![Benchmark](https://img.shields.io/github/actions/workflow/status/feral-file/dp1-feed/benchmark.yaml?branch=main&label=benchmark%20status&logo=github)](https://github.com/feral-file/dp1-feed/actions/workflows/benchmark.yaml)

Open-source reference implementation of a DP-1 feed operator API.

- It implements operator-side API behavior for creating, signing, storing, and serving playlists/channels.
- It is not the same thing as Feral File's hosted production feed service.
- It can run in two deployment modes: Cloudflare Workers or self-hosted Node.js.

## Canonical Entry Points

- `openapi.yaml` - API surface and request/response contracts in this repo.
- [display-protocol/dp1](https://github.com/display-protocol/dp1) - canonical DP-1 protocol spec source.
- [docs.feralfile.com](https://docs.feralfile.com) - guided integration and operator usage paths.

## Compatibility Note (Current, Legacy, Transitional, Unverified)

The DP-1 protocol and ecosystem are in a transition period. This repo intentionally states compatibility status plainly.

| Status                | Meaning in this repo                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Canonical**         | DP-1 spec canonical source is `display-protocol/dp1` and currently states **v1.1.0**.                                                                                                                   |
| **Current here**      | This operator API, `openapi.yaml`, and first-run examples are centered on the currently implemented API behavior in this repo. In request examples, `dpVersion: "1.0.0"` remains the explicit baseline. |
| **Legacy-compatible** | Legacy naming still accepted where documented (for example `playlist-group` query compatibility and `/api/v1/playlist-groups` endpoint).                                                                |
| **Transitional**      | Some adjacent tools/examples in the wider ecosystem still center 1.0.x conventions. This repo keeps those paths visible where they are actively implemented.                                            |
| **Unverified**        | End-to-end parity claims for all DP-1 v1.1.0 semantics are **not** made here unless specifically validated in this repo.                                                                                |

If protocol truth and this implementation diverge, protocol truth lives in `display-protocol/dp1`, and implementation notes should be updated here with explicit status.

## Deployment Choices

### Option A: Self-hosted Node.js (quickest local path)

This is the most direct local operator quickstart in this repo because `docker-compose.yml` and `.env.sample` already provide runnable defaults.

Prerequisites:

- Node.js 22+
- Docker + Docker Compose

Run:

```bash
npm install
docker compose up -d
```

The API is served at `http://localhost:8787`.

### Option B: Cloudflare Workers

Prerequisites:

- Node.js 22+
- Wrangler CLI
- Cloudflare account
- KV namespaces and queue setup
- required secrets: `API_SECRET`, `ED25519_PRIVATE_KEY` (and optionally JWT settings)

Run:

```bash
npm install
npm run worker:setup:kv
npm run worker:setup:secrets
npm run worker:setup:queues:dev
npm run worker:dev
```

## First Run: Build Trust in 3 Calls

Write operations require auth (`Authorization: Bearer <API_SECRET or JWT>`). Read operations are public.

```bash
# 1) Health check (no auth)
curl http://localhost:8787/api/v1/health

# 2) Create a minimal playlist (auth required)
curl -X POST http://localhost:8787/api/v1/playlists \
  -H "Authorization: Bearer dev-api-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "dpVersion": "1.0.0",
    "title": "minimal-playlist",
    "items": [
      {
        "source": "https://example.com/artwork.html",
        "duration": 300,
        "license": "open"
      }
    ]
  }'

# 3) Fetch it back (replace <playlist-id-or-slug>)
curl http://localhost:8787/api/v1/playlists/<playlist-id-or-slug>
```

## Operator Responsibilities in This Repo

- Deploy runtime (`worker.ts` or `server.ts` path).
- Configure secrets/auth (`API_SECRET`, `ED25519_PRIVATE_KEY`, optional JWT settings).
- Accept and validate DP-1 payloads (`openapi.yaml` + Zod/ff-dp1-js validation paths).
- Sign playlists/channels server-side with Ed25519 before persistence.
- Serve read APIs and write APIs (sync by default, optional `Prefer: respond-async`).

## Hosted vs Run-Your-Own References

- Hosted Feral feed usage guidance: use `docs.feralfile.com`.
- Run-your-own operator behavior and deployment: this repository.

## API Surface

See `openapi.yaml` for complete endpoint definitions and schemas.

Key routes:

- `GET /api/v1`, `GET /api/v1/health`
- `GET/POST /api/v1/playlists`, `GET/PUT/PATCH/DELETE /api/v1/playlists/{id}`
- `GET/POST /api/v1/channels`, `GET/PUT/PATCH/DELETE /api/v1/channels/{id}`
- `GET /api/v1/playlist-items`, `GET /api/v1/playlist-items/{id}`
- Legacy compatibility: `GET /api/v1/playlist-groups`
- Self-hosted queue processing endpoints: `/queues/process-message`, `/queues/process-batch`

## Development and Testing

- Development setup: [DEVELOPMENT.md](DEVELOPMENT.md)
- Testing and benchmarks: [TESTING.md](TESTING.md)
- Protocol spec source: [display-protocol/dp1](https://github.com/display-protocol/dp1/blob/main/docs/spec.md)

## License

Mozilla Public License 2.0 - See [LICENSE](LICENSE)

Copyright (c) 2025 Feral File
