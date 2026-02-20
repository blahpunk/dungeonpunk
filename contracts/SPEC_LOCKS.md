# SPEC_LOCKS.md — Locking Contract (Doors vs Chests)

This appendix is the authoritative contract for lock behavior. If any other document conflicts with this, this document wins.

## Scope

Applies to:
- Door edges (between adjacent cells)
- Loot chests (spawned containers)
- Corpse chests are never locked (not in scope)

Lock state is always **global**.

---

## Common concepts

### Lock state
- `locked = true|false`

### Lock difficulty
- `lock_difficulty: int`
- Lockpicking succeeds iff `player_lockpick_skill >= lock_difficulty`.

### Key-monster linkage
Some locks are associated with a single key-monster instance.
- `key_monster_entity_id: nullable`
- When present, the key-monster is considered the “key holder.”

### Time and despawn
Key-monsters may despawn via simulation rules (no players nearby for long enough).

### Canonical actions
- `LOCKPICK(target)`
- `KILL(monster)`
- `DESPAWN(monster)`
- `OPEN(target)`
- `TRAVERSE(door_edge)`

---

## Door locks (edges)

### Persisted fields

For each door edge (stored in `edge_overrides.lock_state_json` or equivalent):

- `locked: bool`
- `lock_difficulty: int`
- `key_monster_entity_id: nullable`
- `default_state_on_reset: "unlocked"` (required for doors)

Notes:
- Doors only have locked/unlocked state; no open/close state.
- The key-monster may traverse a locked door edge even when players cannot.

### Transitions (doors)

**D1 — Lockpick unlock**
- Pre: `locked=true` AND `player_lockpick_skill >= lock_difficulty`
- Action: `LOCKPICK(door)`
- Post: `locked=false`

**D2 — Key-monster death unlock**
- Pre: `locked=true` AND `key_monster_entity_id == monster_id`
- Event: `KILL(monster_id)`
- Post: `locked=false`

**D3 — Key-monster despawn reset unlock**
- Pre: `locked=true` AND `key_monster_entity_id == monster_id`
- Event: `DESPAWN(monster_id)`
- Post: `locked=false` (reset to `default_state_on_reset`)

**D4 — Traverse rule**
- If `locked=true`: players cannot traverse; key-monster may traverse.
- If `locked=false`: players may traverse.

### Events (doors)

Server emits:
- `door_lock_state_changed` with:
  - `level_id, x, y, dir`
  - `locked`
  - `reason: "lockpicked"|"key_monster_killed"|"key_monster_despawned"|"admin_override"`

---

## Chest locks (loot chests)

### Persisted fields

For each loot chest (stored in `loot_chests`):

- `locked: bool`
- `lock_difficulty: int`
- `key_monster_entity_id: nullable`

Notes:
- Chests may be locked/unlocked.
- Chests do **not** auto-unlock on key-monster despawn.
- Chests can always be lockpicked given sufficient skill.
- Chest lock difficulty scales with dungeon depth (implementation detail outside this contract).

### Transitions (chests)

**C1 — Lockpick unlock**
- Pre: `locked=true` AND `player_lockpick_skill >= lock_difficulty`
- Action: `LOCKPICK(chest)`
- Post: `locked=false`

**C2 — Key-monster death unlock**
- Pre: `locked=true` AND `key_monster_entity_id == monster_id`
- Event: `KILL(monster_id)`
- Post: `locked=false`

**C3 — Key-monster despawn has no effect**
- Pre: `locked=true` AND `key_monster_entity_id == monster_id`
- Event: `DESPAWN(monster_id)`
- Post: `locked=true` (no change)

**C4 — Open rule**
- If `locked=true`: `OPEN(chest)` is denied.
- If `locked=false`: `OPEN(chest)` proceeds to chest opening logic.

### Events (chests)

Server emits:
- `chest_lock_state_changed` with:
  - `chest_id`
  - `locked`
  - `reason: "lockpicked"|"key_monster_killed"|"admin_override"`

---

## Validation rules (server-authoritative)

### V1 — Client cannot force unlock
Clients never send `locked=false` or any direct state mutation. They only send intents:
- `interact/open`
- `interact/lockpick`
- `attack`

### V2 — Lockpick is checked server-side
Server validates:
- target exists and is in interact range / visibility rules
- target is lockpickable (always true for doors+loot chests)
- `player_lockpick_skill >= lock_difficulty`
- any additional restrictions (e.g., in-combat restrictions if later added) must be server-enforced

### V3 — Key-monster linkage is one-to-one
- A lock can reference at most one `key_monster_entity_id`.
- A key-monster may be referenced by multiple locks (allowed), but should be rare by design.

### V4 — Global state
When a door/chest unlocks, it unlocks for everyone.

---

## Admin overrides

Admin edits may set:
- `locked` state
- `lock_difficulty`
- `key_monster_entity_id` (including null)

Admin changes emit the corresponding `*_lock_state_changed` event with `reason="admin_override"`.

---

## Compatibility notes

- This contract is compatible with:
  - dynamic door locks that reset on key-monster despawn
  - persistent chest locks that do not reset on despawn
  - universal lockpicking for doors and chests
  - global lock state

Any future feature (e.g., lock breakage, master keys, persistent curses) must not violate the transitions above unless this appendix is updated.
