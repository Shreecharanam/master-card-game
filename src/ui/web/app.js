import { Player } from '../../core/Player.js';
import { getGame } from '../../games/GameRegistry.js';
import { BotController } from '../../players/BotController.js';

// ---- browser front-end --------------------------------------------------
// Two modes:
//   solo   : one human + three bots, engine runs in the browser.
//   online : up to 4 people on their own devices; the server owns the
//            engine and this page just renders state and posts actions.

const bot = new BotController();
const app = document.getElementById('app');
const RED = new Set(['H', 'D']);
// Online mode needs the server. When the page is opened as a saved file
// (file://) there is no server, so we hide "Play with Friends".
const CAN_GO_ONLINE = location.protocol === 'http:' || location.protocol === 'https:';
// The multiplayer API lives at API_BASE. Empty means "same origin" (the
// Node/Pages server). In the Android app a full server URL is injected.
const API_BASE = (typeof window !== 'undefined' && window.MCG_SERVER) || '';

let mode = null; // 'solo' | 'online'
let chatDraft = ''; // keeps the chat box text across re-renders
let engine = null; // solo engine
let online = null; // { code, playerId, hostId, seats }
let view = null; // what we render
let myId = null;
let pollTimer = null;

// ---------- tiny DOM helpers ----------
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}

