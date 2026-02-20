import { describe, expect, test } from 'vitest';
import { stableHash } from '@infinite-dungeon/engine';

// Placeholder test so server package has a test step.
// We validate the hash function is reachable through workspace wiring.

describe('server wiring', () => {
  test('engine import works', () => {
    expect(stableHash({ a: 1 })).toMatch(/^[0-9a-f]{8}$/);
  });
});
