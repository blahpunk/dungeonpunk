import type { DB } from './db.js';
import type { Dir } from '@infinite-dungeon/engine';
import type { EdgeOverride } from '@infinite-dungeon/engine';

export class DbOverlayProvider {
  constructor(private readonly db: DB, private readonly worldId: string) {}

  getEdgeOverride(levelId: number, x: number, y: number, dir: Dir): EdgeOverride | null {
    // edge_overrides are stored canonical as E/S per (x,y).
    // For Milestone 1, we allow storing direct (x,y,dir) overrides as-is.
    const row = this.db
      .prepare('SELECT edge_type, lock_state_json FROM edge_overrides WHERE world_id=? AND level_id=? AND x=? AND y=? AND dir=?')
      .get(this.worldId, levelId, x, y, dir) as any;
    if (!row) return null;

    const edgeType = row.edge_type as any;
    let lockDifficulty: number | undefined;
    let keyMonsterEntityId: string | null | undefined;
    let defaultStateOnReset: 'unlocked' | undefined;

    if (row.lock_state_json) {
      try {
        const o = JSON.parse(row.lock_state_json);
        if (typeof o.lock_difficulty === 'number') lockDifficulty = o.lock_difficulty;
        if (typeof o.key_monster_entity_id === 'string' || o.key_monster_entity_id === null) keyMonsterEntityId = o.key_monster_entity_id;
        if (o.default_state_on_reset === 'unlocked') defaultStateOnReset = 'unlocked';
      } catch {
        // ignore malformed
      }
    }

    return { edgeType, lockDifficulty, keyMonsterEntityId, defaultStateOnReset };
  }
}