const SUIT_SYM = { S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663' };
function cardEl(label) {
  const div = el('div', 'card');
  if (label === '??') {
    div.classList.add('back');
    return div;
  }
  const rank = label.slice(0, -1);
  const suit = label.slice(-1);
  const sym = SUIT_SYM[suit] || suit;
  if (RED.has(suit)) div.classList.add('red');
  div.innerHTML =
    `<span class="corner"><span class="rk">${rank}</span><span class="st">${sym}</span></span>` +
    `<span class="big">${sym}</span>`;
  return div;
}

function initials(name) {
  return (name || '?').trim().slice(0, 1).toUpperCase();
}
function avatarColor(name) {
  let h = 0;
  for (const ch of String(name || '?')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 55%, 42%)`;
}
function metaFor(v, p) {
  const bits = [];
  if (v.auction && v.auction[p.id] != null) {
    bits.push(v.auction[p.id] === 'pass' ? 'pass' : 'bid ' + v.auction[p.id]);
  }
  if (v.bids && v.bids[p.id] != null) {
    bits.push(`call ${v.bids[p.id]}`);
    bits.push(`won ${v.tricks[p.id]}`);
    if (v.scores) bits.push(`pts ${v.scores[p.id] >= 0 ? '+' : ''}${v.scores[p.id]}`);
  }
  return bits.join(' · ');
}
function oppSeat(v, p, pos) {
  const seat = el('div', `pseat ${pos}`);
  if (p.id === v.currentPlayerId) seat.classList.add('turn');
  if (p.folded) seat.classList.add('folded');
  const av = el('div', 'avatar', initials(p.name));
  av.style.background = avatarColor(p.name);
  seat.appendChild(av);
  seat.appendChild(el('div', 'pname', p.name));
  const m = metaFor(v, p);
  if (m) seat.appendChild(el('div', 'pmeta', m));
  const backs = el('div', 'backs');
  const n = Math.min(p.cards.length, 8);
  for (let i = 0; i < n; i++) backs.appendChild(el('div', 'mini-back'));
  if (p.cards.length > 8) backs.appendChild(el('span', 'backs-n', `+${p.cards.length - 8}`));
  seat.appendChild(backs);
  return seat;
}

async function post(path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Pressing the phone's Back button should return to the menu, not close the
// app. We push one history entry when we leave the menu, and pop back to it.
let pushed = false;
function enterScreen() {
  if (!pushed) {
    try {
      history.pushState({ s: 1 }, '');
      pushed = true;
    } catch {}
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    pushed = false;
    renderHome();
  });
}

// ---------- HOME ----------
function renderHome() {
  stopPoll();
  mode = null;
  engine = null;
  online = null;
  view = null;
  app.innerHTML = '';

  const wrap = el('div', 'home');
  wrap.appendChild(el('p', null, 'Choose a game and how you want to play.'));

  const gsel = el('select');
  gsel.innerHTML =
    '<option value="callbreak8">Callbreak 13</option>' +
    '<option value="callbreak">Callbreak</option>' +
    '<option value="teenpatti">Teen Patti</option>' +
    '<option value="highcard">High Card</option>';
  gsel.value = 'callbreak8';
  const row = el('div', 'controls');
  row.appendChild(el('label', null, 'Game:'));
  row.appendChild(gsel);
  wrap.appendChild(row);

  const b1 = el('button', null, 'Play vs Bots');
  b1.onclick = () => startSolo(gsel.value);
  const row2 = el('div', 'controls');
  row2.appendChild(b1);
  if (CAN_GO_ONLINE) {
    const b2 = el('button', null, 'Play with Friends');
    b2.onclick = () => renderOnlineMenu();
    row2.appendChild(b2);
  }
  wrap.appendChild(row2);
  if (CAN_GO_ONLINE) {
    wrap.appendChild(el('p', 'hint', 'Play with Friends: create a room and share the 4-letter code. Others open the same address on their phone/laptop. Max 4 players.'));
    const dl = el('a', 'dl-link', 'Download offline app');
    dl.href = 'offline/master-card-game.html';
    dl.setAttribute('download', 'master-card-game.html');
    wrap.appendChild(dl);
    wrap.appendChild(el('p', 'hint', 'Offline app: ek hi HTML file. Download karo, phone/PC par rakho, tap karo — bina internet ke bots ke saath khelo.'));
  } else {
    wrap.appendChild(el('p', 'hint', 'Offline mode — bots ke saath khel rahe ho. Multiplayer ke liye server chala kar browser se kholo.'));
  }

  app.appendChild(wrap);
}

// ---------- SOLO ----------
function startSolo(gameId) {
  mode = 'solo';
  enterScreen();
  const GameClass = getGame(gameId);
  const players = [
    new Player({ id: 'p1', name: 'You', isHuman: true }),
    new Player({ id: 'p2', name: 'Asha', isBot: true }),
    new Player({ id: 'p3', name: 'Bheem', isBot: true }),
    new Player({ id: 'p4', name: 'Chitra', isBot: true }),
  ];
  myId = 'p1';
  engine = new GameClass({ players, seed: Math.floor(Math.random() * 1e9) });
  engine.start();
  step();
}

function step() {
  if (!engine) return;
  view = engine.snapshot(engine.state, myId);
  renderTable();
  if (engine.isOver()) return;

  if (!engine.currentPlayer.isHuman) {
    setTimeout(async () => {
      if (!engine || engine.isOver() || engine.currentPlayer.isHuman) return;
      const action = await bot.decide({
        player: engine.currentPlayer,
        actions: engine.legalActions(),
        engine,
      });
      engine.applyAction(action);
      step();
    }, 650);
  }
}

// ---------- ONLINE ----------
function renderOnlineMenu() {
  stopPoll();
  app.innerHTML = '';
  const wrap = el('div', 'home');
  wrap.appendChild(el('h2', null, 'Play with Friends'));

  const nameInput = el('input');
  nameInput.placeholder = 'Your name';
  nameInput.value = 'Player';
  wrap.appendChild(nameInput);

  const bCreate = el('button', null, 'Create room');
  bCreate.onclick = async () => {
    const r = await post('/api/create', { name: nameInput.value });
    if (r.error) return alert(r.error);
    online = { code: r.code, playerId: r.playerId, seats: [], hostId: r.playerId };
    myId = r.playerId;
    mode = 'online';
    renderLobby();
  };
  const row1 = el('div', 'controls');
  row1.appendChild(bCreate);
  wrap.appendChild(row1);

  const codeInput = el('input');
  codeInput.placeholder = 'Room code';
  codeInput.style.textTransform = 'uppercase';
  try {
    const pre = new URLSearchParams(location.search || '').get('room');
    if (pre) codeInput.value = pre.toUpperCase();
  } catch {}
  const bJoin = el('button', null, 'Join room');
  bJoin.onclick = async () => {
    const r = await post('/api/join', {
      code: codeInput.value.trim().toUpperCase(),
      name: nameInput.value,
    });
    if (r.error) return alert(r.error);
    online = { code: r.code, playerId: r.playerId, seats: [], hostId: null };
    myId = r.playerId;
    mode = 'online';
    renderLobby();
  };
  const row2 = el('div', 'controls');
  row2.appendChild(codeInput);
  row2.appendChild(bJoin);
  wrap.appendChild(row2);

  const back = el('button', 'secondary', 'Back');
  back.onclick = renderHome;
  wrap.appendChild(back);
  app.appendChild(wrap);
}

function renderLobby() {
  enterScreen();
  app.innerHTML = '';
  const wrap = el('div', 'home');
  wrap.appendChild(el('h2', null, 'Room ' + online.code));
  wrap.appendChild(el('p', null, 'Share this code. Others open the same address and join with it.'));

  const list = el('div', 'lobby-list');
  list.id = 'lobbyList';
  wrap.appendChild(list);

  const startBtn = el('button', null, 'Start game');
  startBtn.id = 'startBtn';
  startBtn.onclick = async () => {
    await post('/api/start', { code: online.code, player: online.playerId });
    poll();
  };
  wrap.appendChild(startBtn);

  const webUrl = API_BASE || (typeof location !== 'undefined' ? location.origin : '');
  const invite =
    `Join my Master Card Game! Room code: ${online.code}\n` +
    `Open the app, tap "Play with Friends" → Join → enter this code.\n` +
    `(No app? Open in browser: ${webUrl}/?room=${online.code})`;
  const wa = el('a', 'dl-link', 'Share on WhatsApp');
  wa.href = `https://wa.me/?text=${encodeURIComponent(invite)}`;
  wa.target = '_blank';
  wrap.appendChild(wa);

  const leave = el('button', 'secondary', 'Menu');
  leave.onclick = renderHome;
  wrap.appendChild(leave);
  app.appendChild(wrap);

  poll();
}

async function poll() {
  if (!online) return;
  let r;
  try {
    r = await fetch(`${API_BASE}/api/state?code=${online.code}&player=${online.playerId}`).then((x) => x.json());
  } catch {
    r = { error: 'network' };
  }
  if (r.error) {
    stopPoll();
    return;
  }
  online.seats = r.seats;
  online.hostId = r.hostId;
  online.started = r.started;

  if (r.started) {
    view = r.view;
    renderTable();
  } else {
    updateLobby();
  }
  schedulePoll();
}

function schedulePoll() {
  stopPoll();
  pollTimer = setTimeout(poll, 900);
}

function stopPoll() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function updateLobby() {
  const list = document.getElementById('lobbyList');
  if (!list) return;
  list.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const s = online.seats[i];
    const label = s
      ? `${s.name}${s.id === online.hostId ? ' (host)' : ''}${s.isBot ? ' [bot]' : ''}`
      : '— empty —';
    list.appendChild(el('div', 'lobby-seat', label));
  }
  const btn = document.getElementById('startBtn');
  if (btn) btn.style.display = online.playerId === online.hostId ? '' : 'none';
}

