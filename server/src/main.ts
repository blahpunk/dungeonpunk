// server/src/main.ts

import http from 'node:http';
import express from 'express';
import { CONFIG } from './config.js';
import { openDb } from './db.js';
import { attachWs } from './ws.js';
import { devLogin } from './auth.js';

const app = express();
app.use(express.json({ limit: '256kb' }));

// openDb() already runs migrations
const db = openDb();

// Dev-only login. Production OAuth wiring comes later.
app.post('/dev/login', (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    res.status(400).json({ error: 'invalid email' });
    return;
  }
  const r = devLogin(db, email);
  res.json(r);
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);
attachWs(server, db);

server.listen(CONFIG.port, () => {
  console.log(`server listening on http://localhost:${CONFIG.port}`);
  console.log(`ws on ws://localhost:${CONFIG.port}${CONFIG.wsPath}`);
});