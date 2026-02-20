#!/usr/bin/env bash
# scripts/wipemyass.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT_DIR/server"
DB_PATH="$SERVER_DIR/data/dev.sqlite3"

echo "=== Dungeon Reset Script ==="
echo "Project root:  $ROOT_DIR"
echo "Server dir:    $SERVER_DIR"
echo "Database path: $DB_PATH"
echo

read -r -p "This will permanently erase the dungeon and all player data. Type 'WIPE' to continue: " CONFIRM
if [ "${CONFIRM:-}" != "WIPE" ]; then
  echo "Aborted."
  exit 1
fi

echo
echo "Stopping any running server is recommended before wiping."
echo

rm -f -- "$DB_PATH" "${DB_PATH}-wal" "${DB_PATH}-shm"

echo "Database files removed (if they existed)."
echo
echo "Recreating clean schema via server migrations..."
echo

cd "$ROOT_DIR"

DB_PATH="$DB_PATH" npx --yes tsx -e "
import { openDb } from './server/src/db.ts';
const db = openDb(process.env.DB_PATH);
db.close();
console.log('Schema initialized via migrations at DB_PATH=' + process.env.DB_PATH);
"

echo
echo "Verifying required tables exist..."
sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;" | sed 's/^/  - /'

REQUIRED_TABLES=(worlds users characters character_position sessions _migrations discovered_cells_global edge_overrides cell_overrides)
MISSING=0

for t in "${REQUIRED_TABLES[@]}"; do
  if ! sqlite3 "$DB_PATH" "SELECT 1 FROM sqlite_master WHERE type='table' AND name='$t' LIMIT 1;" | grep -q 1; then
    echo "ERROR: missing table: $t"
    MISSING=1
  fi
done

if [ "$MISSING" -ne 0 ]; then
  echo
  echo "WIPE FAILED: schema did not fully initialize."
  echo "Fix migrations before proceeding."
  exit 1
fi

echo
echo "Optional: schema audit:"
DB_PATH="$DB_PATH" npm -w server run schema:audit || true

echo
echo "=== WIPE COMPLETE ==="
echo "Next:"
echo "  1) Start server:"
echo "     HTTP_ORIGINS=\"http://<your-lan-ip>:5173,http://localhost:5173\" npm -w server run dev"
echo
echo "  2) Start client (vite):"
echo "     npm -w client run dev -- --host 0.0.0.0 --port 5173 --strictPort"