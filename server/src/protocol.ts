// server/src/protocol.ts
import type { Dir } from '@infinite-dungeon/engine';

type ClientMsg =
  | { seq: number; type: 'auth'; payload: { session_token: string } }
  | { seq: number; type: 'move'; payload: { dir: Dir | 'F' | 'B' } }
  | { seq: number; type: 'turn'; payload: { face: Dir } }
  | { seq: number; type: 'join_world'; payload: { world_id: string } }
  | { seq: number; type: 'interact'; payload: any }
  | { seq: number; type: 'use_egg'; payload: any };

function isRecord(v: any): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isDir(v: any): v is Dir {
  return v === 'N' || v === 'E' || v === 'S' || v === 'W';
}

export function safeParseClient(input: any): { ok: true; msg: ClientMsg } | { ok: false; err: string } {
  if (!isRecord(input)) return { ok: false, err: 'message must be an object' };
  if (typeof input.seq !== 'number' || !Number.isFinite(input.seq)) return { ok: false, err: 'seq must be a number' };
  if (typeof input.type !== 'string') return { ok: false, err: 'type must be a string' };
  if (!isRecord(input.payload)) return { ok: false, err: 'payload must be an object' };

  const seq = input.seq as number;
  const type = input.type as string;
  const payload = input.payload as any;

  if (type === 'auth') {
    const t = payload.session_token;
    if (typeof t !== 'string' || !t) return { ok: false, err: 'auth.session_token required' };
    return { ok: true, msg: { seq, type: 'auth', payload: { session_token: t } } };
  }

  if (type === 'move') {
    const d = payload.dir;
    const ok = isDir(d) || d === 'F' || d === 'B';
    if (!ok) return { ok: false, err: 'move.dir must be N/E/S/W or F/B' };
    return { ok: true, msg: { seq, type: 'move', payload: { dir: d } } };
  }

  if (type === 'turn') {
    const f = payload.face;
    if (!isDir(f)) return { ok: false, err: 'turn.face must be N/E/S/W' };
    return { ok: true, msg: { seq, type: 'turn', payload: { face: f } } };
  }

  if (type === 'join_world') {
    const w = payload.world_id;
    if (typeof w !== 'string' || !w) return { ok: false, err: 'join_world.world_id required' };
    return { ok: true, msg: { seq, type: 'join_world', payload: { world_id: w } } };
  }

  if (type === 'interact') {
    return { ok: true, msg: { seq, type: 'interact', payload } };
  }

  if (type === 'use_egg') {
    return { ok: true, msg: { seq, type: 'use_egg', payload } };
  }

  return { ok: false, err: `unknown type: ${type}` };
}
