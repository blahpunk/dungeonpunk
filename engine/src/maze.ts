// engine/src/maze.ts
//
// BSP dungeon generation (RogueBasin-inspired):
// 1) Recursively split the chunk into sub-rectangles (BSP tree)
// 2) Place one room in each leaf (non-overlapping by construction)
// 3) Connect sibling subtrees with corridors (straight or L/Z-shaped)
// 4) Convert room<->corridor boundaries into DOORS (and ONLY those boundaries)
// 5) Sanitize: any accidental doors not on a room boundary are converted back to OPEN
//
// Storage remains edge-based (east/south arrays) for determinism & compatibility.

import { XorShift32, hashSeed } from './prng.js';
import type { ChunkEdges, Dir } from './types.js';

const CHUNK_SIZE = 64;

// Edge encoding inside chunk arrays:
const EDGE_WALL = 0;
const EDGE_OPEN = 1;
const EDGE_DOOR = 2;

type Rect = { x: number; y: number; w: number; h: number };
type Room = Rect & { cx: number; cy: number };

type BspNode = {
  r: Rect;
  left: BspNode | null;
  right: BspNode | null;
  room: Room | null; // leaf-only
  conn: { x: number; y: number } | null; // representative point for subtree connections
};

export function generateChunkMaze(seed: number, levelId: number, chunkX: number, chunkY: number): ChunkEdges {
  // Kept for API stability. Maze generation is removed; this now returns a BSP dungeon chunk.
  return generateChunkBsp(seed, levelId, chunkX, chunkY);
}

export function generateChunkBsp(seed: number, levelId: number, chunkX: number, chunkY: number): ChunkEdges {
  const rng = new XorShift32(hashSeed(seed, levelId, chunkX, chunkY, 'bsp_v4'));

  const east = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  const south = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  east.fill(EDGE_WALL);
  south.fill(EDGE_WALL);

  // Room membership mask (for door placement)
  const isRoom = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

  // Tuned for 64x64 chunks.
  const LEAF_MIN_W = 12;
  const LEAF_MIN_H = 12;

  // Rooms up to 5x5 requested; smaller common.
  const ROOM_MIN_W = 2;
  const ROOM_MIN_H = 2;
  const ROOM_MAX_W = 5;
  const ROOM_MAX_H = 5;

  // Keep rooms off leaf borders for clean corridors/doors.
  const ROOM_PAD_MIN = 1;
  const ROOM_PAD_MAX = 3;

  const MAX_DEPTH = 6;

  // Build BSP tree
  const root: BspNode = {
    r: { x: 0, y: 0, w: CHUNK_SIZE, h: CHUNK_SIZE },
    left: null,
    right: null,
    room: null,
    conn: null
  };

  splitNode(root, rng, 0, { leafMinW: LEAF_MIN_W, leafMinH: LEAF_MIN_H, maxDepth: MAX_DEPTH });

  // Place a room in each leaf and carve interior open edges
  placeRoomsAndCarve(root, rng, {
    roomMinW: ROOM_MIN_W,
    roomMinH: ROOM_MIN_H,
    roomMaxW: ROOM_MAX_W,
    roomMaxH: ROOM_MAX_H,
    padMin: ROOM_PAD_MIN,
    padMax: ROOM_PAD_MAX,
    isRoom,
    east,
    south
  });

  // Connect sibling subtrees with corridors
  connectSubtrees(root, rng, { east, south });

  // Door placement: ONLY where a room meets a corridor (non-room open space)
  const isCorr = deriveCorridorMask(east, south, isRoom);
  enforceRoomCorridorDoors(east, south, isRoom, isCorr);

  // Hard safety: if any non-boundary doors exist, convert them back to open
  sanitizeDoorsToRoomBoundaries(east, south, isRoom);

  // Ensure each room has at least one door (fallback)
  ensureAllRoomsHaveAtLeastOneDoor(root, rng, { east, south, isRoom });

  // Final sanitize after fallback
  sanitizeDoorsToRoomBoundaries(east, south, isRoom);

  return { seed, levelId, chunkX, chunkY, east, south };
}

