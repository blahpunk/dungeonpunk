-- server/migrations/0009_discovery_cells.sql
-- Creates global discovered-cells table used by DbDiscoveryProvider.

CREATE TABLE IF NOT EXISTS discovered_cells_global (
  world_id TEXT NOT NULL,
  level_id INTEGER NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  discovered_at_ms INTEGER NOT NULL,
  PRIMARY KEY (world_id, level_id, x, y),
  FOREIGN KEY (world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_discovered_cells_world_level
  ON discovered_cells_global(world_id, level_id);

CREATE INDEX IF NOT EXISTS idx_discovered_cells_world_level_xy
  ON discovered_cells_global(world_id, level_id, x, y);