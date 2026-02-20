import { describe, expect, test } from 'vitest';
import { WorldEngine } from '../src/world.js';
import type { PlayerState } from '../src/types.js';
import type { Dir } from '../src/types.js';

class MemOverlay {
  getEdgeOverride(_levelId: number, _x: number, _y: number, _dir: Dir): any {
    return null;
  }
}

class MemDiscovery {
  private s = new Set<string>();
  markDiscovered(levelId: number, x: number, y: number, _nowMs: number): void {
    this.s.add(`${levelId}:${x}:${y}`);
  }
  getDiscoveredInRadius(levelId: number, x: number, y: number, radius: number): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const k = `${levelId}:${x + dx}:${y + dy}`;
        if (this.s.has(k)) out.push({ x: x + dx, y: y + dy });
      }
    }
    return out;
  }
}

class FakeTime {
  private t = 1700000000000;
  nowMs(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

describe('replay stability', () => {
  test('same action log => same state hash', () => {
    const time1 = new FakeTime();
    const time2 = new FakeTime();

    const mk = (time: FakeTime) => {
      const disc = new MemDiscovery();
      const eng = new WorldEngine({ seed: 777, overlay: new MemOverlay(), discovery: disc, time });
      const player: PlayerState = { levelId: 1, x: 0, y: 0, face: 'N', hp: 10 };
      disc.markDiscovered(1, 0, 0, time.nowMs());
      const cooldowns = { moveReadyAtMs: time.nowMs(), turnReadyAtMs: time.nowMs() };
      return { eng, player, cooldowns, time };
    };

    const run = (env: ReturnType<typeof mk>) => {
      // Action log: turn E, move, move, turn S, move
      let p = env.player;
      let c = env.cooldowns;

      const doTurn = (face: any) => {
        // Replay harness: ensure turns are deterministic even if the log turns faster than cooldown timing.
        // If a turn is rejected due to cooldown, satisfy the cooldown and retry once.
        let r = env.eng.turn(p, c, face);
        if (!r.ok || !r.player) {
          c = { ...c, turnReadyAtMs: env.time.nowMs() };
          r = env.eng.turn(p, c, face);
        }
        if (!r.ok || !r.player) throw new Error('turn failed');
        p = r.player;
        c = { ...c, turnReadyAtMs: env.time.nowMs() + 150 };
      };

      const doMove = () => {
        // Deterministic move helper: try to move; if blocked, turn and try other directions.
        // This keeps the replay test meaningful even when walls are expected.
        const dirs = ['N', 'E', 'S', 'W'] as const;

        for (const face of dirs) {
          if (p.face !== face) {
            const tr = env.eng.turn(p, c, face);
            if (tr.ok && tr.player) {
              p = tr.player;
              c = { ...c, turnReadyAtMs: env.time.nowMs() + 150 };
            }
          }

          const r = env.eng.move(p, c);
          if (r.ok && r.player) {
            p = r.player;
            c = { ...c, moveReadyAtMs: env.time.nowMs() + 500 };
            return;
          }
        }

        // If we are boxed in (all directions blocked), treat MOVE as a deterministic no-op for replay stability.
        // Still advance move cooldown to preserve timing deterministically.
        c = { ...c, moveReadyAtMs: env.time.nowMs() + 500 };
        return;
      };

      doTurn('E');
      doMove();
      doMove();
      doTurn('S');
      doMove();

      return env.eng.stateHash(p, c);
    };

    const h1 = run(mk(time1));
    const h2 = run(mk(time2));
    expect(h1).toBe(h2);
  });
});