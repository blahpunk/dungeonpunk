// engine/src/types.ts
export type Dir = 'N' | 'E' | 'S' | 'W';

export type EdgeType = 'wall' | 'open' | 'door_locked' | 'door_unlocked' | 'lever_secret';

export interface CellCoord {
  levelId: number;
  x: number;
  y: number;
}

export interface EdgeRef {
  levelId: number;
  x: number;
  y: number;
  dir: Dir;
}

export interface ChunkKey {
  levelId: number;
  chunkX: number;
  chunkY: number;
}

export interface ChunkEdges {
  // Metadata (required so edge post-processing can be deterministic without extra inputs)
  seed: number;
  levelId: number;
  chunkX: number;
  chunkY: number;

  // Canonical storage: for each cell (local 0..63), store East and South edges.
  // North/West are derived from neighbors.
  //
  // Encoding (Uint8):
  // 0 = wall
  // 1 = open
  // 2 = door (unlocked)
  east: Uint8Array; // length 64*64
  south: Uint8Array; // length 64*64
}

export interface PlayerState {
  levelId: number;
  x: number;
  y: number;
  face: Dir;
  hp: number;
}

export interface ViewCell {
  x: number;
  y: number;
  // Edge types for rendering/validation (N/E/S/W)
  edges: Record<Dir, EdgeType>;
}

export type MinimapCell = {
  x: number;
  y: number;
  edges: Record<Dir, EdgeType>;
};

export interface WorldView {
  nowMs: number;
  you: PlayerState;
  visibleCells: ViewCell[]; // depth 3 rays (all directions)
  minimapCells: MinimapCell[]; // discovered around you (with edges)
  cooldowns: {
    moveReadyAtMs: number;
    turnReadyAtMs: number;
  };
}
