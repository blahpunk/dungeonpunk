# Architecture

This repository implements a multi-user, server-authoritative, grid-based dungeon crawler with infinite sideways expansion per dungeon level, authored town, persistent exploration, and tick-based simulation.

## Core principles (non-negotiable)

1) Server authority
- The server is the sole source of truth for world state, player position, spawns, timers, and persistence.
- Clients send intents (move/turn/interact) and render server state.

2) Deterministic base generation + persistent overlays
- Base terrain/topology is generated deterministically from (world_seed, level_id, chunk_x, chunk_y).
- Persistent changes are stored as overrides and always take precedence.

3) Contract-driven development
- Message protocol, persistence schema, and invariants are treated as sacred contracts.
- Automated tests validate determinism, invariants, and replay stability.

## Coordinate system

- Global cell coordinates: (level_id, x, y)
- Infinite sideways expansion for dungeon levels (level_id >= 1)
- Town is authored (level_id = 0) and not procedurally generated.
- Chunking: 64x64 cells
  - chunk_x = floor_div(x, 64)
  - chunk_y = floor_div(y, 64)

## Levels and hubs

- Each dungeon level has a central hub at fixed coordinates:
  - hub_cell(level_id) = (level_id, 0, 0)
- Distance-to-hub UI uses straight-line (Euclidean) distance on the same level:
  - dist = sqrt(dx^2 + dy^2) * CELL_FEET
- Compass points to the hub vector (dx, dy) in N/E/S/W terms.

## Client views

- Main view: first-person corridor view, facing N/E/S/W, showing up to 3 cells forward.
  - Objects visible up to 2 cells forward (chests/corpses/traps/levers/doors/turns/connectors).
- Minimap: follows player; no manual scrolling.
- Player can turn in place; turning has a small cooldown.

## Module boundaries

- /engine
  - Pure logic: movement rules, visibility rules, generation helpers, simulation rules (no network, no DB).
- /server
  - Auth (Google OAuth -> session), WebSocket gateway, persistence (DB), tick loop and catch-up, rate limiting.
- /client
  - Rendering, input, UI, audio; no world generation logic.

## Security model

- Auth: Google OAuth establishes identity; server issues an opaque session token (DB-backed) for gameplay.
- WebSockets: must authenticate before any game messages.
- Input validation:
  - JSON schema validation for all messages.
  - Reject unknown fields.
  - Payload size limits.
- Anti-spoofing:
  - Server computes positions; client never provides authoritative coordinates.
  - Per-connection sequence numbers (monotonic).
- Rate limiting:
  - Per-session message rate caps.
  - Movement/turn cooldown enforced server-side.
- Deployment:
  - HTTPS/WSS in production.
  - Origin checks for WS and strict CORS for HTTP endpoints.

## Key invariants

I1 Determinism
- generate_chunk(seed, level, cx, cy) must be stable across runs for the same generator_version.

I2 Overlay precedence
- Any stored cell/edge override must override generated base.

I3 Connectivity (core traversal)
- The maze graph within any generated test window is connected, except deliberate secret pockets.
- Secret pockets must have exactly one secret lever edge as their sole exit.

I4 Edge semantics
- Walls/doors/locks/levers live on edges between adjacent cells; cells are floor-space.

I5 Discovery and visibility
- Global discovery: only the cell stepped onto is globally discovered.
- Per-player line-of-sight (later): may reveal along corridors; does not count as discovery.

I6 No silent drift
- Replay of a recorded action log must produce identical state hash.

## Default simulation constants (tunable)

- CHUNK_SIZE: 64
- TICK_RATE_HZ: 4 (default)
- MOVE_COOLDOWN_MS: 500 (2 cells/sec max)
- TURN_COOLDOWN_MS: 150
- ACTIVE_RADIUS_TILES: 24
- DESPAWN_RADIUS_TILES: 18
- DESPAWN_TIME_SEC: 180 (3 min)
- DESPAWN_TIME_KEY_SEC: 300 (5 min)
- EGG_MANUAL_LOCKOUT_AFTER_HIT_SEC: 10
- EGG_MANUAL_CHANNEL_SEC: 3..5 (interruptible)
- CHEST_OPEN_PERSIST_SEC: 1800 (30 min)
- CHEST_SPAWN_CHECK_INTERVAL_SEC: 1800 (30 min)
- CELL_FEET: 5 (default; used only for UI distance; can be changed)
