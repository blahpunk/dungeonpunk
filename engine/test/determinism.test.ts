import { describe, expect, test } from 'vitest';
import { generateChunkMaze } from '../src/maze.js';
import { stableHash } from '../src/hash.js';

describe('determinism', () => {
  test('generateChunkMaze stable for same inputs', () => {
    const seed = 12345;
    const a = generateChunkMaze(seed, 1, 0, 0);
    const b = generateChunkMaze(seed, 1, 0, 0);

    expect(stableHash(Array.from(a.east))).toBe(stableHash(Array.from(b.east)));
    expect(stableHash(Array.from(a.south))).toBe(stableHash(Array.from(b.south)));
  });

  test('generateChunkMaze differs for different chunk', () => {
    const seed = 12345;
    const a = generateChunkMaze(seed, 1, 0, 0);
    const b = generateChunkMaze(seed, 1, 1, 0);

    expect(stableHash(Array.from(a.east))).not.toBe(stableHash(Array.from(b.east)));
  });
});
