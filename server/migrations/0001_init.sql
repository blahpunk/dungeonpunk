-- server/migrations/0001_init.sql
-- Milestone 1 baseline schema (authoritative for current server code).
-- This file MUST exist/enabled so later repair migrations (0002+) have tables to operate on.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS worlds (
  world_id TEXT PRIMARY KEY,
  seed INTEGER NOT NULL,
  generator_version TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  character_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  world_id TEXT NOT NULL,
  name TEXT NOT NULL,

  hp INTEGER NOT NULL DEFAULT 10,
  last_played_at INTEGER,

  level_id INTEGER NOT NULL DEFAULT 1,
  x INTEGER NOT NULL DEFAULT 0,
  y INTEGER NOT NULL DEFAULT 0,
  face TEXT NOT NULL DEFAULT 'N',

  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,

  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_characters_user_id ON characters(user_id);
CREATE INDEX IF NOT EXISTS idx_characters_world_id ON characters(world_id);
CREATE INDEX IF NOT EXISTS idx_characters_last_played_at ON characters(last_played_at);

CREATE TABLE IF NOT EXISTS character_position (
  character_id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  level_id INTEGER NOT NULL DEFAULT 1,
  x INTEGER NOT NULL DEFAULT 0,
  y INTEGER NOT NULL DEFAULT 0,
  face TEXT NOT NULL DEFAULT 'N',
  updated_at_ms INTEGER NOT NULL,

  FOREIGN KEY (character_id) REFERENCES characters(character_id) ON DELETE CASCADE,
  FOREIGN KEY (world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_character_position_world_id ON character_position(world_id);

CREATE TABLE IF NOT EXISTS sessions (
  session_token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,

  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS discovered_cells_global (
  world_id TEXT NOT NULL,
  level_id INTEGER NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  discovered_at_ms INTEGER NOT NULL,
  PRIMARY KEY (world_id, level_id, x, y),
  FOREIGN KEY (world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_discovered_cells_global_world_level
  ON discovered_cells_global(world_id, level_id);

CREATE TABLE IF NOT EXISTS edge_overrides (
  world_id TEXT NOT NULL,
  level_id INTEGER NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  dir TEXT NOT NULL,              -- 'N'|'E'|'S'|'W'

  edge_type TEXT NOT NULL,         -- 'wall'|'open'|'door_locked'|'door_unlocked'|'lever_secret'|...
  lock_state_json TEXT,            -- JSON string

  override_json TEXT,              -- legacy/compat (optional)
  updated_at_ms INTEGER NOT NULL,

  PRIMARY KEY (world_id, level_id, x, y, dir),
  FOREIGN KEY (world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_edge_overrides_world_level_xy
  ON edge_overrides(world_id, level_id, x, y);

CREATE TABLE IF NOT EXISTS cell_overrides (
  world_id TEXT NOT NULL,
  level_id INTEGER NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  override_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (world_id, level_id, x, y),
  FOREIGN KEY (world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cell_overrides_world_level_xy
  ON cell_overrides(world_id, level_id, x, y);