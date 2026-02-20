-- 0003_users_user_id.sql
-- Legacy repair migration (no-op).
-- Baseline schema (0001_init.sql) already defines users.user_id as the primary key.
-- Older databases may have required backfill from users.id, but that schema is no longer used.

SELECT 1;