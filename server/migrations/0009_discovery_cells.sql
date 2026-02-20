-- server/migrations/0009_discovery_cells.sql
-- Legacy repair migration (no-op).
-- Baseline schema (0001_init.sql) already defines discovered_cells_global
-- and uses worlds.world_id (NOT worlds.id).

SELECT 1;