// server/src/overlays.ts
import type { DB } from './db.js';
import { id } from './ids.js';
import type { Dir, EdgeOverride, EdgeQueryPurpose, EdgeType } from '@infinite-dungeon/engine';

type CellKind = 'hub_room' | 'room' | 'corridor';

type CellMeta = {
  kind: CellKind;
  areaId: string;
};

type EdgeMeta = {
  doorId?: string;
  frontier?: boolean; // if true, stepping through this door will generate the destination cell/area
};

function opposite(dir: Dir): Dir {
  if (dir === 'N') return 'S';
  if (dir === 'S') return 'N';
  if (dir === 'E') return 'W';
  return 'E';
}

function step(x: number, y: number, dir: Dir): { nx: number; ny: number } {
  if (dir === 'N') return { nx: x, ny: y - 1 };
  if (dir === 'S') return { nx: x, ny: y + 1 };
  if (dir === 'E') return { nx: x + 1, ny: y };
  return { nx: x - 1, ny: y };
}

function normalizeMeta(v: any): EdgeMeta {
  if (!v || typeof v !== 'object') return {};
  const out: EdgeMeta = {};
  if (typeof v.doorId === 'string') out.doorId = v.doorId;
  if (typeof v.frontier === 'boolean') out.frontier = v.frontier;
  return out;
}

/**
 * Deterministic 32-bit hash for RNG seeding (FNV-1a + avalanche finalizer).
 */
function hashU32(parts: Array<number | string>): number {
  let h = 2166136261 >>> 0;

  const mixU32 = (v: number) => {
    h ^= v >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  };

  for (const p of parts) {
    if (typeof p === 'number') {
      mixU32(p | 0);
    } else {
      for (let i = 0; i < p.length; i++) {
        h ^= p.charCodeAt(i) & 0xff;
        h = Math.imul(h, 16777619) >>> 0;
      }
    }
  }

  // Avalanche
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;

  return h >>> 0;
}

class Rng32 {
  private s: number;
  constructor(seedU32: number) {
    this.s = seedU32 >>> 0;
    if (this.s === 0) this.s = 0x12345678;
  }
  nextU32(): number {
    // xorshift32
    let x = this.s;
    x ^= (x << 13) >>> 0;
    x ^= x >>> 17;
    x ^= (x << 5) >>> 0;
    this.s = x >>> 0;
    return this.s;
  }
  float01(): number {
    return (this.nextU32() >>> 0) / 0xffffffff;
  }
  int(minInclusive: number, maxExclusive: number): number {
    const a = Math.floor(minInclusive) | 0;
    const b = Math.floor(maxExclusive) | 0;
    if (!(b > a)) return a;
    const span = b - a;
    return a + (this.nextU32() % span);
  }
  pick<T>(arr: T[]): T {
    return arr[this.int(0, arr.length)]!;
  }
  shuffleInPlace<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const t = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = t;
    }
  }
}

export class DbOverlayProvider {
  private readonly seed: number;

  private readonly stmtGetEdge;
  private readonly stmtUpsertEdge;
  private readonly stmtGetCell;
  private readonly stmtUpsertCell;

  constructor(private readonly db: DB, private readonly worldId: string) {
    const row = this.db.prepare('SELECT seed FROM worlds WHERE world_id = ? LIMIT 1').get(this.worldId) as any;
    const s = row?.seed;
    const n = typeof s === 'number' ? s : Number(s);
    this.seed = Number.isFinite(n) ? n : 12345;

    this.stmtGetEdge = this.db.prepare(
      `
        SELECT edge_type, lock_state_json, override_json
        FROM edge_overrides
        WHERE world_id = ?
          AND level_id = ?
          AND x = ?
          AND y = ?
          AND dir = ?
        LIMIT 1
      `
    );

    this.stmtUpsertEdge = this.db.prepare(
      `
        INSERT OR REPLACE INTO edge_overrides
          (world_id, level_id, x, y, dir, edge_type, lock_state_json, override_json, updated_at_ms)
        VALUES
          (?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `
    );

    this.stmtGetCell = this.db.prepare(
      `
        SELECT override_json
        FROM cell_overrides
        WHERE world_id = ?
          AND level_id = ?
          AND x = ?
          AND y = ?
        LIMIT 1
      `
    );

    this.stmtUpsertCell = this.db.prepare(
      `
        INSERT OR REPLACE INTO cell_overrides
          (world_id, level_id, x, y, override_json, updated_at_ms)
        VALUES
          (?, ?, ?, ?, ?, ?)
      `
    );
  }

