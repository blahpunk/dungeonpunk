# Infinite Dungeon (Milestone 1 scaffold)

This repo follows `ARCHITECTURE.md` contracts: server-authoritative state, deterministic generation + persistent overlays, and contract-driven tests.

## Requirements

- Node.js 20+
- npm 10+

### If `better-sqlite3` fails to install

On Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y build-essential python3
```

Then retry `npm install`.

## Quick start (development)

```bash
cd dungeon_crawler
npm install
npm run test
npm run dev
```

Then open:
- Client: http://localhost:5173

### Dev login

This milestone includes a **development-only** auth endpoint to mint a session token:

- Visit: http://localhost:5173
- Enter any email, click **Dev Login**

This creates a local user + session token in SQLite. Production Google OAuth wiring comes later.

## What is implemented in this scaffold

- Deterministic 64x64 chunk maze generation (engine)
- Server-authoritative move/turn with cooldown enforcement
- Global discovery: only stepped-on cells become discovered
- Main view cone (depth 3) + minimap patch
- WebSocket protocol basics (auth, join_world, move, turn)
- Tests:
  - generator determinism (same inputs => same outputs)
  - replay stability (action log => same state hash)

## Repo layout

- `engine/` pure logic (no DB, no network)
- `server/` WebSocket + persistence + tick/catch-up shell
- `client/` minimal UI renderer
- `contracts/` copies of your foundation docs

