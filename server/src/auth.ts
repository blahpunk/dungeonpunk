// server/src/auth.ts
import type { DB } from './db.js';
import { id, token } from './ids.js';

function ensureWorld(db: DB): string {
  const row = db.prepare('SELECT world_id FROM worlds ORDER BY created_at_ms ASC LIMIT 1').get() as any;
  if (row?.world_id) return String(row.world_id);

  const worldId = id('w');
  const now = Date.now();

  // Stable seed if provided, otherwise create a new one on first boot after wipe.
  const forced = process.env.WORLD_SEED;
  const seed = forced ? Number(forced) : ((Date.now() ^ (Math.random() * 0x7fffffff)) | 0);

  db.prepare('INSERT INTO worlds(world_id, seed, generator_version, created_at_ms) VALUES (?,?,?,?)').run(
    worldId,
    seed,
    'maze_v1',
    now
  );

  return worldId;
}

export function devLogin(
  db: DB,
  email: string
): { sessionToken: string; userId: string; characterId: string; worldId: string } {
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

  // Load most recent character
  let character = db
    .prepare('SELECT character_id FROM characters WHERE user_id = ? ORDER BY last_played_at DESC LIMIT 1')
    .get(userId) as any;

  if (!character) {
    const characterId = id('c');
    const name = email.split('@')[0].slice(0, 16);

    db.prepare(
      `INSERT INTO characters(
        character_id, user_id, world_id, name,
        hp, last_played_at, level_id, x, y, face,
        created_at_ms, updated_at_ms
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(characterId, userId, worldId, name, 100, now, 1, 0, 0, 'N', now, now);

    db.prepare(
      `INSERT INTO character_position(character_id, world_id, level_id, x, y, face, updated_at_ms)
       VALUES (?,?,?,?,?,?,?)`
    ).run(characterId, worldId, 1, 0, 0, 'N', now);

    character = { character_id: characterId };
  } else {
    // Touch last_played_at
    db.prepare('UPDATE characters SET last_played_at = ?, updated_at_ms = ? WHERE character_id = ?').run(
      now,
      now,
      String(character.character_id)
    );
  }

  const characterId = String(character.character_id);

  const sessionToken = token();
  db.prepare(
    `INSERT INTO sessions(session_token, user_id, created_at_ms, expires_at, last_seen_at)
     VALUES (?,?,?,?,?)`
  ).run(sessionToken, userId, now, expiresAt, now);

  return { sessionToken, userId, characterId, worldId };
}
