import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Player } from '../../core/Player.js';
import { BotController } from '../../players/BotController.js';
import { Callbreak8 } from '../../games/callbreak8/Callbreak8.js';

// Static file server + a tiny multiplayer lobby API (no dependencies).
//   npm run serve  ->  http://localhost:5173
//
// Endpoints (JSON):
//   POST /api/create  {name}            -> {code, playerId}
//   POST /api/join    {code, name}      -> {code, playerId}
//   GET  /api/state   ?code=&player=    -> {seats, started, view, ...}
//   POST /api/start   {code, player}    -> {ok}   (host only; fills bots)
//   POST /api/action  {code, player, action} -> {ok}
//   POST /api/restart {code, player}    -> {ok}   (host only)

const ROOT = fileURLToPath(new URL('../../..', import.meta.url)); // project root
const PORT = process.env.PORT || 5173;
const MAX_SEATS = 4;

const bot = new BotController();
const rooms = new Map();
const BOT_DELAY = Number(process.env.BOT_DELAY ?? 700); // ms between bot moves

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

function sendJson(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function newCode() {
  let c;
  do {
    c = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (rooms.has(c));
  return c;
}

function seatsView(room) {
  return room.seats.map((s) => ({ id: s.id, name: s.name, isBot: s.isBot }));
}

function buildEngine(room) {
  const players = room.seats.map(
    (s) => new Player({ id: s.id, name: s.name, isHuman: false, isBot: s.isBot })
  );
  const engine = new Callbreak8({ players, seed: Math.floor(Math.random() * 1e9) });
  engine.start();
  room.engine = engine;
  room.started = true;
  return engine;
}

// Drive the bots: whenever it is a bot's turn, play a move after a short pause.
function tick(room) {
  const engine = room.engine;
  if (!engine || engine.isOver()) return;
  if (!engine.currentPlayer.isBot) return;

  clearTimeout(room.botTimer);
  room.botTimer = setTimeout(async () => {
    const e = room.engine;
    if (!e || e.isOver() || !e.currentPlayer.isBot) return tick(room);
    try {
      const action = await bot.decide({
        player: e.currentPlayer,
        actions: e.legalActions(),
        engine: e,
      });
      e.applyAction(action);
    } catch (err) {
      console.error('bot move failed:', err.message);
    }
    tick(room);
  }, BOT_DELAY);
}

async function api(req, res, path) {
  const url = new URL(req.url, 'http://x');
  const body = req.method === 'POST' ? await readBody(req) : {};

  if (path === '/api/create' && req.method === 'POST') {
    const c = newCode();
    const room = {
      code: c,
      hostId: 'p1',
      seats: [{ id: 'p1', name: (body.name || 'Player').slice(0, 14), isBot: false }],
      engine: null,
      started: false,
      botTimer: null,
    };
    rooms.set(c, room);
    return sendJson(res, { code: c, playerId: 'p1' });
  }

  if (path === '/api/join' && req.method === 'POST') {
    const room = rooms.get(String(body.code || '').toUpperCase());
    if (!room) return sendJson(res, { error: 'Room not found' }, 404);
    if (room.started) return sendJson(res, { error: 'Game already started' }, 400);
    if (room.seats.length >= MAX_SEATS) return sendJson(res, { error: 'Room is full (max 4)' }, 400);
    const id = 'p' + (room.seats.length + 1);
    room.seats.push({ id, name: (body.name || 'Player').slice(0, 14), isBot: false });
    return sendJson(res, { code: room.code, playerId: id });
  }

  if (path === '/api/state' && req.method === 'GET') {
    const code = String(url.searchParams.get('code') || '').toUpperCase();
    const pid = url.searchParams.get('player');
    const room = rooms.get(code);
    if (!room) return sendJson(res, { error: 'Room not found' }, 404);
    return sendJson(res, {
      code: room.code,
      started: room.started,
      hostId: room.hostId,
      seats: seatsView(room),
      you: pid,
      view: room.engine ? room.engine.snapshot(room.engine.state, pid) : null,
    });
  }

  if (path === '/api/start' && req.method === 'POST') {
    const room = rooms.get(String(body.code || '').toUpperCase());
    if (!room) return sendJson(res, { error: 'Room not found' }, 404);
    if (body.player !== room.hostId) return sendJson(res, { error: 'Only the host can start' }, 403);
    if (room.started) return sendJson(res, { ok: true });

    let n = 1;
    while (room.seats.length < MAX_SEATS) {
      room.seats.push({ id: 'bot' + n, name: 'Bot ' + n, isBot: true });
      n += 1;
    }
    buildEngine(room);
    tick(room);
    return sendJson(res, { ok: true });
  }

  if (path === '/api/action' && req.method === 'POST') {
    const room = rooms.get(String(body.code || '').toUpperCase());
    if (!room || !room.engine) return sendJson(res, { error: 'No game in progress' }, 400);
    const engine = room.engine;
    if (engine.isOver()) return sendJson(res, { error: 'Game is over' }, 400);
    if (engine.currentPlayer.id !== body.player) return sendJson(res, { error: 'Not your turn' }, 400);
    try {
      engine.applyAction(body.action);
    } catch (err) {
      return sendJson(res, { error: err.message }, 400);
    }
    tick(room);
    return sendJson(res, { ok: true });
  }

  if (path === '/api/restart' && req.method === 'POST') {
    const room = rooms.get(String(body.code || '').toUpperCase());
    if (!room) return sendJson(res, { error: 'Room not found' }, 404);
    if (body.player !== room.hostId) return sendJson(res, { error: 'Only the host can restart' }, 403);
    buildEngine(room);
    tick(room);
    return sendJson(res, { ok: true });
  }

  return sendJson(res, { error: 'Unknown endpoint' }, 404);
}

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.startsWith('/api/')) return api(req, res, path);

  const rel = path === '/' ? '/src/ui/web/index.html' : path;
  const filePath = join(ROOT, normalize(rel));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Master Card Game running at http://localhost:${PORT}`);
});
