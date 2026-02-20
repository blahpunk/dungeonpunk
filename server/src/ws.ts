// server/src/ws.ts

import type { Server as HttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { CONFIG } from './config.js';
import { safeParseClient } from './protocol.js';
import type { DB } from './db.js';
import { loadSession, loadActiveCharacter, savePosition } from './state.js';
import { DbOverlayProvider } from './overlays.js';
import { DbDiscoveryProvider } from './discovery.js';
import { WorldEngine } from '@infinite-dungeon/engine';
import type { Dir } from '@infinite-dungeon/engine';

interface ConnState {
  authed: boolean;
  userId?: string;
  characterId?: string;
  worldId?: string;
  lastSeq: number;
  cooldowns: { moveReadyAtMs: number; turnReadyAtMs: number };
}

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // allow non-browser clients
  const allowed = CONFIG.httpOrigins;
  if (allowed.includes('*')) return true;
  return allowed.includes(origin);
}

function isDir(v: any): v is Dir {
  return v === 'N' || v === 'E' || v === 'S' || v === 'W';
}

function oppositeDir(d: Dir): Dir {
  if (d === 'N') return 'S';
  if (d === 'S') return 'N';
  if (d === 'E') return 'W';
  return 'E';
}

function getWorldSeed(db: DB, worldId: string): number {
  // Prefer stored per-world seed (changes after wipe because worlds table is recreated).
  try {
    const row = db.prepare(`SELECT seed FROM worlds WHERE world_id = ? LIMIT 1`).get(worldId) as any;
    const s = Number(row?.seed);
    if (Number.isFinite(s)) return s;
  } catch {
    // ignore
  }

  // Fallback: allow forced deterministic seed via env; otherwise stable default.
  const forced = process.env.WORLD_SEED;
  if (forced) {
    const s = Number(forced);
    if (Number.isFinite(s)) return s;
  }

  return 12345;
}

