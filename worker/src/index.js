import { Player } from '../../src/core/Player.js';
import { BotController } from '../../src/players/BotController.js';
import { Callbreak8 } from '../../src/games/callbreak8/Callbreak8.js';

// ---- Cloudflare Worker: static app + multiplayer lobby -------------------
// One Durable Object per room (addressed by the 4-letter room code). The
// object owns the game engine and advances bot seats lazily on each request,
// so no timers or alarms are needed. Free plan friendly (100k req/day).

const bot = new BotController();
const MAX_SEATS = 4;
const BOT_DELAY = 600; // ms between bot moves

// The Android app runs at https://localhost, so its API calls are
// cross-origin — every response needs CORS headers.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

export class GameRoom {
  constructor(state, env) {
    this.dstate = state;
    this.env = env;
    this.room = null;
    this.lastBotAt = 0;
    this.botDelay = Number((env && env.BOT_DELAY) ?? BOT_DELAY);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const op = url.pathname.replace(/^\//, '');
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const player = request.method === 'GET' ? url.searchParams.get('player') : body.player;

    await this.advanceBots();

    switch (op) {
      case 'create':
        return this.create(body);
      case 'join':
        return this.join(body);
      case 'start':
        return this.start(body);
      case 'restart':
        return this.restart(body);
      case 'action':
        return this.action(body);
      case 'chat':
        return this.chat(body);
      case 'state':
        return this.stateResponse(player);
      default:
        return json({ error: 'Unknown op' }, 404);
    }
  }

  create(body) {
    if (this.room && this.room.started) return json({ error: 'Room already in a game' }, 400);
    this.room = {
      code: body.code,
      hostId: 'p1',
      seats: [{ id: 'p1', name: (body.name || 'Player').slice(0, 14), isBot: false }],
      engine: null,
      started: false,
      chat: [],
    };
    return json({ playerId: 'p1' });
  }

  join(body) {
    if (!this.room) return json({ error: 'Room not found' }, 404);
    if (this.room.started) return json({ error: 'Game already started' }, 400);
    if (this.room.seats.length >= MAX_SEATS) return json({ error: 'Room is full (max 4)' }, 400);
    const id = 'p' + (this.room.seats.length + 1);
    this.room.seats.push({ id, name: (body.name || 'Player').slice(0, 14), isBot: false });
    return json({ playerId: id });
  }

  start(body) {
    if (!this.room) return json({ error: 'Room not found' }, 404);
    if (body.player !== this.room.hostId) return json({ error: 'Only the host can start' }, 403);
    if (this.room.started) return json({ ok: true });
    let n = 1;
    while (this.room.seats.length < MAX_SEATS) {
      this.room.seats.push({ id: 'bot' + n, name: 'Bot ' + n, isBot: true });
      n += 1;
    }
    this.buildEngine();
    return json({ ok: true });
  }

  restart(body) {
    if (!this.room) return json({ error: 'Room not found' }, 404);
    if (body.player !== this.room.hostId) return json({ error: 'Only the host can restart' }, 403);
    this.buildEngine();
    return json({ ok: true });
  }

  buildEngine() {
    const players = this.room.seats.map(
      (s) => new Player({ id: s.id, name: s.name, isHuman: false, isBot: s.isBot })
    );
    const engine = new Callbreak8({ players, seed: Math.floor(Math.random() * 1e9) });
    engine.start();
    this.room.engine = engine;
    this.room.started = true;
    this.lastBotAt = 0;
  }

  action(body) {
    const room = this.room;
    if (!room || !room.engine) return json({ error: 'No game in progress' }, 400);
    const engine = room.engine;
    if (engine.isOver()) return json({ error: 'Game is over' }, 400);
    if (engine.currentPlayer.id !== body.player) return json({ error: 'Not your turn' }, 400);
    try {
      engine.applyAction(body.action);
    } catch (err) {
      return json({ error: err.message }, 400);
    }
    return json({ ok: true });
  }

  // Bots play on each request, paced by BOT_DELAY — no timers required.
  async advanceBots() {
    const room = this.room;
    if (!room || !room.engine || room.engine.isOver()) return;
    let guard = 0;
    while (!room.engine.isOver() && room.engine.currentPlayer.isBot && guard++ < 200) {
      if (Date.now() - this.lastBotAt < this.botDelay) break;
      const engine = room.engine;
      const action = await bot.decide({
        player: engine.currentPlayer,
        actions: engine.legalActions(),
        engine,
      });
      engine.applyAction(action);
      this.lastBotAt = Date.now();
    }
  }

  // In-room chat: a small rolling list of messages.
  chat(body) {
    if (!this.room) return json({ error: 'Room not found' }, 404);
    const seat = this.room.seats.find((s) => s.id === body.player);
    const text = String(body.text || '').slice(0, 200).trim();
    if (text) {
      this.room.chat.push({ name: seat ? seat.name : 'Player', text, at: Date.now() });
      if (this.room.chat.length > 60) this.room.chat = this.room.chat.slice(-60);
    }
    return json({ ok: true });
  }

  stateResponse(player) {
    const room = this.room;
    if (!room) return json({ error: 'Room not found' }, 404);
    return json({
      code: room.code,
      started: room.started,
      hostId: room.hostId,
      seats: room.seats.map((s) => ({ id: s.id, name: s.name, isBot: s.isBot })),
      you: player,
      chat: (room.chat || []).slice(-40),
      view: room.engine ? room.engine.snapshot(room.engine.state, player) : null,
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (path === '/api/create' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const code = randomCode();
      const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
      const res = await stub.fetch('https://room/create', {
        method: 'POST',
        body: JSON.stringify({ code, name: body.name }),
      });
      const data = await res.json();
      if (data.error) return json(data, res.status);
      return json({ code, playerId: data.playerId });
    }

    if (path.startsWith('/api/')) {
      let code;
      let payload = null;
      if (request.method === 'GET') {
        code = url.searchParams.get('code');
      } else {
        payload = await request.json().catch(() => ({}));
        code = payload.code;
      }
      code = String(code || '').toUpperCase();
      if (!code) return json({ error: 'Missing room code' }, 400);

      const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
      const doPath = path.replace('/api', '');
      const doUrl = 'https://room' + doPath + (request.method === 'GET' ? '?' + url.searchParams.toString() : '');
      const res = await stub.fetch(doUrl, {
        method: request.method,
        body: payload ? JSON.stringify(payload) : undefined,
      });
      const text = await res.text();
      return new Response(text, { status: res.status, headers: JSON_HEADERS });
    }

    // Everything else: the bundled web app (www/).
    return env.ASSETS.fetch(request);
  },
};
