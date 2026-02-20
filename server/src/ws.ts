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

interface ConnState {
  authed: boolean;
  userId?: string;
  characterId?: string;
  worldId?: string;
  lastSeq: number;
  cooldowns: { moveReadyAtMs: number; turnReadyAtMs: number };
}

function normalizeOrigin(origin: string) {
  return origin.trim().toLowerCase().replace(/\/+$/, '');
}

function isAllowedDevOrigin(origin: string): boolean {
  const o = normalizeOrigin(origin);

  // If config explicitly allows '*' then accept anything.
  const allowed = CONFIG.httpOrigins;
  if (allowed.includes('*')) return true;

  // Exact config matches (normalized)
  for (const a of allowed) {
    if (normalizeOrigin(a) === o) return true;
  }

  // Common dev origins (helpful if CONFIG.httpOrigins is still the default localhost-only)
  const defaults = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
  if (defaults.has(o)) return true;

  // Allow your LAN dev host(s) on Vite port 5173
  // - If you want to be strict, replace this regex with a single exact IP.
  if (/^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:5173$/.test(o)) return true;

  return false;
}

function originAllowed(origin: string | undefined): boolean {
  // Browsers always send Origin. Some non-browser WS clients may not.
  // Allow missing Origin to avoid breaking local tooling.
  if (!origin) return true;
  return isAllowedDevOrigin(origin);
}

function getWorldSeed(db: DB, worldId: string): number {
  const row = db.prepare('SELECT seed FROM worlds WHERE world_id = ? LIMIT 1').get(worldId) as any;
  const s = row?.seed;
  const n = typeof s === 'number' ? s : Number(s);
  return Number.isFinite(n) ? n : 12345;
}

export function attachWs(httpServer: HttpServer, db: DB): void {
  const wss = new WebSocketServer({ server: httpServer, path: CONFIG.wsPath });

  wss.on('connection', (ws, req) => {
    const origin = req.headers.origin as string | undefined;

    if (!originAllowed(origin)) {
      const allowedLabel = [
        ...CONFIG.httpOrigins,
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://192.168.*.*:5173'
      ].join(',');
      console.warn(`[ws] reject origin=${origin ?? '(none)'} allowed=${allowedLabel}`);
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
        const sess = loadSession(db, msg.payload.session_token);
        if (!sess) {
          ws.send(JSON.stringify({ type: 'auth_err', payload: { reason: 'invalid session' } }));
          return;
        }

        const userId = sess.userId;
        const active = loadActiveCharacter(db, userId);

        state.authed = true;
        state.userId = userId;
        state.characterId = active.characterId;
        state.worldId = active.worldId;

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

        const player = { levelId: active.levelId, x: active.x, y: active.y, face: active.face, hp: active.hp };
        const r = engine.move(player, state.cooldowns, msg.payload.dir);

        if (!r.ok || !r.player) {
          ws.send(JSON.stringify({ type: 'action_result', payload: { ok: false, reason: r.reason, seq: msg.seq } }));
          return;
        }

        state.cooldowns.moveReadyAtMs = now + CONFIG.moveCooldownMs;

        savePosition(db, active.characterId, state.worldId, r.player.levelId, r.player.x, r.player.y, r.player.face);

        ws.send(JSON.stringify({ type: 'action_result', payload: { ok: true, seq: msg.seq } }));
        sendWorldState(ws, db, state, {
          ...active,
          levelId: r.player.levelId,
          x: r.player.x,
          y: r.player.y,
          face: r.player.face,
          hp: r.player.hp
        });
        return;
      }

      if (msg.type === 'turn') {
        const now = Date.now();
        if (now < state.cooldowns.turnReadyAtMs) {
          ws.send(JSON.stringify({ type: 'action_result', payload: { ok: false, reason: 'turn_cooldown', seq: msg.seq } }));
          return;
        }

        state.cooldowns.turnReadyAtMs = now + CONFIG.turnCooldownMs;

        savePosition(db, active.characterId, state.worldId, active.levelId, active.x, active.y, msg.payload.face);

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

  discovery.markDiscovered(active.levelId, active.x, active.y, Date.now());

  const player = { levelId: active.levelId, x: active.x, y: active.y, face: active.face, hp: active.hp };
  const view = engine.view(player, state.cooldowns);

  const hub = engine.getHub(active.levelId);
  const distFeet = engine.distanceFeetToHub(active.levelId, active.x, active.y);

  ws.send(
    JSON.stringify({
      type: 'world_state',
      payload: {
        you: view.you,
        hub: { level: hub.levelId, x: hub.x, y: hub.y, distFeet, direction: view.you.face },
        cooldowns: view.cooldowns,
        world_hash: engine.stateHash(player, state.cooldowns),
        visible_cells: view.visibleCells,
        minimap_cells: view.minimapCells
      }
    })
  );
}