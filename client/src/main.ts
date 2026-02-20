// client/src/main.ts

type WsMsg = any;

type DevLoginResponse = {
  sessionToken: string;
  userId: string;
  characterId: string;
  worldId: string;
};

type CellEdges = Record<string, string>;
type VisibleCell = { x: number; y: number; edges?: CellEdges; level?: number };

const statusEl = document.getElementById('status') as HTMLSpanElement;
const mainEl = document.getElementById('main') as HTMLPreElement;
const metaEl = document.getElementById('meta') as HTMLPreElement;
const emailEl = document.getElementById('email') as HTMLInputElement;
const loginBtn = document.getElementById('login') as HTMLButtonElement;

const canvas = document.getElementById('minimap') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

let ws: WebSocket | null = null;
let seq = 0;
let lastState: any = null;

type DiscoveredCell = { level: number; x: number; y: number; edges: CellEdges };
const discovered = new Map<string, DiscoveredCell>();

function key(level: number, x: number, y: number) {
  return `${level}:${x}:${y}`;
}

function setStatus(s: string) {
  statusEl.textContent = ` ${s}`;
}

async function devLogin(email: string): Promise<DevLoginResponse> {
  const r = await fetch('/dev/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as DevLoginResponse;
}

function connect(sessionToken: string) {
  if (ws) ws.close();

  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${wsProto}//${location.host}/ws`;

  ws = new WebSocket(url);
  setStatus('connecting...');

  ws.onopen = () => {
    setStatus('ws open, authenticating...');
    send({ type: 'auth', payload: { session_token: sessionToken } });
  };

  ws.onmessage = (ev) => {
    const msg: WsMsg = JSON.parse(ev.data);

    if (msg.type === 'auth_ok') {
      setStatus('authenticated');
      try {
        (document.activeElement as HTMLElement | null)?.blur?.();
      } catch {}
      focusGameSurface();
      return;
    }
    if (msg.type === 'auth_err') {
      setStatus(`auth_err: ${msg.payload?.reason ?? 'unknown'}`);
      return;
    }
    if (msg.type === 'world_state') {
      lastState = msg.payload;

      mergeDiscovered(msg.payload);
      renderState(msg.payload);
      return;
    }
  };

  ws.onclose = (ev) => setStatus(`ws closed (code=${ev.code})`);
  ws.onerror = () => setStatus('ws error');
}

function send(msg: any) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ ...msg, seq: seq++ }));
}

function normalizeEdges(v: any): CellEdges {
  if (!v || typeof v !== 'object') return {};
  const out: CellEdges = {};
  for (const [k, val] of Object.entries(v)) {
    if (val === null || val === undefined) continue;
    out[String(k)] = String(val);
  }
  return out;
}

function mergeCell(level: number, x: number, y: number, edges: CellEdges) {
  const k = key(level, x, y);
  const prev = discovered.get(k);
  if (!prev) {
    discovered.set(k, { level, x, y, edges });
    return;
  }

  const merged: CellEdges = { ...(prev.edges ?? {}) };
  for (const [ek, ev] of Object.entries(edges ?? {})) {
    if (ev === null || ev === undefined) continue;
    merged[ek] = String(ev);
  }
  discovered.set(k, { level, x, y, edges: merged });
}

function mergeDiscovered(s: any) {
  const you = s?.you;
  if (!you) return;

  const level = Number(you.level ?? you.levelId ?? 1);

  // Server sends `minimap_cells` (ws.ts). Accept a couple aliases defensively.
  const minimapCells: VisibleCell[] = Array.isArray(s.minimap_cells)
    ? s.minimap_cells
    : Array.isArray(s.minimapCells)
      ? s.minimapCells
      : Array.isArray(s.minimap_patch)
        ? s.minimap_patch
        : [];

  for (const c of minimapCells) {
    if (typeof c?.x !== 'number' || typeof c?.y !== 'number') continue;
    mergeCell(level, c.x, c.y, normalizeEdges(c.edges));
  }

  // Merge visible cells (so walls/doors revealed immediately)
  const vcells: VisibleCell[] = Array.isArray(s.visible_cells)
    ? s.visible_cells
    : Array.isArray(s.visibleCells)
      ? s.visibleCells
      : [];

  for (const c of vcells) {
    if (typeof c?.x !== 'number' || typeof c?.y !== 'number') continue;
    mergeCell(level, c.x, c.y, normalizeEdges(c.edges));
  }
}

