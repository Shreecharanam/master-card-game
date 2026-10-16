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

const SUIT_SYM = { S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663' };
function cardEl(label) {
  const div = el('div', 'card');
  if (label === '??') {
    div.classList.add('back');
    return div;
  }
  const rank = label.slice(0, -1);
  const suit = label.slice(-1);
  if (RED.has(suit)) div.classList.add('red');
  div.innerHTML = `<span class="rk">${rank}</span><span class="st">${SUIT_SYM[suit] || suit}</span>`;
  return div;
}

async function post(path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
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

  const leave = el('button', 'secondary', 'Leave');
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

  // top bar: game / round / trump / phase
  const info = el('div', 'pot');
  let line = v.game;
  if (v.round) line += ` &nbsp;·&nbsp; Round <b>${v.round}/${v.totalRounds}</b>`;
  else line += ` &nbsp;·&nbsp; Pot <b>${v.pot}</b>`;
  if (v.trump) line += ` &nbsp;·&nbsp; Trump <b>${v.trump}</b>`;
  if (v.phase === 'auction') line += ` &nbsp;·&nbsp; Auction (highest <b>${v.highestCall ?? '—'}</b>)`;
  if (v.phase === 'trump') line += ` &nbsp;·&nbsp; <b>Choose trump</b>`;
  if (v.phase === 'trump2') line += ` &nbsp;·&nbsp; <b>Choose trump (10+ override)</b>`;
  if (v.phase === 'calling') line += ` &nbsp;·&nbsp; Declaring calls`;
  info.innerHTML = line;
  app.appendChild(info);

  // control row
  const ctrl = el('div', 'controls');
  if (mode === 'solo') {
    const ng = el('button', 'secondary', 'New game');
    ng.onclick = renderHome;
    ctrl.appendChild(ng);
  } else if (mode === 'online') {
    const lv = el('button', 'secondary', 'Leave');
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

  // trick on the table
  if (v.currentTrick && v.currentTrick.length) {
    const onTable = el('div', 'trick');
    for (const e of v.currentTrick) {
      const slot = el('div', 'trick-slot');
      slot.appendChild(cardEl(e.card));
      const who = v.players.find((p) => p.id === e.playerId);
      slot.appendChild(el('span', 'trick-cap', who ? who.name : ''));
      onTable.appendChild(slot);
    }
    app.appendChild(onTable);
  }

  // one seat element
  function seatEl(p) {
    const seat = el('div', 'seat');
    if (p.id === v.currentPlayerId) seat.classList.add('turn');
    if (p.folded) seat.classList.add('folded');
    if (p.id === myId) seat.classList.add('mine');

    let extra = '';
    if (v.auction && v.auction[p.id] != null) {
      const a = v.auction[p.id];
      extra += ` · ${a === 'pass' ? 'pass' : 'bid ' + a}`;
    }
    if (v.bids && v.bids[p.id] != null) {
      extra += ` · call ${v.bids[p.id]} · won ${v.tricks[p.id]}`;
      if (v.scores) {
        const s = v.scores[p.id];
        extra += ` · pts ${s >= 0 ? '+' : ''}${s}`;
      }
    }
    const youTag = p.id === myId ? ' (you)' : '';
    seat.appendChild(el('div', 'name', `<span>${p.name}${youTag}</span>`));
    if (extra) seat.appendChild(el('div', 'meta', extra.replace(/^ · /, '')));

    const cards = el('div', 'cards');
    for (const label of p.cards) cards.appendChild(cardEl(label));
    seat.appendChild(cards);
    return seat;
  }

  const me = v.players.find((p) => p.id === myId);
  const others = v.players.filter((p) => p.id !== myId);

  // 1) YOUR hand first — cards visible, then the buttons right below it
  if (me) {
    const mineWrap = el('div', 'seats');
    mineWrap.appendChild(seatEl(me));
    app.appendChild(mineWrap);
  }

  // 2) action buttons (or winner / waiting text)
  const actions = el('div', 'actions');
  actions.id = 'actions';
  if (v.over) {
    actions.appendChild(el('div', 'banner', `${v.winnerName || 'Nobody'} wins!`));
  } else if (v.currentPlayerId === myId) {
    for (const action of v.legalActions) {
      const b = el('button', action.type === 'see' || action.type === 'pass' ? 'secondary' : null, action.label);
      b.onclick = () => doAction(action);
      actions.appendChild(b);
    }
  } else {
    const who = v.players.find((p) => p.id === v.currentPlayerId);
    actions.appendChild(el('div', 'hint', `Waiting for ${who ? who.name : '...'}`));
  }
  app.appendChild(actions);

  // 3) other players
  if (others.length) {
    const seats = el('div', 'seats');
    for (const p of others) seats.appendChild(seatEl(p));
    app.appendChild(seats);
  }

  // 4) log
  const log = el('div', 'log');
  log.id = 'log';
  log.innerHTML = v.log.map((l) => `&middot; ${l}`).join('<br>');
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
