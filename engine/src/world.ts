// engine/src/world.ts
import type { Dir, EdgeType, PlayerState, ViewCell, WorldView, MinimapCell } from './types.js';
import { generateChunkMaze, baseEdgeTypeFromChunk } from './maze.js';
import { stableHash } from './hash.js';

export const CHUNK_SIZE = 64;
export const CELL_FEET = 5;

export interface EdgeOverride {
  edgeType: EdgeType;
  lockDifficulty?: number;
  keyMonsterEntityId?: string | null;
  defaultStateOnReset?: 'unlocked';
}

export interface WorldOverlayProvider {
  getEdgeOverride(levelId: number, x: number, y: number, dir: Dir): EdgeOverride | null;
}

export interface DiscoveryProvider {
  markDiscovered(levelId: number, x: number, y: number, nowMs: number): void;
  getDiscoveredInRadius(levelId: number, x: number, y: number, radius: number): Array<{ x: number; y: number }>;
}

export interface TimeProvider {
  nowMs(): number;
}

export interface CooldownState {
  moveReadyAtMs: number;
  turnReadyAtMs: number;
}

export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

export function mod(a: number, b: number): number {
  const r = a % b;
  return r < 0 ? r + b : r;
}

export class WorldEngine {
  private readonly seed: number;
  private readonly overlay: WorldOverlayProvider;
  private readonly discovery: DiscoveryProvider;
  private readonly time: TimeProvider;

  constructor(opts: { seed: number; overlay: WorldOverlayProvider; discovery: DiscoveryProvider; time: TimeProvider }) {
    this.seed = opts.seed;
    this.overlay = opts.overlay;
    this.discovery = opts.discovery;
    this.time = opts.time;
  }

  getHub(levelId: number): { levelId: number; x: number; y: number } {
    return { levelId, x: 0, y: 0 };
  }

  distanceFeetToHub(levelId: number, x: number, y: number): number {
    const dx = x - 0;
    const dy = y - 0;
    return Math.round(Math.sqrt(dx * dx + dy * dy) * CELL_FEET);
  }

  edgeType(levelId: number, x: number, y: number, dir: Dir): EdgeType {
    const ov = this.overlay.getEdgeOverride(levelId, x, y, dir);
    if (ov) return ov.edgeType;

    // Hub safety invariant: hub (0,0) must never be boxed in.
    // Applies to ALL levels (including level 0), unless an overlay overrides it.
    //
    // Force two guaranteed exits (E and S) and their symmetric counterparts.
    // Overlays, if present, win (handled above).

    // (0,0) <-> (1,0)
    if (x === 0 && y === 0 && dir === 'E') return 'open';
    if (x === 1 && y === 0 && dir === 'W') return 'open';

    // (0,0) <-> (0,1)
    if (x === 0 && y === 0 && dir === 'S') return 'open';
    if (x === 0 && y === 1 && dir === 'N') return 'open';

    // Base generation is per chunk.
    const cx = floorDiv(x, CHUNK_SIZE);
    const cy = floorDiv(y, CHUNK_SIZE);
    const lx = mod(x, CHUNK_SIZE);
    const ly = mod(y, CHUNK_SIZE);

    const chunk = generateChunkMaze(this.seed, levelId, cx, cy);

    // Boundary connectivity between chunks: treat borders as open in a deterministic pattern.
    // This avoids disconnected chunks without needing cross-chunk data.
    // Rule: every 8 cells, open an inter-chunk boundary passage.
    // This is applied when querying edges that cross chunk boundaries.

    if (dir === 'E' && lx === CHUNK_SIZE - 1) {
      return ly % 8 === 0 ? 'open' : 'wall';
    }
    if (dir === 'W' && lx === 0) {
      return ly % 8 === 0 ? 'open' : 'wall';
    }
    if (dir === 'S' && ly === CHUNK_SIZE - 1) {
      return lx % 8 === 0 ? 'open' : 'wall';
    }
    if (dir === 'N' && ly === 0) {
      return lx % 8 === 0 ? 'open' : 'wall';
    }

    return baseEdgeTypeFromChunk(chunk, lx, ly, dir);
  }

