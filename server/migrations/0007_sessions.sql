-- server/migrations/0007_sessions.sql
-- Legacy/compat no-op.
-- Baseline schema (0001_init.sql) already creates sessions with:
--   session_token, user_id, created_at_ms, expires_at, last_seen_at

SELECT 1;