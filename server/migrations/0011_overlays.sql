-- server/migrations/0011_overlays.sql
-- Legacy repair migration (no-op).
-- Baseline schema (0001_init.sql) already defines:
-- - edge_overrides (with edge_type, lock_state_json, override_json, updated_at_ms)
-- - cell_overrides
-- and uses worlds.world_id (NOT worlds.id).

SELECT 1;