-- server/migrations/0008_sessions_missing_cols.sql
-- Repair: add session columns expected by server code (and legacy compat reads).

ALTER TABLE sessions ADD COLUMN session_token TEXT;
ALTER TABLE sessions ADD COLUMN expires_at INTEGER;
ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER;

-- Legacy compat: some code paths look for expires_at_ms too.
ALTER TABLE sessions ADD COLUMN expires_at_ms INTEGER;

CREATE INDEX IF NOT EXISTS idx_sessions_session_token ON sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);