export function attachWs(httpServer: HttpServer, db: DB): void {
  const wss = new WebSocketServer({ server: httpServer, path: CONFIG.wsPath });

  wss.on('connection', (ws, req) => {
    const origin = req.headers.origin as string | undefined;

    if (!originAllowed(origin)) {
      console.warn(`[ws] reject origin=${origin ?? '(none)'} allowed=${CONFIG.httpOrigins.join(',')}`);
      ws.close(1008, 'bad origin');
      return;
    }

    const state: ConnState = {
      authed: false,
      lastSeq: -1,
      cooldowns: { moveReadyAtMs: 0, turnReadyAtMs: 0 }
    };

    ws.on('message', (data) => {
      let json: any;
      try {
        json = JSON.parse(data.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', payload: { code: 'bad_json', message: 'invalid json' } }));
        return;
      }

      const parsed = safeParseClient(json);
      if (!parsed.ok) {
        ws.send(JSON.stringify({ type: 'error', payload: { code: 'bad_schema', message: parsed.err } }));
        return;
      }

      const msg = parsed.msg;
      if (msg.seq <= state.lastSeq) {
        ws.send(JSON.stringify({ type: 'error', payload: { code: 'bad_seq', message: 'seq must increase', seq: msg.seq } }));
        return;
      }
      state.lastSeq = msg.seq;

      if (!state.authed && msg.type !== 'auth') {
        ws.send(JSON.stringify({ type: 'auth_err', payload: { reason: 'unauthenticated' } }));
        return;
      }

      if (msg.type === 'auth') {
        const res = loadSession(db, msg.payload.session_token);
        if (!res.ok) {
          ws.send(JSON.stringify({ type: 'auth_err', payload: { reason: 'invalid session' } }));
          return;
        }

        const userId = res.userId!;
        const active = loadActiveCharacter(db, userId);

        state.authed = true;
        state.userId = userId;
        state.characterId = active.characterId;
        state.worldId = active.worldId;

        // turning is instant => always ready
        state.cooldowns = { moveReadyAtMs: Date.now(), turnReadyAtMs: Date.now() };

        ws.send(
          JSON.stringify({
            type: 'auth_ok',
            payload: { user_id: userId, character_id: active.characterId, world_id: active.worldId }
          })
        );

        sendWorldState(ws, db, state, active);
        return;
      }

      if (!state.userId || !state.characterId || !state.worldId) {
        ws.send(JSON.stringify({ type: 'error', payload: { code: 'state', message: 'missing authed state' } }));
        return;
      }

      const active = loadActiveCharacter(db, state.userId);

      if (msg.type === 'move') {
        const now = Date.now();
        if (now < state.cooldowns.moveReadyAtMs) {
          ws.send(JSON.stringify({ type: 'action_result', payload: { ok: false, reason: 'move_cooldown', seq: msg.seq } }));
          return;
        }

        const overlay = new DbOverlayProvider(db, state.worldId);
        const discovery = new DbDiscoveryProvider(db, state.worldId);
        const engine = new WorldEngine({
          seed: getWorldSeed(db, state.worldId),
          overlay,
          discovery,
          time: { nowMs: () => Date.now() }
        });

        // Support relative movement:
        // - 'F' => move forward in current facing
        // - 'B' => move backward (opposite), but keep facing unchanged
        // - 'N'|'E'|'S'|'W' => move in that direction (also updates facing to that dir)
        const payloadDir: any = msg.payload.dir;

        const currentFace = (isDir(active.face) ? (active.face as Dir) : 'N') as Dir;

        let moveDir: Dir;
        let newFace: Dir;

        if (payloadDir === 'F') {
          moveDir = currentFace;
          newFace = currentFace;
        } else if (payloadDir === 'B') {
          moveDir = oppositeDir(currentFace);
          newFace = currentFace;
        } else if (isDir(payloadDir)) {
          moveDir = payloadDir;
          newFace = payloadDir;
        } else {
          ws.send(JSON.stringify({ type: 'action_result', payload: { ok: false, reason: 'bad_dir', seq: msg.seq } }));
          return;
        }

        const playerForMove = { levelId: active.levelId, x: active.x, y: active.y, face: moveDir, hp: active.hp };
        const r = engine.move(playerForMove, state.cooldowns);

        if (!r.ok || !r.player) {
          ws.send(JSON.stringify({ type: 'action_result', payload: { ok: false, reason: r.reason, seq: msg.seq } }));
          return;
        }

        state.cooldowns.moveReadyAtMs = now + CONFIG.moveCooldownMs;

        // Persist: position from move result; facing = computed newFace
        savePosition(db, active.characterId, r.player.levelId, r.player.x, r.player.y, newFace);

        ws.send(JSON.stringify({ type: 'action_result', payload: { ok: true, seq: msg.seq } }));

        sendWorldState(ws, db, state, {
          ...active,
          levelId: r.player.levelId,
          x: r.player.x,
          y: r.player.y,
          face: newFace,
          hp: r.player.hp
        });

        return;
      }

      if (msg.type === 'turn') {
        // instant turn
        savePosition(db, active.characterId, active.levelId, active.x, active.y, msg.payload.face);
        ws.send(JSON.stringify({ type: 'action_result', payload: { ok: true, seq: msg.seq } }));
        sendWorldState(ws, db, state, { ...active, face: msg.payload.face });
        return;
      }

      if (msg.type === 'interact' || msg.type === 'use_egg' || msg.type === 'join_world') {
        ws.send(JSON.stringify({ type: 'action_result', payload: { ok: false, reason: 'not_implemented', seq: msg.seq } }));
        return;
      }

      ws.send(JSON.stringify({ type: 'error', payload: { code: 'unknown', message: 'unhandled message', seq: msg.seq } }));
    });

    ws.on('close', (code, reason) => {
      console.log(`[ws] closed code=${code} reason=${reason?.toString?.() ?? ''}`);
    });
  });
}

function sendWorldState(ws: any, db: DB, state: ConnState, active: any): void {
  const overlay = new DbOverlayProvider(db, state.worldId!);
  const discovery = new DbDiscoveryProvider(db, state.worldId!);
  const engine = new WorldEngine({
    seed: getWorldSeed(db, state.worldId!),
    overlay,
    discovery,
    time: { nowMs: () => Date.now() }
  });

  // Ensure current cell is discovered.
  discovery.markDiscovered(active.levelId, active.x, active.y, Date.now());

  const player = { levelId: active.levelId, x: active.x, y: active.y, face: active.face, hp: active.hp };
  const view = engine.view(player, state.cooldowns);

  const hub = engine.getHub(active.levelId);
  const distFeet = engine.distanceFeetToHub(active.levelId, active.x, active.y);

  ws.send(
    JSON.stringify({
      type: 'world_state',
      payload: {
        now: view.nowMs,
        you: { level: player.levelId, x: player.x, y: player.y, face: player.face, hp: player.hp, status: [] },
        hub: {
          level: hub.levelId,
          x: hub.x,
          y: hub.y,
          dist_feet: distFeet,
          direction: approximateDirToHub(active.x, active.y)
        },
        visible_cells: view.visibleCells,
        minimap_patch: view.minimapCells,
        nearby_entities: [],
        cooldowns: view.cooldowns,
        world_hash: engine.stateHash(player, state.cooldowns)
      }
    })
  );
}

function approximateDirToHub(x: number, y: number): string {
  const dx = -x;
  const dy = -y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'E' : 'W';
  if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? 'S' : 'N';
  return dx > 0 ? 'E' : 'W';
}