  getEdgeOverride(levelId: number, x: number, y: number, dir: Dir, purpose: EdgeQueryPurpose = 'movement'): EdgeOverride | null {
    if (purpose !== 'minimap') this.ensureSeedHub(levelId);

    // If a frontier door exists and this is a MOVEMENT query, materialize the destination deterministically.
    if (purpose === 'movement') {
      const row0 = this.stmtGetEdge.get(this.worldId, levelId, x, y, dir) as any;
      if (row0?.edge_type) {
        const et0 = String(row0.edge_type) as EdgeType;
        if (et0 === 'door_unlocked') {
          const meta0 = this.parseEdgeMeta(row0?.override_json);
          if (meta0.frontier) {
            this.expandFrontierDoor(levelId, x, y, dir, meta0);
          }
        }
      }
    }

    const row = this.stmtGetEdge.get(this.worldId, levelId, x, y, dir) as any;
    if (row?.edge_type) return { edgeType: String(row.edge_type) as EdgeType };
    return null;
  }

  // ---------------- Seed hub (2x2) ----------------

  private ensureSeedHub(levelId: number): void {
    const now = Date.now();

    const hubCells: Array<{ x: number; y: number }> = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 }
    ];

    const tx = this.db.transaction(() => {
      // Hub cell meta
      const areaId = 'hub_room';
      for (const c of hubCells) {
        const existing = this.stmtGetCell.get(this.worldId, levelId, c.x, c.y) as any;
        if (!existing) {
          const meta: CellMeta = { kind: 'hub_room', areaId };
          this.stmtUpsertCell.run(this.worldId, levelId, c.x, c.y, JSON.stringify(meta), now);
        }
      }

      // Interior edges open (fixed)
      this.writeEdgeBothWays(levelId, 0, 0, 'E', 'open', {}, now);
      this.writeEdgeBothWays(levelId, 0, 0, 'S', 'open', {}, now);
      this.writeEdgeBothWays(levelId, 1, 0, 'S', 'open', {}, now);
      this.writeEdgeBothWays(levelId, 0, 1, 'E', 'open', {}, now);

      // Default hub perimeter walls (fixed)
      const perimeter: Array<{ x: number; y: number; dir: Dir }> = [
        // north edges
        { x: 0, y: 0, dir: 'N' },
        { x: 1, y: 0, dir: 'N' },
        // south edges
        { x: 0, y: 1, dir: 'S' },
        { x: 1, y: 1, dir: 'S' },
        // west edges
        { x: 0, y: 0, dir: 'W' },
        { x: 0, y: 1, dir: 'W' },
        // east edges
        { x: 1, y: 0, dir: 'E' },
        { x: 1, y: 1, dir: 'E' }
      ];

      for (const p of perimeter) {
        // Don’t overwrite interior opens
        const r = this.stmtGetEdge.get(this.worldId, levelId, p.x, p.y, p.dir) as any;
        if (r?.edge_type) continue;
        this.writeEdgeBothWays(levelId, p.x, p.y, p.dir, 'wall', {}, now);
      }

      // Deterministic hub doors (frontier)
      const rng = new Rng32(hashU32([this.seed, this.worldId, levelId, 'hub_doors_v1']));
      const candidates = perimeter.slice();
      rng.shuffleInPlace(candidates);

      // 1-2 doors
      const doorCount = rng.float01() < 0.35 ? 2 : 1;
      let written = 0;

      for (const c of candidates) {
        if (written >= doorCount) break;

        // Avoid placing a door that would immediately collide with hub interior (not possible here),
        // and avoid duplicating already-non-wall edges.
        const row = this.stmtGetEdge.get(this.worldId, levelId, c.x, c.y, c.dir) as any;
        if (!row?.edge_type) continue;
        if (String(row.edge_type) !== 'wall') continue;

        const doorId = id('d');
        this.writeEdgeBothWays(levelId, c.x, c.y, c.dir, 'door_unlocked', { doorId, frontier: true }, now);
        written++;
      }

      // If something went wrong (shouldn’t), force at least one east door at (1,0)E
      if (written === 0) {
        const doorId = id('d');
        this.writeEdgeBothWays(levelId, 1, 0, 'E', 'door_unlocked', { doorId, frontier: true }, now);
      }
    });

    tx();
  }

  // ---------------- Frontier expansion ----------------

  private expandFrontierDoor(levelId: number, x: number, y: number, dir: Dir, meta: EdgeMeta): void {
    const now = Date.now();
    const n = step(x, y, dir);

    // If destination already exists, just clear frontier bit and return.
    const destMeta = this.getCellMeta(levelId, n.nx, n.ny);
    if (destMeta) {
      const doorId = meta.doorId ?? id('d');
      this.writeEdgeBothWays(levelId, x, y, dir, 'door_unlocked', { doorId, frontier: false }, now);
      return;
    }

    const srcMeta = this.getCellMeta(levelId, x, y);

    const rng = new Rng32(hashU32([this.seed, this.worldId, levelId, x, y, dir, 'expand_v1']));

    const tx = this.db.transaction(() => {
      // Re-check inside tx
      const destMeta2 = this.getCellMeta(levelId, n.nx, n.ny);
      if (destMeta2) {
        const doorId = meta.doorId ?? id('d');
        this.writeEdgeBothWays(levelId, x, y, dir, 'door_unlocked', { doorId, frontier: false }, now);
        return;
      }

      const doorId = meta.doorId ?? id('d');

      // Hub/room always expands to a corridor cell first.
      const forceCorridor = srcMeta?.kind === 'hub_room' || srcMeta?.kind === 'room';

      // Decide target type
      let target: CellKind = 'corridor';
      if (!forceCorridor) {
        // corridor can branch into corridor or a room
        target = rng.float01() < 0.72 ? 'corridor' : 'room';
      }

      if (target === 'room') {
        const ok = this.tryPlaceRoom2x2FromDoor(levelId, x, y, dir, doorId, now, rng);
        if (!ok) {
          // fallback to corridor if room can't fit
          this.placeCorridorCell(levelId, n.nx, n.ny, opposite(dir), doorId, now, rng);
          this.writeEdgeBothWays(levelId, x, y, dir, 'door_unlocked', { doorId, frontier: false }, now);
        }
        return;
      }

      // corridor target
      this.placeCorridorCell(levelId, n.nx, n.ny, opposite(dir), doorId, now, rng);
      this.writeEdgeBothWays(levelId, x, y, dir, 'door_unlocked', { doorId, frontier: false }, now);
    });

    tx();
  }

  // ---------------- Placement rules ----------------

  private placeCorridorCell(levelId: number, cx: number, cy: number, cameFrom: Dir, backDoorId: string, now: number, rng: Rng32): void {
    // If already exists, do nothing.
    if (this.getCellMeta(levelId, cx, cy)) return;

    const meta: CellMeta = { kind: 'corridor', areaId: `c_${cx}_${cy}_${(rng.nextU32() & 0xffff).toString(16)}` };
    this.stmtUpsertCell.run(this.worldId, levelId, cx, cy, JSON.stringify(meta), now);

    // Fixed: corridor edges are either walls or doors (some frontier).
    const dirs: Dir[] = ['N', 'E', 'S', 'W'];

    // Determine exits excluding back direction.
    const candidates = dirs.filter((d) => d !== cameFrom);
    rng.shuffleInPlace(candidates);

    const exits = rng.float01() < 0.20 ? 2 : rng.float01() < 0.70 ? 1 : 0;

    const exitSet = new Set<Dir>();
    for (let i = 0; i < exits; i++) exitSet.add(candidates[i]!);

    for (const d of dirs) {
      if (d === cameFrom) {
        // Back edge must be a non-frontier door (already connected)
        this.writeEdgeBothWays(levelId, cx, cy, d, 'door_unlocked', { doorId: backDoorId, frontier: false }, now);
        continue;
      }

      if (exitSet.has(d)) {
        // Frontier door (destination not yet carved)
        this.writeEdgeBothWays(levelId, cx, cy, d, 'door_unlocked', { doorId: id('d'), frontier: true }, now);
      } else {
        this.writeEdgeBothWays(levelId, cx, cy, d, 'wall', {}, now);
      }
    }
  }

  private tryPlaceRoom2x2FromDoor(
    levelId: number,
    fromX: number,
    fromY: number,
    dir: Dir,
    doorId: string,
    now: number,
    rng: Rng32
  ): boolean {
    const entrance = step(fromX, fromY, dir);
    const ex = entrance.nx;
    const ey = entrance.ny;

    // Room 2x2 with entrance cell included, oriented "forward" from the door.
    // Pick a 2x2 anchor so that (ex,ey) is one of the 4 cells, and the room lies forward of the corridor.
    let x0 = ex;
    let y0 = ey;

    if (dir === 'N') {
      // room extends north: entrance is on south row of the 2x2
      x0 = ex - rng.int(0, 2); // 0 or 1
      y0 = ey - 1;
    } else if (dir === 'S') {
      // room extends south: entrance is on north row
      x0 = ex - rng.int(0, 2);
      y0 = ey;
    } else if (dir === 'W') {
      // room extends west: entrance is on east col
      x0 = ex - 1;
      y0 = ey - rng.int(0, 2);
    } else {
      // dir === 'E' room extends east: entrance is on west col
      x0 = ex;
      y0 = ey - rng.int(0, 2);
    }

    const cells: Array<{ x: number; y: number }> = [
      { x: x0, y: y0 },
      { x: x0 + 1, y: y0 },
      { x: x0, y: y0 + 1 },
      { x: x0 + 1, y: y0 + 1 }
    ];

    // Must include entrance
    const includesEntrance = cells.some((c) => c.x === ex && c.y === ey);
    if (!includesEntrance) return false;

    // Must not overlap existing carved cells
    for (const c of cells) {
      if (this.getCellMeta(levelId, c.x, c.y)) return false;
    }

    const areaId = id('r');

    // Write room cells
    for (const c of cells) {
      const meta: CellMeta = { kind: 'room', areaId };
      this.stmtUpsertCell.run(this.worldId, levelId, c.x, c.y, JSON.stringify(meta), now);
    }

    // Interior edges open (2x2)
    this.writeEdgeBothWays(levelId, x0, y0, 'E', 'open', {}, now);
    this.writeEdgeBothWays(levelId, x0, y0, 'S', 'open', {}, now);
    this.writeEdgeBothWays(levelId, x0 + 1, y0, 'S', 'open', {}, now);
    this.writeEdgeBothWays(levelId, x0, y0 + 1, 'E', 'open', {}, now);

    // Perimeter: walls everywhere first
    const perimeterEdges: Array<{ x: number; y: number; dir: Dir }> = [
      // north row north edges
      { x: x0, y: y0, dir: 'N' },
      { x: x0 + 1, y: y0, dir: 'N' },
      // south row south edges
      { x: x0, y: y0 + 1, dir: 'S' },
      { x: x0 + 1, y: y0 + 1, dir: 'S' },
      // west col west edges
      { x: x0, y: y0, dir: 'W' },
      { x: x0, y: y0 + 1, dir: 'W' },
      // east col east edges
      { x: x0 + 1, y: y0, dir: 'E' },
      { x: x0 + 1, y: y0 + 1, dir: 'E' }
    ];

    for (const p of perimeterEdges) {
      // Don't overwrite interior open edges
      const r = this.stmtGetEdge.get(this.worldId, levelId, p.x, p.y, p.dir) as any;
      if (r?.edge_type) continue;
      this.writeEdgeBothWays(levelId, p.x, p.y, p.dir, 'wall', {}, now);
    }

    // Door from corridor to entrance cell (non-frontier)
    this.writeEdgeBothWays(levelId, fromX, fromY, dir, 'door_unlocked', { doorId, frontier: false }, now);

    // Optional extra frontier door on a different perimeter edge (to keep exploration going)
    if (rng.float01() < 0.55) {
      const doorCandidates = perimeterEdges.filter((p) => !(p.x === ex && p.y === ey && p.dir === opposite(dir)));
      rng.shuffleInPlace(doorCandidates);

      for (const p of doorCandidates) {
        // Only convert if currently a wall
        const row = this.stmtGetEdge.get(this.worldId, levelId, p.x, p.y, p.dir) as any;
        if (!row?.edge_type) continue;
        if (String(row.edge_type) !== 'wall') continue;

        this.writeEdgeBothWays(levelId, p.x, p.y, p.dir, 'door_unlocked', { doorId: id('d'), frontier: true }, now);
        break;
      }
    }

    return true;
  }

  // ---------------- DB helpers ----------------

  private getCellMeta(levelId: number, x: number, y: number): CellMeta | null {
    const row = this.stmtGetCell.get(this.worldId, levelId, x, y) as any;
    if (!row?.override_json) return null;

    try {
      const j = JSON.parse(String(row.override_json)) as Partial<CellMeta>;
      if (j && (j.kind === 'hub_room' || j.kind === 'room' || j.kind === 'corridor') && typeof j.areaId === 'string') {
        return { kind: j.kind, areaId: j.areaId };
      }
    } catch {}
    return null;
  }

  private parseEdgeMeta(v: any): EdgeMeta {
    if (!v) return {};
    try {
      return normalizeMeta(JSON.parse(String(v)));
    } catch {
      return {};
    }
  }

  private writeEdgeBothWays(levelId: number, x: number, y: number, dir: Dir, edgeType: EdgeType, meta: EdgeMeta, now: number): void {
    const metaJson = JSON.stringify(meta ?? {});
    this.stmtUpsertEdge.run(this.worldId, levelId, x, y, dir, edgeType, metaJson, now);

    const n = step(x, y, dir);
    this.stmtUpsertEdge.run(this.worldId, levelId, n.nx, n.ny, opposite(dir), edgeType, metaJson, now);
  }
}