function renderState(s: any) {
  mainEl.textContent = JSON.stringify(
    {
      you: s.you,
      hub: s.hub,
      cooldowns: s.cooldowns,
      world_hash: s.world_hash,
      visible_cells: s.visible_cells
    },
    null,
    2
  );

  metaEl.textContent = JSON.stringify(
    {
      discovered_cached_cells: discovered.size
    },
    null,
    2
  );

  drawMinimap(s);
}

function isDoorEdge(v: string) {
  const s = String(v).toLowerCase();
  return s.includes('door');
}

function isWallEdge(v: string) {
  const s = String(v).toLowerCase();
  return s === 'wall' || s.includes('wall');
}

function hasLever(v: string) {
  const s = String(v).toLowerCase();
  return s.includes('lever');
}

function drawEdgeLine(x1: number, y1: number, x2: number, y2: number, kind: 'wall' | 'door') {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = kind === 'door' ? '#1e66ff' : '#111';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawLeverDashOnEdge(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const px = -dy / len;
  const py = dx / len;

  const dash = 4;
  ctx.beginPath();
  ctx.moveTo(mx - px * dash, my - py * dash);
  ctx.lineTo(mx + px * dash, my + py * dash);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawPlayerArrow(cx: number, cy: number, face: string, r: number) {
  ctx.save();
  ctx.translate(cx, cy);

  let rot = 0;
  if (face === 'N') rot = -Math.PI / 2;
  if (face === 'E') rot = 0;
  if (face === 'S') rot = Math.PI / 2;
  if (face === 'W') rot = Math.PI;

  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(-r * 0.7, r * 0.7);
  ctx.lineTo(-r * 0.7, -r * 0.7);
  ctx.closePath();
  ctx.fillStyle = '#111';
  ctx.fill();
  ctx.restore();
}

function drawBlueX(cx: number, cy: number, size: number) {
  ctx.beginPath();
  ctx.moveTo(cx - size, cy - size);
  ctx.lineTo(cx + size, cy + size);
  ctx.moveTo(cx + size, cy - size);
  ctx.lineTo(cx - size, cy + size);
  ctx.strokeStyle = '#1e66ff';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawMinimap(s: any) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const you = s?.you;
  if (!you) return;

  const hub = s?.hub ?? { x: 0, y: 0 };

  const level = Number(you.level ?? you.levelId ?? 1);
  const youX = Number(you.x);
  const youY = Number(you.y);
  const face = String(you.face ?? 'N');

  const cellPx = 22;
  const halfCellsX = Math.floor(canvas.width / (2 * cellPx));
  const halfCellsY = Math.floor(canvas.height / (2 * cellPx));

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const cell of discovered.values()) {
    if (cell.level !== level) continue;

    const dx = cell.x - youX;
    const dy = cell.y - youY;

    if (Math.abs(dx) > halfCellsX || Math.abs(dy) > halfCellsY) continue;

    const px = (halfCellsX + dx) * cellPx;
    const py = (halfCellsY + dy) * cellPx;

    ctx.fillStyle = '#e9e9e9';
    ctx.fillRect(px, py, cellPx, cellPx);

    const e = cell.edges || {};
    const left = px;
    const right = px + cellPx;
    const top = py;
    const bottom = py + cellPx;

    const n = e['N'] ?? e['n'];
    const ee = e['E'] ?? e['e'];
    const sEdge = e['S'] ?? e['s'];
    const w = e['W'] ?? e['w'];

    if (n && (isWallEdge(n) || isDoorEdge(n))) {
      drawEdgeLine(left, top, right, top, isDoorEdge(n) ? 'door' : 'wall');
      if (hasLever(n)) drawLeverDashOnEdge(left, top, right, top);
    }
    if (sEdge && (isWallEdge(sEdge) || isDoorEdge(sEdge))) {
      drawEdgeLine(left, bottom, right, bottom, isDoorEdge(sEdge) ? 'door' : 'wall');
      if (hasLever(sEdge)) drawLeverDashOnEdge(left, bottom, right, bottom);
    }
    if (w && (isWallEdge(w) || isDoorEdge(w))) {
      drawEdgeLine(left, top, left, bottom, isDoorEdge(w) ? 'door' : 'wall');
      if (hasLever(w)) drawLeverDashOnEdge(left, top, left, bottom);
    }
    if (ee && (isWallEdge(ee) || isDoorEdge(ee))) {
      drawEdgeLine(right, top, right, bottom, isDoorEdge(ee) ? 'door' : 'wall');
      if (hasLever(ee)) drawLeverDashOnEdge(right, top, right, bottom);
    }
  }

  const hx = Number(hub.x ?? 0);
  const hy = Number(hub.y ?? 0);
  const hubDx = hx - youX;
  const hubDy = hy - youY;
  if (Math.abs(hubDx) <= halfCellsX && Math.abs(hubDy) <= halfCellsY) {
    const px = (halfCellsX + hubDx) * cellPx + Math.floor(cellPx / 2);
    const py = (halfCellsY + hubDy) * cellPx + Math.floor(cellPx / 2);
    drawBlueX(px, py, Math.floor(cellPx / 3));
  }

  const cx = halfCellsX * cellPx + Math.floor(cellPx / 2);
  const cy = halfCellsY * cellPx + Math.floor(cellPx / 2);
  drawPlayerArrow(cx, cy, face, Math.max(6, Math.floor(cellPx / 3)));
}

// --- Keyboard handling (arrow keys) ---
function focusGameSurface() {
  canvas.tabIndex = 0;
  try {
    canvas.focus({ preventScroll: true });
    return;
  } catch {}
  try {
    document.body.tabIndex = 0;
    document.body.focus({ preventScroll: true });
  } catch {}
}

canvas.addEventListener('pointerdown', () => focusGameSurface());
mainEl.addEventListener('pointerdown', () => focusGameSurface());

queueMicrotask(() => focusGameSurface());

loginBtn.onclick = async () => {
  try {
    setStatus('logging in...');
    const email = emailEl.value.trim();
    const r = await devLogin(email);

    setStatus('got session token, connecting...');
    try {
      emailEl.blur();
      loginBtn.blur();
    } catch {}
    focusGameSurface();

    connect(r.sessionToken);
  } catch (e: any) {
    setStatus(`login failed: ${e?.message ?? String(e)}`);
  }
};

// Movement & turning
function sendTurnLeft() {
  if (!lastState) return;
  const f = String(lastState.you.face ?? 'N');
  const next = f === 'N' ? 'W' : f === 'W' ? 'S' : f === 'S' ? 'E' : 'N';
  send({ type: 'turn', payload: { face: next } });
}
function sendTurnRight() {
  if (!lastState) return;
  const f = String(lastState.you.face ?? 'N');
  const next = f === 'N' ? 'E' : f === 'E' ? 'S' : f === 'S' ? 'W' : 'N';
  send({ type: 'turn', payload: { face: next } });
}
function sendMoveForward() {
  send({ type: 'move', payload: { dir: 'F' } });
}
function sendMoveBackward() {
  send({ type: 'move', payload: { dir: 'B' } });
}

window.addEventListener(
  'keydown',
  (ev) => {
    if (!lastState) return;

    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;

    if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      sendTurnLeft();
    } else if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      sendTurnRight();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      sendMoveForward();
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      sendMoveBackward();
    }
  },
  { capture: true }
);

for (const btn of Array.from(document.querySelectorAll('button[data-move]'))) {
  btn.addEventListener('click', () => {
    const dir = (btn as HTMLButtonElement).dataset.move!;
    if (dir === 'F') sendMoveForward();
    else if (dir === 'B') sendMoveBackward();
    else send({ type: 'move', payload: { dir } });
  });
}

for (const btn of Array.from(document.querySelectorAll('button[data-turn]'))) {
  btn.addEventListener('click', () => {
    const face = (btn as HTMLButtonElement).dataset.turn!;
    send({ type: 'turn', payload: { face } });
  });
}