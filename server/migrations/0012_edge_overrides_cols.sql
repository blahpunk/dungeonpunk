-- 0012_edge_overrides_cols.sql
-- Bring edge_overrides schema in line with server/src/overlays.ts expectations.

ALTER TABLE edge_overrides ADD COLUMN edge_type TEXT;
ALTER TABLE edge_overrides ADD COLUMN lock_state_json TEXT;

-- Optional backfill from override_json if you ever used it.
-- If override_json is a JSON object like { "edge_type": "...", "lock_state_json": {...} }
-- this copies edge_type; lock_state_json stays as TEXT (stringified JSON) if present.
UPDATE edge_overrides
SET edge_type = COALESCE(edge_type, json_extract(override_json, '$.edge_type'))
WHERE override_json IS NOT NULL AND edge_type IS NULL;

UPDATE edge_overrides
SET lock_state_json = COALESCE(lock_state_json, json_extract(override_json, '$.lock_state_json'))
WHERE override_json IS NOT NULL AND lock_state_json IS NULL;
