-- server/migrations/0008_sessions_missing_cols.sql
-- Repair: ensure legacy compat column exists (schema_audit expects it in some branches).

ALTER TABLE sessions ADD COLUMN expires_at_ms INTEGER;