export function baseEdgeTypeFromChunk(
  chunk: ChunkEdges,
  lx: number,
  ly: number,
  dir: Dir
): 'wall' | 'open' | 'door_unlocked' {
  if (!inBounds(lx, ly)) return 'wall';

  if (dir === 'E') {
    const v = chunk.east[idx(lx, ly)];
    return v === EDGE_DOOR ? 'door_unlocked' : v === EDGE_OPEN ? 'open' : 'wall';
  }
  if (dir === 'S') {
    const v = chunk.south[idx(lx, ly)];
    return v === EDGE_DOOR ? 'door_unlocked' : v === EDGE_OPEN ? 'open' : 'wall';
  }
  if (dir === 'W') {
    if (lx === 0) return 'wall';
    const v = chunk.east[idx(lx - 1, ly)];
    return v === EDGE_DOOR ? 'door_unlocked' : v === EDGE_OPEN ? 'open' : 'wall';
  }
  // N
  if (ly === 0) return 'wall';
  const v = chunk.south[idx(lx, ly - 1)];
  return v === EDGE_DOOR ? 'door_unlocked' : v === EDGE_OPEN ? 'open' : 'wall';
}

// ---------------- BSP build ----------------

function splitNode(
  node: BspNode,
  rng: XorShift32,
  depth: number,
  cfg: { leafMinW: number; leafMinH: number; maxDepth: number }
): void {
  if (depth >= cfg.maxDepth) return;

  const r = node.r;

  const canSplitV = r.w >= cfg.leafMinW * 2;
  const canSplitH = r.h >= cfg.leafMinH * 2;
  if (!canSplitV && !canSplitH) return;

  // Bias to split longer side
  let splitVertical = false;
  if (canSplitV && canSplitH) {
    const aspect = r.w / Math.max(1, r.h);
    if (aspect > 1.25) splitVertical = true;
    else if (aspect < 0.8) splitVertical = false;
    else splitVertical = rng.int(0, 2) === 0;
  } else {
    splitVertical = canSplitV;
  }

  if (splitVertical) {
    const minX = r.x + cfg.leafMinW;
    const maxX = r.x + r.w - cfg.leafMinW;
    if (maxX <= minX) return;

    const cut = rng.int(minX, maxX + 1);
    const leftR: Rect = { x: r.x, y: r.y, w: cut - r.x, h: r.h };
    const rightR: Rect = { x: cut, y: r.y, w: r.x + r.w - cut, h: r.h };

    node.left = { r: leftR, left: null, right: null, room: null, conn: null };
    node.right = { r: rightR, left: null, right: null, room: null, conn: null };
  } else {
    const minY = r.y + cfg.leafMinH;
    const maxY = r.y + r.h - cfg.leafMinH;
    if (maxY <= minY) return;

    const cut = rng.int(minY, maxY + 1);
    const topR: Rect = { x: r.x, y: r.y, w: r.w, h: cut - r.y };
    const botR: Rect = { x: r.x, y: cut, w: r.w, h: r.y + r.h - cut };

    node.left = { r: topR, left: null, right: null, room: null, conn: null };
    node.right = { r: botR, left: null, right: null, room: null, conn: null };
  }

  if (!node.left || !node.right) return;

  splitNode(node.left, rng, depth + 1, cfg);
  splitNode(node.right, rng, depth + 1, cfg);
}

function placeRoomsAndCarve(
  node: BspNode,
  rng: XorShift32,
  cfg: {
    roomMinW: number;
    roomMinH: number;
    roomMaxW: number;
    roomMaxH: number;
    padMin: number;
    padMax: number;
    isRoom: Uint8Array;
    east: Uint8Array;
    south: Uint8Array;
  }
): void {
  if (node.left && node.right) {
    placeRoomsAndCarve(node.left, rng, cfg);
    placeRoomsAndCarve(node.right, rng, cfg);
    return;
  }

  const leaf = node.r;
  const pad = rng.int(cfg.padMin, cfg.padMax + 1);

  const usableW = Math.max(1, leaf.w - pad * 2);
  const usableH = Math.max(1, leaf.h - pad * 2);

  // Smaller rooms common, larger rare: geometric-ish sampling
  const w = sampleRoomSize(rng, cfg.roomMinW, Math.min(cfg.roomMaxW, usableW));
  const h = sampleRoomSize(rng, cfg.roomMinH, Math.min(cfg.roomMaxH, usableH));

  const xMin = leaf.x + pad;
  const yMin = leaf.y + pad;

  const xMax = leaf.x + leaf.w - pad - w;
  const yMax = leaf.y + leaf.h - pad - h;

  const x = xMax >= xMin ? rng.int(xMin, xMax + 1) : clampInt(xMin, leaf.x, leaf.x + leaf.w - w);
  const y = yMax >= yMin ? rng.int(yMin, yMax + 1) : clampInt(yMin, leaf.y, leaf.y + leaf.h - h);

  const room: Room = {
    x,
    y,
    w,
    h,
    cx: x + Math.floor(w / 2),
    cy: y + Math.floor(h / 2)
  };

  node.room = room;
  node.conn = { x: room.cx, y: room.cy };

  for (let yy = room.y; yy < room.y + room.h; yy++) {
    for (let xx = room.x; xx < room.x + room.w; xx++) {
      cfg.isRoom[idx(xx, yy)] = 1;
    }
  }

  carveRectRoom(cfg.east, cfg.south, room.x, room.y, room.w, room.h);
}

