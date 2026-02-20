// server/src/auth.ts
import type { DB } from './db.js';
import { id, token } from './ids.js';

function ensureWorld(db: DB): string {
  const row = db.prepare('SELECT world_id FROM worlds ORDER BY created_at_ms ASC LIMIT 1').get() as any;
  if (row?.world_id) return String(row.world_id);

  const worldId = id('w');
  const now = Date.now();

  // If WORLD_SEED is set to a number, use it. If unset or "random", generate a new seed.
  const raw = String(process.env.WORLD_SEED ?? '').trim().toLowerCase();
  const useForced = raw !== '' && raw !== 'random' && Number.isFinite(Number(raw));
  const seed = useForced ? Number(raw) : ((Date.now() ^ (Math.random() * 0x7fffffff)) | 0);

  db.prepare('INSERT INTO worlds(world_id, seed, generator_version, created_at_ms) VALUES (?,?,?,?)').run(
    worldId,
    seed,
    'doors_v1',
    now
  );

  return worldId;
}

export function devLogin(db: DB, email: string): { sessionToken: string; userId: string; characterId: string; worldId: string } {
  const now = Date.now();
  const expiresAt = now + 1000 * 60 * 60 * 24 * 7;

  const worldId = ensureWorld(db);

  let user = db.prepare('SELECT user_id FROM users WHERE email = ?').get(email) as any;
  if (!user) {
    const userId = id('u');
    db.prepare('INSERT INTO users(user_id, email, created_at_ms) VALUES (?,?,?)').run(userId, email, now);
    user = { user_id: userId };
  }
  const userId = String(user.user_id);

  let character = db
    .prepare('SELECT character_id FROM characters WHERE user_id = ? ORDER BY last_played_at DESC LIMIT 1')
    .get(userId) as any;

  if (!character) {
    const characterId = id('c');
    const name = email.split('@')[0].slice(0, 16);

    db.prepare(
      `
      INSERT INTO characters(character_id, user_id, world_id, name, level_id, x, y, face, hp, last_played_at, created_at_ms, updated_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `
    ).run(characterId, userId, worldId, name, 1, 0, 0, 'N', 100, now, now, now);

    // Ensure character_position exists immediately (so progress saving always works)
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
    ).run(characterId, worldId, 1, 0, 0, 'N', now);

    character = { character_id: characterId };
  } else {
    // Also make sure character_position row exists for existing characters (legacy DBs)
    const characterId = String(character.character_id);
    const cp = db.prepare('SELECT character_id FROM character_position WHERE character_id = ? LIMIT 1').get(characterId) as any;
    if (!cp) {
      const cRow = db
        .prepare('SELECT world_id, level_id, x, y, face FROM characters WHERE character_id = ? LIMIT 1')
        .get(characterId) as any;

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
      ).run(
        characterId,
        String(cRow?.world_id ?? worldId),
        Number(cRow?.level_id ?? 1),
        Number(cRow?.x ?? 0),
        Number(cRow?.y ?? 0),
        String(cRow?.face ?? 'N'),
        now
      );
    }
  }

  const characterId = String(character.character_id);

  const sessionToken = token('s');
  db.prepare(
    `
    INSERT INTO sessions(session_token, user_id, created_at_ms, expires_at, last_seen_at)
    VALUES (?,?,?,?,?)
  `
  ).run(sessionToken, userId, now, expiresAt, now);

  return { sessionToken, userId, characterId, worldId };
}