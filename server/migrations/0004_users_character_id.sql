-- 0004_users_character_id.sql
-- Repair: add users.character_id (code expects it in dev login flows).

ALTER TABLE users ADD COLUMN character_id TEXT;