function sampleRoomSize(rng: XorShift32, min: number, max: number): number {
  if (max <= min) return min;
  // Bias small: pick k candidates and take min
  const k = 3;
  let best = max;
  for (let i = 0; i < k; i++) {
    best = Math.min(best, rng.int(min, max + 1));
  }
  return clampInt(best, min, max);
}

// ---------------- Connections (corridors) ----------------

function connectSubtrees(node: BspNode, rng: XorShift32, cfg: { east: Uint8Array; south: Uint8Array }): void {
  if (!node.left || !node.right) return;

  connectSubtrees(node.left, rng, cfg);
  connectSubtrees(node.right, rng, cfg);

  const a = pickConnPoint(node.left, rng);
  const b = pickConnPoint(node.right, rng);
  if (!a || !b) return;

  carveCorridor(cfg.east, cfg.south, a.x, a.y, b.x, b.y, rng);

  node.conn = rng.int(0, 2) === 0 ? { x: a.x, y: a.y } : { x: b.x, y: b.y };
}

function pickConnPoint(node: BspNode, rng: XorShift32): { x: number; y: number } | null {
  if (!node.left && !node.right) return node.conn;

  if (node.conn) return node.conn;

  const candidates: Array<{ x: number; y: number }> = [];
  if (node.left) {
    const a = pickConnPoint(node.left, rng);
    if (a) candidates.push(a);
  }
  if (node.right) {
    const b = pickConnPoint(node.right, rng);
    if (b) candidates.push(b);
  }
  if (candidates.length === 0) return null;
  return candidates[rng.int(0, candidates.length)]!;
}

function carveCorridor(
  east: Uint8Array,
  south: Uint8Array,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rng: XorShift32
): void {
  x1 = clampInt(x1, 0, CHUNK_SIZE - 1);
  y1 = clampInt(y1, 0, CHUNK_SIZE - 1);
  x2 = clampInt(x2, 0, CHUNK_SIZE - 1);
  y2 = clampInt(y2, 0, CHUNK_SIZE - 1);

  // Occasional 2-wide corridors
  const wide = rng.int(0, 12) === 0;

  const horizFirst = rng.int(0, 2) === 0;
  if (x1 === x2 || y1 === y2) {
    carveLine(east, south, x1, y1, x2, y2, wide, rng);
    return;
  }

  if (horizFirst) {
    carveLine(east, south, x1, y1, x2, y1, wide, rng);
    carveLine(east, south, x2, y1, x2, y2, wide, rng);
  } else {
    carveLine(east, south, x1, y1, x1, y2, wide, rng);
    carveLine(east, south, x1, y2, x2, y2, wide, rng);
  }

  // Rare loop: add a detour segment
  if (rng.int(0, 25) === 0) {
    const midx = clampInt(Math.floor((x1 + x2) / 2) + rng.int(-6, 7), 1, CHUNK_SIZE - 2);
    const midy = clampInt(Math.floor((y1 + y2) / 2) + rng.int(-6, 7), 1, CHUNK_SIZE - 2);
    carveLine(east, south, x1, y1, midx, midy, wide, rng);
    carveLine(east, south, midx, midy, x2, y2, wide, rng);
  }
}

