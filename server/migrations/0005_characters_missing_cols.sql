-- server/migrations/0005_characters_missing_cols.sql
-- Legacy repair migration (no-op).
-- Baseline schema (0001_init.sql) already defines:
-- - characters.character_id (PRIMARY KEY)
-- - characters.hp
-- - characters.last_played_at
-- Any older DB repair logic is no longer required for current schema.

SELECT 1;