# Protocol (WebSocket + HTTP)

All gameplay state is server-authoritative.

## Authentication

### OAuth bootstrap (HTTP)
- Google OAuth completes in browser.
- Server verifies Google identity and maps to a local user_id.
- Server issues an opaque session token (DB-backed) with expiry.

### Session token usage
- Stored as HttpOnly secure cookie OR returned to client for explicit WS auth message.
- WebSocket must be authenticated before any gameplay messages.

## WebSocket messages

All messages have:
- type: string
- seq: integer (client->server only; must be strictly increasing per connection)
- payload: object

Server rejects:
- unauthenticated messages (except AUTH)
- invalid schema / unknown fields
- non-monotonic seq
- rate-limit violations

### Client -> Server

#### AUTH
- type: "auth"
- payload:
  - session_token: string (if not using HttpOnly cookie)

#### JOIN_WORLD
- type: "join_world"
- payload:
  - world_id: string (or "default")

#### MOVE
- type: "move"
- payload:
  - dir: "N"|"E"|"S"|"W"

#### TURN
- type: "turn"
- payload:
  - face: "N"|"E"|"S"|"W"

#### INTERACT
- type: "interact"
- payload:
  - action: string
  - target: object (context-specific; e.g., ladder, chute, lever, chest)

#### USE_EGG
- type: "use_egg"
- payload: {}

### Server -> Client

#### AUTH_OK / AUTH_ERR
- type: "auth_ok"
  - payload:
    - user_id: string
    - character_id: string (active)
    - world_id: string
- type: "auth_err"
  - payload: { reason: string }

#### WORLD_STATE (initial snapshot)
- type: "world_state"
- payload:
  - now: unix_ms
  - you:
    - level: int
    - x: int
    - y: int
    - face: "N"|"E"|"S"|"W"
    - hp: int
    - status: list
  - hub:
    - level: int
    - x: int
    - y: int
    - dist_feet: int
    - direction: "N"|"E"|"S"|"W"|"..."
  - visible_cells:
    - list of cells (view cone depth 3) with edge info and objects
  - minimap_patch:
    - discovered cells in a radius window around player (global discovered)
  - nearby_entities:
    - other players in interest radius (optional)

#### ACTION_RESULT
- type: "action_result"
- payload:
  - ok: boolean
  - reason?: string
  - you?: updated player state (level/x/y/face/hp/status)
  - deltas?: map/objects/nearby entities changes

#### EVENT
- type: "event"
- payload:
  - kind: string (e.g., "player_moved", "corpse_created", "chest_opened")
  - data: object

## Cooldowns and rate limits (server enforced)

- Move: max 2 moves/sec (MOVE_COOLDOWN_MS=500)
- Turn: TURN_COOLDOWN_MS=150
- Egg manual use restrictions enforced server-side:
  - no combat; not attacked in last 10s; not stunned/immobilized; channel 3-5s interruptible

## Interest management

- Server sends updates for:
  - view-cone cells (depth 3)
  - minimap discovered patch around player
  - nearby players within interest radius (optional, scalable)

## Validation

- All messages are schema-validated.
- Unknown fields are rejected.
- Payload size limits apply.
