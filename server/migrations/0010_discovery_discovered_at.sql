-- 0010_discovery_discovered_at.sql
-- Repair: code expects discovered_cells_global.discovered_at

ALTER TABLE discovered_cells_global ADD COLUMN discovered_at INTEGER NOT NULL DEFAULT 0;

-- Backfill if old column exists (safe no-op if it doesn't).
UPDATE discovered_cells_global
SET discovered_at = COALESCE(discovered_at, discovered_at_ms, 0);
