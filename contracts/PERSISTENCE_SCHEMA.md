# Persistence Schema (DB)

The DB stores only persistent state and overlays. Base dungeon topology is deterministic per chunk.

## Core tables

### users
- user_id (PK)
- google_sub (unique)
- email
- is_admin (bool)
- created_at

### sessions
- session_token (PK, random 256-bit)
- user_id (FK)
- expires_at
- created_at
- last_seen_at

### worlds
- world_id (PK)
- seed
- generator_version
- created_at

### characters
- character_id (PK)
- user_id (FK)
- name
- class_id
- race_id
- level
- hp
- status_json
- has_egg (bool)
- created_at
- last_played_at

### character_position
- character_id (PK)
- world_id (FK)
- level_id
- x
- y
- face
- in_combat (bool)
- last_attacked_at
- stunned (bool)
- immobilized (bool)
- updated_at

## Generation overlays (persistent overrides)

### cell_overrides
Stores per-cell overrides to generated base.
- world_id
- level_id
- x
- y
- override_json
- PRIMARY KEY (world_id, level_id, x, y)

override_json examples:
- forced hub/town adjacency overrides
- special markers

### edge_overrides
Stores per-edge overrides to generated base.
Edges are stored in canonical direction to avoid duplication:
- store only EAST and SOUTH edges per cell (or another canonical scheme).
- world_id
- level_id
- x
- y
- dir ("E" or "S")
- edge_type (wall|open|door_locked|door_unlocked|lever_secret|...)
- lock_state_json (for dynamic lock relationships)
- PRIMARY KEY (world_id, level_id, x, y, dir)

### discovered_cells_global
Global discovery.
- world_id
- level_id
- x
- y
- discovered_at
- PRIMARY KEY (world_id, level_id, x, y)

### player_reveals (future)
Per-player LoS reveal (not global discovery).
- character_id
- world_id
- level_id
- x
- y
- revealed_at
- PRIMARY KEY (character_id, world_id, level_id, x, y)

## Entities (monsters, NPCs, traders)

### entities
- entity_id (PK)
- world_id
- type (player|monster|npc|trader)
- def_id (monster_def_id, npc_def_id, etc.)
- spawn_level_id
- level_id
- x
- y
- hp
- state_json (aggro table, AI state, inventory, timers)
- created_at
- updated_at
- despawn_at (nullable)

Constraints:
- enforce abs(level_id - spawn_level_id) <= 2 for non-epic entities.

## Corpse chests

### corpse_chests
- chest_id (PK)
- world_id
- level_id
- x
- y
- owner_character_id
- created_at
- private_until (created_at + 5 min)
- party_until (created_at + 10 min if party else private_until)
- public_after
- is_removed (bool)

### corpse_chest_items
- chest_id (FK)
- item_id
- qty
- item_meta_json
- PRIMARY KEY (chest_id, item_id, item_meta_json_hash)

Notes:
- Paid temple resurrection removes corpse chest (mark removed, delete items).

## Loot chests (spawned)

### loot_chests
- chest_id (PK)
- world_id
- level_id
- chunk_x
- chunk_y
- x
- y
- depth_tier
- trapped (bool)
- trap_type (nullable)
- state (active|opened)
- opened_at (nullable)
- expires_at (opened_at + 30 min, nullable)
- created_at

### loot_chest_items
- chest_id (FK)
- item_id
- qty
- item_meta_json

## Chunk runtime bookkeeping

### chunk_runtime
Tracks spawn quotas and timing for scheduled checks.
- world_id
- level_id
- chunk_x
- chunk_y
- active_chest_count
- chest_quota
- next_chest_spawn_check_at
- last_activated_at
- PRIMARY KEY (world_id, level_id, chunk_x, chunk_y)

## Bones

### bones_drops
- drop_id (PK)
- world_id
- level_id
- x
- y
- qty
- created_at

Notes:
- Bones are always created on death even if Egg of Sanctuary triggers.
- Bones persist until picked up.

## Party (initial minimal)

### parties
- party_id (PK)
- created_at

### party_members
- party_id
- character_id
- joined_at
- PRIMARY KEY (party_id, character_id)

Party affects:
- corpse visibility window benefits
- shared detection/reveal state (stored in per-party tables if desired)

## Admin authored town

Town is authored via overrides:
- cell_overrides and edge_overrides for level_id=0 define the entire town.
- No procedural generation for level 0.