// ---------- TABLE ----------
function renderTable() {
  const v = view;
  app.innerHTML = '';
  if (!v) return;

  // HUD: game / round / trump card / phase
  const info = el('div', 'hud');
  let line = `<span class="hud-round">${v.game} · Round <b>${v.round || 1}/${v.totalRounds || 1}</b></span>`;
  if (v.trump) {
    const sym = SUIT_SYM[v.trump] || v.trump;
    const red = RED.has(v.trump) ? ' red' : '';
    const rk = v.trumpCard ? v.trumpCard.slice(0, -1) : '';
    line += `<span class="hud-trump">Trump <span class="tcard${red}">${rk}${sym}</span></span>`;
  }
  if (v.phase === 'auction') line += `<span class="hud-phase">Auction · highest <b>${v.highestCall ?? '—'}</b></span>`;
  if (v.phase === 'trump' || v.phase === 'trump2') line += `<span class="hud-phase">Choose trump</span>`;
  if (v.phase === 'calling') line += `<span class="hud-phase">Declaring calls</span>`;
  info.innerHTML = line;
  app.appendChild(info);

  // control row
  const ctrl = el('div', 'controls');
  if (mode === 'solo') {
    const ng = el('button', 'secondary', 'Menu');
    ng.onclick = renderHome;
    ctrl.appendChild(ng);
  } else if (mode === 'online') {
    const lv = el('button', 'secondary', 'Menu');
    lv.onclick = () => {
      stopPoll();
      renderHome();
    };
    ctrl.appendChild(lv);
    if (v.over && online && online.playerId === online.hostId) {
      const ag = el('button', null, 'Play again');
      ag.onclick = async () => {
        await post('/api/restart', { code: online.code, player: online.playerId });
        poll();
      };
      ctrl.appendChild(ag);
    }
  }
  if (ctrl.children.length) app.appendChild(ctrl);

  const me = v.players.find((p) => p.id === myId);
  const others = v.players.filter((p) => p.id !== myId);

  // ---- the table: 3 opponents around it, played cards in the middle ----
  const table = el('div', 'table');
  const pos = ['left', 'top', 'right'];
  others.forEach((p, i) => table.appendChild(oppSeat(v, p, pos[i] || 'top')));

  const center = el('div', 'center');
  if (v.currentTrick && v.currentTrick.length) {
    for (const e of v.currentTrick) {
      const wrap = el('div', 'trick-card');
      wrap.appendChild(cardEl(e.card));
      const who = v.players.find((x) => x.id === e.playerId);
      wrap.appendChild(el('span', 'trick-cap', who ? who.name : ''));
      center.appendChild(wrap);
    }
  } else {
    center.appendChild(
      el('div', 'center-hint', v.over ? '' : v.currentPlayerId === myId ? 'Your turn' : 'Waiting…')
    );
  }
  table.appendChild(center);
  app.appendChild(table);

  // ---- your hand (fanned) ----
  if (me) {
    const mineWrap = el('div', 'myhand-wrap');
    const title = el('div', 'myhand-title');
    const mm = metaFor(v, me);
    title.innerHTML = `<span>You</span><span class="meta">${mm}</span>`;
    mineWrap.appendChild(title);

    const legalPlays = new Set(
      (v.legalActions || []).filter((a) => a.type === 'play').map((a) => a.card)
    );
    const canPlay = v.currentPlayerId === myId && legalPlays.size > 0;

    const hand = el('div', 'hand');
    const n = me.cards.length;
    const mid = (n - 1) / 2;
    me.cards.forEach((label, i) => {
      const ce = cardEl(label);
      ce.classList.add('hand-card');
      const rot = (i - mid) * 2.4;
      const lift = Math.abs(i - mid) * 1.6;
      ce.style.transform = `rotate(${rot}deg) translateY(${lift}px)`;
      if (canPlay) {
        if (legalPlays.has(label)) {
          ce.classList.add('playable');
          ce.onclick = () => doAction({ type: 'play', card: label });
        } else {
          ce.classList.add('dim');
        }
      }
      hand.appendChild(ce);
    });
    mineWrap.appendChild(hand);
    app.appendChild(mineWrap);
  }

  // ---- actions ----
  const actions = el('div', 'actions');
  actions.id = 'actions';
  if (v.over) {
    actions.appendChild(el('div', 'banner', `${v.winnerName || 'Nobody'} wins!`));
  } else if (v.currentPlayerId === myId) {
    const nonPlay = v.legalActions.filter((a) => a.type !== 'play');
    for (const action of nonPlay) {
      const b = el('button', action.type === 'see' || action.type === 'pass' ? 'secondary' : null, action.label);
      b.onclick = () => doAction(action);
      actions.appendChild(b);
    }
    if (nonPlay.length === 0 && v.legalActions.length > 0) {
      actions.appendChild(el('div', 'hint', 'Tap a card in your hand to play it'));
    }
  } else {
    const who = v.players.find((p) => p.id === v.currentPlayerId);
    actions.appendChild(el('div', 'hint', `Waiting for ${who ? who.name : '...'}`));
  }
  app.appendChild(actions);

  // ---- chat (online only) ----
  if (mode === 'online' && online) {
    const chat = el('div', 'chat');
    chat.appendChild(el('div', 'chat-title', 'Chat'));
    const msgs = el('div', 'chat-msgs');
    const list = v.chat || [];
    if (!list.length) msgs.appendChild(el('div', 'chat-empty', 'Say hi to your friends'));
    for (const m of list) {
      msgs.appendChild(el('div', 'chat-msg', `<b>${escapeHtml(m.name)}:</b> ${escapeHtml(m.text)}`));
    }
    chat.appendChild(msgs);

    const row = el('div', 'chat-row');
    const inp = el('input', 'chat-input');
    inp.placeholder = 'Message…';
    inp.value = chatDraft;
    inp.oninput = () => { chatDraft = inp.value; };
    const send = el('button', null, 'Send');
    const doSend = () => {
      const t = (inp.value || '').trim();
      if (!t) return;
      chatDraft = '';
      inp.value = '';
      post('/api/chat', { code: online.code, player: online.playerId, text: t }).then(() => poll());
    };
    send.onclick = doSend;
    inp.onkeydown = (e) => { if (e.key === 'Enter') doSend(); };
    row.appendChild(inp);
    row.appendChild(send);
    chat.appendChild(row);
    app.appendChild(chat);
  }

  // ---- log ----
  const log = el('div', 'log');
  log.id = 'log';
  log.innerHTML = v.log.slice(-4).map((l) => `&middot; ${l}`).join('<br>');
  app.appendChild(log);
}

function doAction(action) {
  if (mode === 'solo') {
    engine.applyAction(action);
    step();
  } else if (mode === 'online') {
    post('/api/action', { code: online.code, player: online.playerId, action }).then((r) => {
      if (r.error) alert(r.error);
      poll();
    });
  }
}

renderHome();
