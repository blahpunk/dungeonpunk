-- 0006_character_position.sql
-- Repair: create character_position table expected by code.

CREATE TABLE IF NOT EXISTS character_position (
  character_id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  level_id INTEGER NOT NULL DEFAULT 0,
  x INTEGER NOT NULL DEFAULT 0,
  y INTEGER NOT NULL DEFAULT 0,
  face TEXT NOT NULL DEFAULT 'N',
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_character_position_world ON character_position(world_id);