  canTraverse(levelId: number, x: number, y: number, dir: Dir): boolean {
    const e = this.edgeType(levelId, x, y, dir);
    return e === 'open' || e === 'door_unlocked' || e === 'lever_secret';
  }

  move(player: PlayerState, cooldowns: CooldownState): { ok: boolean; reason?: string; player?: PlayerState } {
    const now = this.time.nowMs();
    if (now < cooldowns.moveReadyAtMs) return { ok: false, reason: 'move_cooldown' };

    if (!this.canTraverse(player.levelId, player.x, player.y, player.face)) {
      return { ok: false, reason: 'blocked' };
    }

    const { nx, ny } = step(player.x, player.y, player.face);
    const next: PlayerState = { ...player, x: nx, y: ny };
    this.discovery.markDiscovered(next.levelId, next.x, next.y, now);

    return { ok: true, player: next };
  }

  turn(player: PlayerState, cooldowns: CooldownState, face: Dir): { ok: boolean; reason?: string; player?: PlayerState } {
    const now = this.time.nowMs();
    if (now < cooldowns.turnReadyAtMs) return { ok: false, reason: 'turn_cooldown' };
    return { ok: true, player: { ...player, face } };
  }

  view(player: PlayerState, cooldowns: CooldownState): WorldView {
    const now = this.time.nowMs();

    // Visibility: reveal rays in all directions from the current cell.
    const visibleCells = computeOmniRays(this, player, 3);

    // Minimap: discovered cells in radius, with edges computed on-demand so they render
    // correctly even with a fresh browser session (no local cache).
    const discovered = this.discovery.getDiscoveredInRadius(player.levelId, player.x, player.y, 12);
    const minimapCells: MinimapCell[] = discovered.map((c) => ({
      x: c.x,
      y: c.y,
      edges: {
        N: this.edgeType(player.levelId, c.x, c.y, 'N'),
        E: this.edgeType(player.levelId, c.x, c.y, 'E'),
        S: this.edgeType(player.levelId, c.x, c.y, 'S'),
        W: this.edgeType(player.levelId, c.x, c.y, 'W')
      }
    }));

    return {
      nowMs: now,
      you: player,
      visibleCells,
      minimapCells,
      cooldowns
    };
  }

  stateHash(player: PlayerState, cooldowns: CooldownState): string {
    const view = this.view(player, cooldowns);
    const payload = {
      you: view.you,
      cooldowns: view.cooldowns,
      visible: view.visibleCells
    };
    return stableHash(payload);
  }
}

export function step(x: number, y: number, dir: Dir): { nx: number; ny: number } {
  if (dir === 'N') return { nx: x, ny: y - 1 };
  if (dir === 'S') return { nx: x, ny: y + 1 };
  if (dir === 'E') return { nx: x + 1, ny: y };
  return { nx: x - 1, ny: y };
}

function computeOmniRays(engine: WorldEngine, player: PlayerState, depth: number): ViewCell[] {
  const out = new Map<string, ViewCell>();

  const addCell = (x: number, y: number) => {
    const k = `${x},${y}`;
    if (out.has(k)) return;
    const edges: Record<Dir, EdgeType> = {
      N: engine.edgeType(player.levelId, x, y, 'N'),
      E: engine.edgeType(player.levelId, x, y, 'E'),
      S: engine.edgeType(player.levelId, x, y, 'S'),
      W: engine.edgeType(player.levelId, x, y, 'W')
    };
    out.set(k, { x, y, edges });
  };

  addCell(player.x, player.y);

  const dirs: Dir[] = ['N', 'E', 'S', 'W'];
  for (const dir of dirs) {
    let cx = player.x;
    let cy = player.y;

    for (let d = 0; d < depth; d++) {
      const forward = engine.edgeType(player.levelId, cx, cy, dir);

      // Fog/LoS rule:
      // - open + lever_secret allow vision to continue
      // - doors (locked OR unlocked) block vision until you pass through them
      // - walls block vision
      if (!(forward === 'open' || forward === 'lever_secret')) break;

      const n = step(cx, cy, dir);
      cx = n.nx;
      cy = n.ny;

      addCell(cx, cy);
    }
  }

  return Array.from(out.values());
}