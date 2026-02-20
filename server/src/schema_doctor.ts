import Database from 'better-sqlite3';
import { CONFIG } from './config.js';

function tableInfo(db: Database.Database, table: string) {
  return db.prepare(`PRAGMA table_info(${table})`).all();
}

function requireColumns(db: Database.Database, table: string, cols: string[]) {
  const info: any[] = tableInfo(db, table);
  if (!info.length) throw new Error(`Missing table: ${table}`);
  const have = new Set(info.map((r) => String(r.name)));
  const missing = cols.filter((c) => !have.has(c));
  if (missing.length) {
    throw new Error(`Table ${table} missing columns: ${missing.join(', ')} (have: ${[...have].join(', ')})`);
  }
}

const db = new Database(CONFIG.dbPath);
try {
  requireColumns(db, 'worlds', ['id', 'seed', 'generator_version', 'created_at_ms']);
  requireColumns(db, 'users', ['id', 'email', 'created_at_ms']);
  requireColumns(db, 'characters', ['id','user_id','world_id','name','level_id','x','y','face','created_at_ms','updated_at_ms']);
  requireColumns(db, 'discoveries', ['world_id','level_id','x','y','discovered_at_ms']);
  console.log('schema_doctor: OK');
} finally {
  db.close();
}
