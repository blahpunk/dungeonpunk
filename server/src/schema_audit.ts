import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { CONFIG } from './config.js';

type TableCols = Record<string, Set<string>>;

function loadDbSchema(dbPath: string): TableCols {
  const db = new Database(dbPath);
  try {
    const tables: { name: string }[] = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as any;

    const schema: TableCols = {};
    for (const t of tables) {
      const cols = db.prepare(`PRAGMA table_info(${t.name})`).all() as any[];
      schema[t.name] = new Set(cols.map((c) => String(c.name)));
    }
    return schema;
  } finally {
    db.close();
  }
}

function collectSqlExpectations(srcDir: string): Record<string, Set<string>> {
  const expects: Record<string, Set<string>> = {};

  const files: string[] = [];
  function walk(d: string) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && p.endsWith('.ts')) files.push(p);
    }
  }
  walk(srcDir);

  const insertRe = /INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]+)\)/gi;
  const selectRe = /SELECT\s+([^;]+?)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;

  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');

    let m: RegExpExecArray | null;

    while ((m = insertRe.exec(txt))) {
      const table = m[1];
      const cols = m[2].split(',').map((s) => s.trim().replace(/[`"'[\]]/g, ''));
      expects[table] ||= new Set();
      cols.forEach((c) => expects[table].add(c));
    }

    while ((m = selectRe.exec(txt))) {
      const table = m[2];
      const colsPart = m[1]
        .replace(/\s+/g, ' ')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && !s.includes('(') && !s.includes('*') && !s.toLowerCase().includes(' as '));

      expects[table] ||= new Set();
      colsPart.forEach((c) => {
        const col = c.includes('.') ? c.split('.').pop()!.trim() : c;
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) expects[table].add(col);
      });
    }
  }

  return expects;
}

const schema = loadDbSchema(CONFIG.dbPath);
const expects = collectSqlExpectations(path.join(process.cwd(), 'src'));

console.log('DB PATH:', CONFIG.dbPath);

console.log('\n=== MISMATCHES (code expects columns missing in DB) ===');
let any = false;
for (const [t, cols] of Object.entries(expects)) {
  if (t === 'sqlite_master') continue;
  const have = schema[t];
  if (!have) {
    any = true;
    console.log(`- table missing: ${t}`);
    continue;
  }
  const missing = [...cols].filter((c) => !have.has(c));
  if (missing.length) {
    any = true;
    console.log(`- ${t} missing: ${missing.sort().join(', ')}`);
  }
}
if (!any) console.log('OK: no missing columns detected by this audit.');
