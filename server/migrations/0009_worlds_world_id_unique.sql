-- server/migrations/0009_worlds_world_id_unique.sql
-- Ensure worlds.world_id exists and is unique.
-- MUST NOT reference legacy worlds.id (some old variants did and crash on fresh schema).

-- If a legacy DB is missing world_id, add it (benignly skipped if already present).
ALTER TABLE worlds ADD COLUMN world_id TEXT;

-- Enforce uniqueness (benign if already enforced by PK or existing index).
CREATE UNIQUE INDEX IF NOT EXISTS idx_worlds_world_id_unique ON worlds(world_id);