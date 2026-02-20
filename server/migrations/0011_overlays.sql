-- server/migrations/0011_overlays.sql
-- Overlays: admin/world edits (walls/doors/levers/chests/etc).

CREATE TABLE IF NOT EXISTS edge_overrides (
  world_id TEXT NOT NULL,
  level_id INTEGER NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  dir TEXT NOT NULL,
  override_json TEXT NOT NULL,
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