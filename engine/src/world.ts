// engine/src/world.ts
import type { Dir, EdgeType, PlayerState, ViewCell, WorldView, MinimapCell } from './types.js';
import { stableHash } from './hash.js';

export const CHUNK_SIZE = 64;
export const CELL_FEET = 5;

export interface EdgeOverride {
  edgeType: EdgeType;
  lockDifficulty?: number;
  keyMonsterEntityId?: string | null;
  defaultStateOnReset?: 'unlocked';
}

export type EdgeQueryPurpose = 'movement' | 'visibility' | 'minimap';

export interface WorldOverlayProvider {
  getEdgeOverride(levelId: number, x: number, y: number, dir: Dir, purpose?: EdgeQueryPurpose): EdgeOverride | null;
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

export type MoveDir = Dir | 'F' | 'B';

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

  edgeType(levelId: number, x: number, y: number, dir: Dir, purpose: EdgeQueryPurpose = 'movement'): EdgeType {
    const ov = this.overlay.getEdgeOverride(levelId, x, y, dir, purpose);
    if (ov) return ov.edgeType;

    // No base generation: unknown space is solid until the overlay writes structure.
    return 'wall';
  }

  private canTraverseAbs(levelId: number, x: number, y: number, absDir: Dir): boolean {
    const e = this.edgeType(levelId, x, y, absDir, 'movement');
    return e === 'open' || e === 'door_unlocked' || e === 'lever_secret';
  }

  canTraverse(levelId: number, x: number, y: number, face: Dir, moveDir: MoveDir = 'F'): boolean {
    const absDir = moveDirToAbs(face, moveDir);
    return this.canTraverseAbs(levelId, x, y, absDir);
  }

  /**
   * Movement rules:
   * - moveDir 'F'/'B' moves relative to current facing without changing facing.
   * - moveDir 'N'/'E'/'S'/'W' moves in that absolute direction without changing facing.
   */
  move(
    player: PlayerState,
    cooldowns: CooldownState,
    moveDir: MoveDir = 'F'
  ): { ok: boolean; reason?: string; player?: PlayerState } {
    const now = this.time.nowMs();
    if (now < cooldowns.moveReadyAtMs) return { ok: false, reason: 'move_cooldown' };

    const absDir = moveDirToAbs(player.face, moveDir);

    if (!this.canTraverseAbs(player.levelId, player.x, player.y, absDir)) {
      return { ok: false, reason: 'blocked' };
    }

    const { nx, ny } = step(player.x, player.y, absDir);
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

    // Minimap: discovered cells in radius, with edges computed WITHOUT triggering generation.
    const discovered = this.discovery.getDiscoveredInRadius(player.levelId, player.x, player.y, 12);
    const minimapCells: MinimapCell[] = discovered.map((c) => ({
      x: c.x,
      y: c.y,
      edges: {
        N: this.edgeType(player.levelId, c.x, c.y, 'N', 'minimap'),
        E: this.edgeType(player.levelId, c.x, c.y, 'E', 'minimap'),
        S: this.edgeType(player.levelId, c.x, c.y, 'S', 'minimap'),
        W: this.edgeType(player.levelId, c.x, c.y, 'W', 'minimap')
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

function oppositeOf(d: Dir): Dir {
  return d === 'N' ? 'S' : d === 'S' ? 'N' : d === 'E' ? 'W' : 'E';
}

function moveDirToAbs(face: Dir, moveDir: MoveDir): Dir {
  if (moveDir === 'F') return face;
  if (moveDir === 'B') return oppositeOf(face);
  return moveDir;
}

function computeOmniRays(engine: WorldEngine, player: PlayerState, depth: number): ViewCell[] {
  const out = new Map<string, ViewCell>();

  const addCell = (x: number, y: number) => {
    const k = `${x},${y}`;
    if (out.has(k)) return;
    const edges: Record<Dir, EdgeType> = {
      N: engine.edgeType(player.levelId, x, y, 'N', 'visibility'),
      E: engine.edgeType(player.levelId, x, y, 'E', 'visibility'),
      S: engine.edgeType(player.levelId, x, y, 'S', 'visibility'),
      W: engine.edgeType(player.levelId, x, y, 'W', 'visibility')
    };
    out.set(k, { x, y, edges });
  };

  addCell(player.x, player.y);

  const dirs: Dir[] = ['N', 'E', 'S', 'W'];
  for (const dir of dirs) {
    let cx = player.x;
    let cy = player.y;

    for (let d = 0; d < depth; d++) {
      const forward = engine.edgeType(player.levelId, cx, cy, dir, 'visibility');

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