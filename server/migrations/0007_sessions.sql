-- server/migrations/0007_sessions.sql
-- Legacy repair migration (no-op).
-- Baseline schema (0001_init.sql) already defines sessions with:
-- - session_token (PRIMARY KEY)
-- - user_id (FK -> users.user_id)
-- - created_at_ms, expires_at, last_seen_at
--
-- Keeping this file avoids older branches that expect it by name/order.

SELECT 1;