# SQLite Backend for dp1-feed — Progress Report

## Goal

Add SQLite as a third storage/queue backend alongside Cloudflare KV and etcd/NATS.
Single-process, zero-dependency deployment for silo.aesthetic.computer.

## Status: ALL TESTS PASSING, CRUD VERIFIED

## Files Created

- `storage/sqlite-kv.ts` — SqliteKVStorage + SqliteStorageProvider (KeyValueStorage interface)
- `queue/sqlite-queue.ts` — SqliteQueue + SqliteQueueProvider (Queue interface, in-process polling)
- `env/sqlite.ts` — SqliteBindings interface + initializeSqliteEnv()
- `middleware/env-sqlite.ts` — Hono middleware for SQLite env
- `server-sqlite.ts` — Standalone entry point for SQLite mode
- `docker-compose.sqlite.yml` — Single-service compose (just dp1-server, no etcd/NATS)

## Files Modified

- `package.json` — added better-sqlite3 dep, sqlite:dev/start/build scripts, export
- `env/types.ts` — added SqliteBindings to union type
- `Dockerfile.server` — added python3/make/g++ for native addon, sqlite:build step, /app/data volume

## Test Results

- 550 existing tests: ALL PASSING (zero regressions)
- Manual CRUD test: CREATE, READ (by ID + slug), LIST, UPDATE (PATCH), DELETE all working
- Health endpoint reports: `{"environment":"sqlite","runtime":"node.js"}`
- esbuild bundle: 210KB (server-sqlite.js)

## Architecture

```
Before (4 containers):           After (1 process):
+------------+ +------+         +---------------------+
|   etcd     | | NATS |         |   dp1-server        |
+-----+------+ +--+---+         |                     |
      |           |              |  Hono API           |
+-----+-----------+----+         |  SQLite storage     |
|   dp1-server         |         |  SQLite queue       |
+----------------------+         |  In-process consumer|
+----------------------+         +---------------------+
|   dp1-consumer       |            single file: dp1-feed.db
+----------------------+
```

## How to Run

```bash
# Development (hot reload)
npm run sqlite:dev

# Production build
npm run sqlite:build
npm run sqlite:start

# Docker
docker compose -f docker-compose.sqlite.yml up --build
```

## Key Decisions

- better-sqlite3 chosen for sync API (prepared statements, transactions)
- WAL mode enabled for concurrent read performance
- Queue uses SQLite table + in-process polling (calls /queues/process-message like NATS consumer)
- Singleton pattern for providers (shared across requests, created once)
- Separate server-sqlite.ts entry point (not modifying server.ts)

## Next Steps

- [ ] Write SQLite-specific unit tests (storage/sqlite-kv.test.ts, queue/sqlite-queue.test.ts)
- [ ] Add .env.sqlite.sample with minimal config
- [ ] Consider: should `app.ts` detect sqlite mode for /api/v1 deployment field?
- [ ] PR to feral-file/dp1-feed (not yet — commits only for now)
