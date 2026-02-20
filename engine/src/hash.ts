// Stable hash for replay stability tests.
// Not cryptographic.

export function stableHash(obj: unknown): string {
  const s = stableStringify(obj);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, replacer);
}

function replacer(_key: string, value: any): any {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: any = {};
    for (const k of Object.keys(value).sort()) out[k] = value[k];
    return out;
  }
  return value;
}
