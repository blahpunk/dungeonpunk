// engine/src/maze.ts
import { XorShift32, hashSeed } from './prng.js';
import type { ChunkEdges, Dir } from './types.js';

const CHUNK_SIZE = 64;

// Edge encoding inside chunk arrays:
// 0 = wall
// 1 = open
// 2 = door (unlocked)
const EDGE_WALL = 0;
const EDGE_OPEN = 1;
const EDGE_DOOR = 2;

export function generateChunkMaze(seed: number, levelId: number, chunkX: number, chunkY: number): ChunkEdges {
  const rng = new XorShift32(hashSeed(seed, levelId, chunkX, chunkY, 'maze'));

  const east = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  const south = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  const visited = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

  // DFS backtracker maze carve
  const stack: Array<{ x: number; y: number }> = [];
  const sx = rng.int(0, CHUNK_SIZE);
  const sy = rng.int(0, CHUNK_SIZE);

  stack.push({ x: sx, y: sy });
  visited[idx(sx, sy)] = 1;

  const dirs: Dir[] = ['N', 'E', 'S', 'W'];

  while (stack.length) {
    const cur = stack[stack.length - 1];
    rng.shuffleInPlace(dirs);

    let moved = false;
    for (const d of dirs) {
      const n = stepLocal(cur.x, cur.y, d);
      if (!inBounds(n.x, n.y)) continue;
      if (visited[idx(n.x, n.y)]) continue;

      openBetween(east, south, cur.x, cur.y, d, EDGE_OPEN);
      visited[idx(n.x, n.y)] = 1;
      stack.push({ x: n.x, y: n.y });
      moved = true;
      break;
    }

    if (!moved) stack.pop();
  }

  // Rooms + doors (deterministic per chunk)
  carveRooms(east, south, rng);
  placeDoors(east, south, rng);

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

type RoomSize = { w: number; h: number; weight: number };

const ROOM_SIZES: RoomSize[] = [
  { w: 2, h: 2, weight: 18 },
  { w: 3, h: 2, weight: 18 },
  { w: 2, h: 3, weight: 18 },
  { w: 3, h: 3, weight: 14 },
  { w: 4, h: 3, weight: 10 },
  { w: 3, h: 4, weight: 10 },
  { w: 4, h: 4, weight: 7 },
  { w: 4, h: 5, weight: 3 },
  { w: 5, h: 4, weight: 3 }
];

function pickWeightedRoomSize(rng: XorShift32): { w: number; h: number } {
  let total = 0;
  for (const s of ROOM_SIZES) total += s.weight;

  let roll = rng.int(0, total);
  for (const s of ROOM_SIZES) {
    roll -= s.weight;
    if (roll < 0) return { w: s.w, h: s.h };
  }
  return { w: 2, h: 2 };
}

function carveRooms(east: Uint8Array, south: Uint8Array, rng: XorShift32): void {
  // More rooms, larger variety.
  const attempts = 55;

  for (let i = 0; i < attempts; i++) {
    const { w, h } = pickWeightedRoomSize(rng);

    // Keep a 1-cell margin so we don't smash chunk boundaries too hard.
    const x0 = rng.int(1, CHUNK_SIZE - w - 1);
    const y0 = rng.int(1, CHUNK_SIZE - h - 1);

    // Carve internal edges fully open to form a room rectangle.
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        // open east inside room
        if (x < x0 + w - 1) setEast(east, x, y, EDGE_OPEN);
        // open south inside room
        if (y < y0 + h - 1) setSouth(south, x, y, EDGE_OPEN);
      }
    }

    // Ensure multiple connections from room to maze by opening 1-3 perimeter walls.
    const openings = 1 + rng.int(0, 3); // 1..3
    for (let k = 0; k < openings; k++) {
      const side = rng.int(0, 4); // 0=N 1=E 2=S 3=W

      if (side === 0) {
        // north opening: south edge of cell above (x, y0-1) becomes open
        const x = rng.int(x0, x0 + w);
        const y = y0;
        if (y > 0) setSouth(south, x, y - 1, EDGE_OPEN);
      } else if (side === 1) {
        // east opening: east edge of rightmost column
        const x = x0 + w - 1;
        const y = rng.int(y0, y0 + h);
        setEast(east, x, y, EDGE_OPEN);
      } else if (side === 2) {
        // south opening: south edge of bottom row
        const x = rng.int(x0, x0 + w);
        const y = y0 + h - 1;
        setSouth(south, x, y, EDGE_OPEN);
      } else {
        // west opening: east edge of cell left of room
        const x = x0;
        const y = rng.int(y0, y0 + h);
        if (x > 0) setEast(east, x - 1, y, EDGE_OPEN);
      }
    }
  }
}

function placeDoors(east: Uint8Array, south: Uint8Array, rng: XorShift32): void {
  // More doors, but still reasonable. Deterministic per chunk.
  const doorChance = 0.095;

  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const i = idx(x, y);

      if (east[i] === EDGE_OPEN && rng.float01() < doorChance) {
        east[i] = EDGE_DOOR;
      }
      if (south[i] === EDGE_OPEN && rng.float01() < doorChance) {
        south[i] = EDGE_DOOR;
      }
    }
  }
}

function idx(x: number, y: number): number {
  return y * CHUNK_SIZE + x;
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < CHUNK_SIZE && y < CHUNK_SIZE;
}

function stepLocal(x: number, y: number, dir: Dir): { x: number; y: number } {
  if (dir === 'N') return { x, y: y - 1 };
  if (dir === 'S') return { x, y: y + 1 };
  if (dir === 'E') return { x: x + 1, y };
  return { x: x - 1, y };
}

function setEast(east: Uint8Array, x: number, y: number, v: number): void {
  if (!inBounds(x, y)) return;
  east[idx(x, y)] = v;
}

function setSouth(south: Uint8Array, x: number, y: number, v: number): void {
  if (!inBounds(x, y)) return;
  south[idx(x, y)] = v;
}

function openBetween(east: Uint8Array, south: Uint8Array, x: number, y: number, dir: Dir, v: number): void {
  if (dir === 'E') setEast(east, x, y, v);
  else if (dir === 'S') setSouth(south, x, y, v);
  else if (dir === 'W') setEast(east, x - 1, y, v);
  else setSouth(south, x, y - 1, v);
}