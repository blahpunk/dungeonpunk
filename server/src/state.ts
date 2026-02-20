// server/src/state.ts
import type { DB } from './db.js';

export type ActiveCharacter = {
  characterId: string;
  worldId: string;
  levelId: number;
  x: number;
  y: number;
  face: string;
  hp: number;
};

function hasColumn(db: DB, tableName: string, columnName: string): boolean {
  // sqlite: PRAGMA table_info(table)
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  for (const r of rows) {
    if (String(r?.name ?? '') === columnName) return true;
  }
  return false;
}

export function loadSession(db: DB, sessionToken: string): { userId: string } | null {
  const row = db
    .prepare(
      `
      SELECT user_id
      FROM sessions
      WHERE session_token = ?
      LIMIT 1
    `
    )
    .get(sessionToken) as any;

  if (!row?.user_id) return null;
  return { userId: String(row.user_id) };
}

export function loadActiveCharacter(db: DB, userId: string): ActiveCharacter {
  // Prefer character_position (authoritative)
  const row = db
    .prepare(
      `
      SELECT c.character_id, c.hp,
             cp.world_id, cp.level_id, cp.x, cp.y, cp.face
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

  // Fallback to legacy characters table (should be rare)
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

export function savePosition(
  db: DB,
  characterId: string,
  worldId: string,
  levelId: number,
  x: number,
  y: number,
  face: string
): void {
  const now = Date.now();

  const hasUpdatedAtMs = hasColumn(db, 'character_position', 'updated_at_ms');
  const hasUpdatedAt = hasColumn(db, 'character_position', 'updated_at');

  // UPSERT so progress is saved even if character_position row does not exist.
  if (hasUpdatedAtMs) {
    db.prepare(
      `
      INSERT INTO character_position(character_id, world_id, level_id, x, y, face, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(character_id) DO UPDATE SET
        world_id = excluded.world_id,
        level_id = excluded.level_id,
        x = excluded.x,
        y = excluded.y,
        face = excluded.face,
        updated_at_ms = excluded.updated_at_ms
    `
    ).run(characterId, worldId, levelId, x, y, face, now);
  } else if (hasUpdatedAt) {
    db.prepare(
      `
      INSERT INTO character_position(character_id, world_id, level_id, x, y, face, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(character_id) DO UPDATE SET
        world_id = excluded.world_id,
        level_id = excluded.level_id,
        x = excluded.x,
        y = excluded.y,
        face = excluded.face,
        updated_at = excluded.updated_at
    `
    ).run(characterId, worldId, levelId, x, y, face, now);
  } else {
    db.prepare(
      `
      INSERT INTO character_position(character_id, world_id, level_id, x, y, face)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(character_id) DO UPDATE SET
        world_id = excluded.world_id,
        level_id = excluded.level_id,
        x = excluded.x,
        y = excluded.y,
        face = excluded.face
    `
    ).run(characterId, worldId, levelId, x, y, face);
  }

  // Keep characters.last_played_at + updated_at_ms in sync if present
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