function carveLine(
  east: Uint8Array,
  south: Uint8Array,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  wide: boolean,
  rng: XorShift32
): void {
  x1 = clampInt(x1, 0, CHUNK_SIZE - 1);
  y1 = clampInt(y1, 0, CHUNK_SIZE - 1);
  x2 = clampInt(x2, 0, CHUNK_SIZE - 1);
  y2 = clampInt(y2, 0, CHUNK_SIZE - 1);

  const dx = Math.sign(x2 - x1);
  const dy = Math.sign(y2 - y1);

  let x = x1;
  let y = y1;

  while (x !== x2 || y !== y2) {
    const nx = x + (x !== x2 ? dx : 0);
    const ny = y + (y !== y2 ? dy : 0);
    openBetween(east, south, x, y, nx, ny);

    if (wide) {
      // Widen perpendicular to movement direction
      if (x !== nx) {
        // moving horizontally, widen vertically
        const off = rng.int(0, 2) === 0 ? -1 : 1;
        const y2w = clampInt(y + off, 0, CHUNK_SIZE - 1);
        const ny2w = clampInt(ny + off, 0, CHUNK_SIZE - 1);
        openBetween(east, south, x, y2w, nx, ny2w);
      } else if (y !== ny) {
        // moving vertically, widen horizontally
        const off = rng.int(0, 2) === 0 ? -1 : 1;
        const x2w = clampInt(x + off, 0, CHUNK_SIZE - 1);
        const nx2w = clampInt(nx + off, 0, CHUNK_SIZE - 1);
        openBetween(east, south, x2w, y, nx2w, ny);
      }
    }

    x = nx;
    y = ny;
  }
}

// ---------------- Door placement ----------------

function deriveCorridorMask(east: Uint8Array, south: Uint8Array, isRoom: Uint8Array): Uint8Array {
  // Corridor = any non-room cell that participates in at least one OPEN edge.
  const isCorr = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const i = idx(x, y);
      if (isRoom[i]) continue;

      let open = false;
      if (x < CHUNK_SIZE - 1 && east[i] === EDGE_OPEN) open = true;
      if (y < CHUNK_SIZE - 1 && south[i] === EDGE_OPEN) open = true;
      if (x > 0 && east[idx(x - 1, y)] === EDGE_OPEN) open = true;
      if (y > 0 && south[idx(x, y - 1)] === EDGE_OPEN) open = true;

      if (open) isCorr[i] = 1;
    }
  }

  return isCorr;
}

function enforceRoomCorridorDoors(east: Uint8Array, south: Uint8Array, isRoom: Uint8Array, isCorr: Uint8Array): void {
  // East edges
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let x = 0; x < CHUNK_SIZE - 1; x++) {
      const i = idx(x, y);
      if (east[i] !== EDGE_OPEN) continue;

      const aRoom = isRoom[i] === 1;
      const bRoom = isRoom[idx(x + 1, y)] === 1;

      if (aRoom === bRoom) continue; // not a boundary

      const aCorr = isCorr[i] === 1;
      const bCorr = isCorr[idx(x + 1, y)] === 1;

      if ((aRoom && bCorr) || (bRoom && aCorr)) {
        east[i] = EDGE_DOOR;
      }
    }
  }

  // South edges
  for (let y = 0; y < CHUNK_SIZE - 1; y++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const i = idx(x, y);
      if (south[i] !== EDGE_OPEN) continue;

      const aRoom = isRoom[i] === 1;
      const bRoom = isRoom[idx(x, y + 1)] === 1;

      if (aRoom === bRoom) continue;

      const aCorr = isCorr[i] === 1;
      const bCorr = isCorr[idx(x, y + 1)] === 1;

      if ((aRoom && bCorr) || (bRoom && aCorr)) {
        south[i] = EDGE_DOOR;
      }
    }
  }
}

function sanitizeDoorsToRoomBoundaries(east: Uint8Array, south: Uint8Array, isRoom: Uint8Array): void {
  // Any DOOR edge not between room and non-room becomes OPEN.
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let x = 0; x < CHUNK_SIZE - 1; x++) {
      const i = idx(x, y);
      if (east[i] !== EDGE_DOOR) continue;

      const aRoom = isRoom[i] === 1;
      const bRoom = isRoom[idx(x + 1, y)] === 1;
      if (aRoom === bRoom) east[i] = EDGE_OPEN;
    }
  }

  for (let y = 0; y < CHUNK_SIZE - 1; y++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const i = idx(x, y);
      if (south[i] !== EDGE_DOOR) continue;

      const aRoom = isRoom[i] === 1;
      const bRoom = isRoom[idx(x, y + 1)] === 1;
      if (aRoom === bRoom) south[i] = EDGE_OPEN;
    }
  }
}

