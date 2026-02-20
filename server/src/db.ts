import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { CONFIG } from './config.js';

export type Db = Database.Database;

/**
 * Opens the SQLite database (creates file if missing) and runs migrations.
 * If dbFilePath is omitted, uses CONFIG.dbPath.
 */
export function openDb(dbFilePath?: string): Db {
  const resolvedPath = dbFilePath ?? CONFIG.dbPath;

  // Ensure parent directory exists (relative paths are relative to server/ workspace cwd)
  const dir = path.dirname(resolvedPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/**
 * Very small migration runner:
 * - reads ./migrations/*.sql (server/migrations)
 * - fallback: ./src/migrations/*.sql (server/src/migrations)
 * - executes them in filename order
 * - records applied migrations in _migrations table
 *
 * IMPORTANT:
 * - Executes SQL statement-by-statement so one harmless statement doesn't kill the whole migration.
 * - Ignores known-idempotent errors (duplicate column / index already exists).
 */
export function runMigrations(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at_ms INTEGER NOT NULL
    );
  `);

  const candidates = [
    // server/migrations/
    fileURLToPath(new URL('../migrations/', import.meta.url)),
    // server/src/migrations/
    fileURLToPath(new URL('./migrations/', import.meta.url))
  ];

  const migrationsDirPath = candidates.find((p) => fs.existsSync(p));
  if (!migrationsDirPath) return;

  const files = fs
    .readdirSync(migrationsDirPath)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const applied = new Set<string>(
    db.prepare(`SELECT id FROM _migrations`).all().map((r: any) => String(r.id))
  );

  const insert = db.prepare(`INSERT INTO _migrations (id, applied_at_ms) VALUES (?, ?)`);

  const splitStatements = (sql: string): string[] => {
    // Simple splitter: good enough for our migrations (no complex BEGIN...END blocks).
    // Strips line comments, keeps semicolons as delimiters.
    const lines = sql
      .split('\n')
      .map((l) => l.replace(/--.*$/g, ''))
      .join('\n');

    return lines
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  };

  const isIgnorable = (errMsg: string, stmt: string): boolean => {
    const msg = errMsg.toLowerCase();
    const s = stmt.trim().toLowerCase();

    // Idempotent ADD COLUMN
    if (msg.includes('duplicate column name')) return true;

    // Idempotent CREATE INDEX / CREATE TABLE
    if (msg.includes('already exists')) return true;

    // If an index references a column that doesn't exist in an older schema,
    // treat it as ignorable *only* for CREATE INDEX statements.
    if (msg.includes('no such column') && s.startsWith('create index')) return true;

    return false;
  };

  for (const file of files) {
    if (applied.has(file)) continue;

    const fullPath = path.join(migrationsDirPath, file);
    const sql = fs.readFileSync(fullPath, 'utf8');
    const statements = splitStatements(sql);

    const tx = db.transaction(() => {
      console.log(`[migrations] applying ${file}`);

      for (const stmt of statements) {
        try {
          db.exec(stmt + ';');
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          if (isIgnorable(msg, stmt)) {
            console.log(`[migrations] skip benign: ${msg}`);
            continue;
          }
          console.log(`[migrations] FAILED in ${file}: ${msg}`);
          throw e;
        }
      }

      insert.run(file, Date.now());
    });

    tx();
  }
}
