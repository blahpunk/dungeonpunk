// engine/src/prng.ts
// Deterministic RNG utilities for procedural generation.
// This file intentionally provides stable exports for the rest of the engine.

export class XorShift32 {
  private s: number;

  constructor(seed: number) {
    // Force non-zero 32-bit state
    this.s = (seed | 0) || 0x9e3779b9;
  }

  nextU32(): number {
    let x = this.s | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x | 0;
    return this.s >>> 0;
  }

  float01(): number {
    return this.nextU32() / 0xffffffff;
  }

  int(minInclusive: number, maxExclusive: number): number {
    const min = Math.floor(minInclusive);
    const max = Math.floor(maxExclusive);
    if (!(max > min)) return min;
    const span = max - min;
    return min + (this.nextU32() % span);
  }

  shuffleInPlace<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const tmp = arr[i];
      arr[i] = arr[j]!;
      arr[j] = tmp!;
    }
    return arr;
  }
}

/**
 * Stable seed mixer for chunk + level + label.
 * Keep everything in 32-bit int space.
 */
export function hashSeed(seed: number, levelId: number, chunkX: number, chunkY: number, label: string): number {
  let h = 2166136261 >>> 0; // FNV-1a offset
  const mixU32 = (v: number) => {
    h ^= (v >>> 0);
    h = Math.imul(h, 16777619) >>> 0;
  };

  mixU32(seed);
  mixU32(levelId);
  mixU32(chunkX);
  mixU32(chunkY);

  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i) & 0xff;
    h = Math.imul(h, 16777619) >>> 0;
  }

  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;

  return h | 0;
}