function ensureAllRoomsHaveAtLeastOneDoor(
  node: BspNode,
  rng: XorShift32,
  cfg: { east: Uint8Array; south: Uint8Array; isRoom: Uint8Array }
): void {
  if (node.left && node.right) {
    ensureAllRoomsHaveAtLeastOneDoor(node.left, rng, cfg);
    ensureAllRoomsHaveAtLeastOneDoor(node.right, rng, cfg);
    return;
  }
  if (!node.room) return;

  const room = node.room;

  // Scan for an existing door on the room perimeter
  if (roomHasDoor(room, cfg.east, cfg.south)) return;

  // Try to create one: pick a random perimeter cell and open outward by one step.
  const attempts = 40;
  for (let t = 0; t < attempts; t++) {
    const side = rng.int(0, 4);
    let x = room.x;
    let y = room.y;

    if (side === 0) {
      // north edge of room
      x = rng.int(room.x, room.x + room.w);
      y = room.y;
      if (y <= 0) continue;
      // edge between (x,y-1) and (x,y) is south[x,y-1]
      const iOut = idx(x, y - 1);
      if (cfg.isRoom[iOut]) continue;
      cfg.south[iOut] = EDGE_DOOR;
      return;
    } else if (side === 1) {
      // south edge
      x = rng.int(room.x, room.x + room.w);
      y = room.y + room.h - 1;
      if (y >= CHUNK_SIZE - 1) continue;
      const i = idx(x, y);
      const iOut = idx(x, y + 1);
      if (cfg.isRoom[iOut]) continue;
      cfg.south[i] = EDGE_DOOR;
      return;
    } else if (side === 2) {
      // west edge
      x = room.x;
      y = rng.int(room.y, room.y + room.h);
      if (x <= 0) continue;
      const iOut = idx(x - 1, y);
      if (cfg.isRoom[iOut]) continue;
      cfg.east[iOut] = EDGE_DOOR;
      return;
    } else {
      // east edge
      x = room.x + room.w - 1;
      y = rng.int(room.y, room.y + room.h);
      if (x >= CHUNK_SIZE - 1) continue;
      const i = idx(x, y);
      const iOut = idx(x + 1, y);
      if (cfg.isRoom[iOut]) continue;
      cfg.east[i] = EDGE_DOOR;
      return;
    }
  }
}

function roomHasDoor(room: Room, east: Uint8Array, south: Uint8Array): boolean {
  // Check perimeter edges for EDGE_DOOR
  for (let x = room.x; x < room.x + room.w; x++) {
    // north perimeter: between (x, room.y-1) and (x, room.y) => south at (x, room.y-1)
    if (room.y > 0 && south[idx(x, room.y - 1)] === EDGE_DOOR) return true;
    // south perimeter: south at (x, room.y + room.h - 1)
    if (room.y + room.h - 1 < CHUNK_SIZE - 1 && south[idx(x, room.y + room.h - 1)] === EDGE_DOOR) return true;
  }
  for (let y = room.y; y < room.y + room.h; y++) {
    // west perimeter: east at (room.x - 1, y)
    if (room.x > 0 && east[idx(room.x - 1, y)] === EDGE_DOOR) return true;
    // east perimeter: east at (room.x + room.w - 1, y)
    if (room.x + room.w - 1 < CHUNK_SIZE - 1 && east[idx(room.x + room.w - 1, y)] === EDGE_DOOR) return true;
  }
  return false;
}

// ---------------- Carving helpers ----------------

function carveRectRoom(east: Uint8Array, south: Uint8Array, x: number, y: number, w: number, h: number): void {
  // Open all interior edges within the rectangle
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (xx < x + w - 1) {
        east[idx(xx, yy)] = EDGE_OPEN;
      }
      if (yy < y + h - 1) {
        south[idx(xx, yy)] = EDGE_OPEN;
      }
    }
  }
}

function openBetween(east: Uint8Array, south: Uint8Array, x1: number, y1: number, x2: number, y2: number): void {
  if (!inBounds(x1, y1) || !inBounds(x2, y2)) return;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return;

  if (dx === 1) {
    east[idx(x1, y1)] = EDGE_OPEN;
  } else if (dx === -1) {
    east[idx(x2, y2)] = EDGE_OPEN;
  } else if (dy === 1) {
    south[idx(x1, y1)] = EDGE_OPEN;
  } else if (dy === -1) {
    south[idx(x2, y2)] = EDGE_OPEN;
  }
}

// ---------------- Utilities ----------------

function idx(x: number, y: number): number {
  return y * CHUNK_SIZE + x;
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < CHUNK_SIZE && y < CHUNK_SIZE;
}

function clampInt(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v | 0;
}