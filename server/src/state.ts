// server/src/state.ts
import type { DB } from './db.js';

function hasColumn(db: DB, table: string, col: string): boolean {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    return rows.some((r) => String(r.name) === col);
  } catch {
    return false;
  }
}

// Some branches call this from ws.ts; make it a harmless shim.
export function makeState() {
  return {};
}

export function loadSession(db: DB, sessionToken: string): { ok: boolean; userId?: string } {
  const hasSessionToken = hasColumn(db, 'sessions', 'session_token');
  const tokenCol = hasSessionToken ? 'session_token' : 'token';

  const row = db
    .prepare(`SELECT user_id, expires_at, expires_at_ms FROM sessions WHERE ${tokenCol} = ? LIMIT 1`)
    .get(sessionToken) as any;

  if (!row) return { ok: false };

  const now = Date.now();
  const exp = row.expires_at ?? row.expires_at_ms ?? null;
  if (typeof exp === 'number' && exp > 0 && now > exp) return { ok: false };

  // Touch last_seen_at if present
  if (hasColumn(db, 'sessions', 'last_seen_at')) {
    try {
      db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE ${tokenCol} = ?`).run(now, sessionToken);
    } catch {
      // ignore
    }
  }

  return { ok: true, userId: String(row.user_id) };
}

export function loadActiveCharacter(
  db: DB,
  userId: string
): { characterId: string; worldId: string; levelId: number; x: number; y: number; face: string; hp: number } {
  // Prefer explicit character_position table if it exists.
  const hasCharPos = true;

  const row = db
    .prepare(
      `
      SELECT
        c.character_id as character_id,
        c.world_id as world_id,
        cp.level_id as level_id,
        cp.x as x,
        cp.y as y,
        cp.face as face,
        c.hp as hp
      FROM characters c
      JOIN character_position cp ON cp.character_id = c.character_id
      WHERE c.user_id = ?
      ORDER BY c.last_played_at DESC
      LIMIT 1
    `
    )
    .get(userId) as any;

  if (row) {
    return {
      characterId: String(row.character_id),
      worldId: String(row.world_id),
      levelId: Number(row.level_id),
      x: Number(row.x),
      y: Number(row.y),
      face: String(row.face),
      hp: Number(row.hp ?? 10)
    };
  }

  // fallback (should be rare)
  const row2 = db
    .prepare(
      `
      SELECT character_id, world_id, level_id, x, y, face, hp
      FROM characters
      WHERE user_id = ?
      ORDER BY last_played_at DESC
      LIMIT 1
    `
    )
    .get(userId) as any;

  if (!row2) {
    throw new Error('no character for user');
  }

  return {
    characterId: String(row2.character_id),
    worldId: String(row2.world_id),
    levelId: Number(row2.level_id ?? 1),
    x: Number(row2.x ?? 0),
    y: Number(row2.y ?? 0),
    face: String(row2.face ?? 'N'),
    hp: Number(row2.hp ?? 10)
  };
}

export function savePosition(db: DB, characterId: string, levelId: number, x: number, y: number, face: string): void {
  const now = Date.now();

  const hasUpdatedAtMs = hasColumn(db, 'character_position', 'updated_at_ms');
  const hasUpdatedAt = hasColumn(db, 'character_position', 'updated_at');

  if (hasUpdatedAtMs) {
    db.prepare(
      `
      UPDATE character_position
      SET level_id = ?, x = ?, y = ?, face = ?, updated_at_ms = ?
      WHERE character_id = ?
    `
    ).run(levelId, x, y, face, now, characterId);
  } else if (hasUpdatedAt) {
    db.prepare(
      `
      UPDATE character_position
      SET level_id = ?, x = ?, y = ?, face = ?, updated_at = ?
      WHERE character_id = ?
    `
    ).run(levelId, x, y, face, now, characterId);
  } else {
    db.prepare(
      `
      UPDATE character_position
      SET level_id = ?, x = ?, y = ?, face = ?
      WHERE character_id = ?
    `
    ).run(levelId, x, y, face, characterId);
  }

  // keep characters.last_played_at + updated_at_ms in sync if present
  const charHasLastPlayed = hasColumn(db, 'characters', 'last_played_at');
  const charHasUpdatedAtMs = hasColumn(db, 'characters', 'updated_at_ms');

  if (charHasLastPlayed && charHasUpdatedAtMs) {
    db.prepare(`UPDATE characters SET last_played_at = ?, updated_at_ms = ? WHERE character_id = ?`).run(now, now, characterId);
  } else if (charHasLastPlayed) {
    db.prepare(`UPDATE characters SET last_played_at = ? WHERE character_id = ?`).run(now, characterId);
  } else if (charHasUpdatedAtMs) {
    db.prepare(`UPDATE characters SET updated_at_ms = ? WHERE character_id = ?`).run(now, characterId);
  }
}
