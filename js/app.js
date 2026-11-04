import { deal, play } from './game.js';
import { createBus } from './net.js';

const $ = (id) => document.getElementById(id);

const HEARTBEAT_MS = 4000;
const OFFLINE_MS = 12000;
const NO_HOST_MS = 9000;

const me = { id: clientId(), name: '' };
let room = roomFromHash();
let isHost = false;
let bus = null;
let snapshot = null; // last public state published by the host
let myHand = [];
let host = null; // host-only bookkeeping
let noHostTimer = null;

function clientId() {
  let v = sessionStorage.getItem('cg_id');
  if (!v) {
    v = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('cg_id', v);
  }
  return v;
}

function roomFromHash() {
  const h = location.hash.replace(/^#/, '').trim();
  return /^[a-z0-9]{6,32}$/i.test(h) ? h : '';
}

function newRoomId() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 12);
}

function shareLink() {
  return `${location.origin}${location.pathname}${location.search}#${room}`;
}

function show(which) {
  for (const v of ['name', 'lobby', 'game']) {
    $('view-' + v).classList.toggle('hidden', v !== which);
  }
}

function setStatus(state) {
  const labels = { on: 'מחובר', wait: 'מתחבר', err: 'תקלת חיבור', off: 'מנותק' };
  $('status').dataset.state = state;
  $('status').textContent = labels[state] || state;
}

function nameOf(id) {
  const row = (snapshot?.order || []).find((p) => p.id === id);
  return row ? row.name : 'שחקן';
}

/* ---------- entry screen ---------- */

function initEntry() {
  const joining = !!room;
  $('name-title').textContent = joining ? 'הצטרפות למשחק' : 'משחק חדש';
  $('name-go').textContent = joining ? 'הצטרף' : 'צור משחק';
  $('name-input').value = localStorage.getItem('cg_name') || '';
  $('name-go').addEventListener('click', enter);
  $('name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') enter();
  });
  show('name');
  $('name-input').focus();
}

function enter() {
  const name = $('name-input').value.trim();
  if (!name) {
    $('name-note').textContent = 'צריך להקליד שם.';
    $('name-note').classList.add('error');
    return;
  }
  me.name = name.slice(0, 16);
  localStorage.setItem('cg_name', me.name);

  if (!room) {
    room = newRoomId();
    isHost = true;
    history.replaceState(null, '', shareLink());
  }
  connect();
}

/* ---------- connection ---------- */

function connect() {
  setStatus('wait');
  bus = createBus({
    room,
    clientId: me.id,
    isHost,
    onStatus: setStatus,
    onMessage: onMessage,
  });

  if (isHost) {
    host = {
      players: new Map([[me.id, { id: me.id, name: me.name, last: Date.now() }]]),
      order: [me.id],
      locked: false,
      game: null,
      lastSig: '',
    };
    setInterval(() => {
      host.players.get(me.id).last = Date.now();
      publishState();
    }, 2000);
    publishState();
  } else {
    const beat = () => bus.act({ t: 'hello', id: me.id, name: me.name });
    beat();
    setInterval(beat, HEARTBEAT_MS);
    noHostTimer = setTimeout(() => {
      if (!snapshot) {
        $('lobby-note').textContent =
          'לא נמצא מארח לחדר הזה. ייתכן שהמארח סגר את הדף, או שהקישור אינו נכון.';
        $('lobby-note').classList.add('error');
      }
    }, NO_HOST_MS);
    window.addEventListener('pagehide', () => bus.act({ t: 'bye', id: me.id }));
  }

  window.addEventListener('pagehide', () => {
    if (host) {
      clearHands();
      bus.clearState();
    }
  });

  $('share').value = shareLink();
  $('copy').addEventListener('click', copyLink);
  $('start').addEventListener('click', startGame);
  $('host-controls').classList.toggle('hidden', !isHost);

  show('lobby');
  $('lobby-note').textContent = 'מתחבר לשרת ההודעות…';
  render();
}

function copyLink() {
  const done = () => {
    $('copy').textContent = 'הועתק';
    setTimeout(() => ($('copy').textContent = 'העתק'), 1500);
  };
  navigator.clipboard?.writeText(shareLink()).then(done, () => {
    $('share').select();
    document.execCommand('copy');
    done();
  });
}

function onMessage(sub, msg) {
  if (sub === 'state') {
    snapshot = msg;
    if (noHostTimer) {
      clearTimeout(noHostTimer);
      noHostTimer = null;
    }
    render();
  } else if (sub === `p/${me.id}`) {
    if (msg.t === 'hand') {
      myHand = msg.cards || [];
      render();
    }
  } else if (sub === 'act' && host) {
    onAct(msg);
  }
}

/* ---------- host ---------- */

function buildState() {
  const now = Date.now();
  const row = (id) => {
    const p = host.players.get(id);
    return { id, name: p.name, online: now - p.last < OFFLINE_MS };
  };
  if (!host.locked) {
    return { phase: 'lobby', host: me.id, order: host.order.map(row) };
  }
  const g = host.game;
  return {
    phase: 'game',
    host: me.id,
    order: host.order.map((id) => ({ ...row(id), count: (g.hands[id] || []).length })),
    turn: host.order[g.turn],
    table: g.table,
    over: g.over,
  };
}

function publishState(force) {
  if (!host) return;
  const payload = buildState();
  const sig = JSON.stringify(payload);
  if (!force && sig === host.lastSig) return;
  host.lastSig = sig;
  bus.state(payload);
}

function onAct(msg) {
  if (!msg || !msg.id) return;

  if (msg.t === 'hello') {
    const p = host.players.get(msg.id);
    if (p) {
      p.last = Date.now();
      if (!host.locked && msg.name) p.name = String(msg.name).slice(0, 16);
    } else if (!host.locked) {
      host.players.set(msg.id, {
        id: msg.id,
        name: String(msg.name || 'שחקן').slice(0, 16),
        last: Date.now(),
      });
      host.order.push(msg.id);
    } else {
      return; // the room is locked and this is not one of its players
    }
    publishState();
    return;
  }

  if (msg.t === 'bye') {
    if (!host.locked && host.players.has(msg.id)) {
      host.players.delete(msg.id);
      host.order = host.order.filter((x) => x !== msg.id);
      publishState();
    }
    return;
  }

  if (msg.t === 'play') {
    if (!host.locked || !host.game) return;
    const p = host.players.get(msg.id);
    if (!p) return;
    p.last = Date.now();
    const r = play(host.game, host.order, msg.id, msg.card);
    if (!r.ok) return;
    bus.toPlayer(msg.id, { t: 'hand', cards: host.game.hands[msg.id] });
    publishState(true);
    if (host.game.over) clearHands();
  }
}

// Retained messages outlive the tab, so a finished or abandoned room clears
// what it left on the broker.
function clearHands() {
  for (const id of host.order) bus.clearPlayer(id);
}

function moveSeat(id, delta) {
  if (!host || host.locked) return;
  const i = host.order.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= host.order.length) return;
  [host.order[i], host.order[j]] = [host.order[j], host.order[i]];
  publishState();
}

function startGame() {
  if (!host || host.locked) return;
  if (host.order.length < 2) {
    $('lobby-note').textContent = 'צריך לפחות שני שחקנים כדי להתחיל.';
    $('lobby-note').classList.add('error');
    return;
  }
  host.game = deal(host.order);
  host.locked = true;
  for (const id of host.order) {
    bus.toPlayer(id, { t: 'hand', cards: host.game.hands[id] });
  }
  publishState(true);
}

/* ---------- rendering ---------- */

function cardEl(card, playable, onClick) {
  const el = document.createElement('button');
  el.className = 'card' + (card.red ? ' red' : '') + (playable ? ' playable' : '');
  el.disabled = !playable;
  el.innerHTML = `<span class="rank"></span><span class="suit"></span>`;
  el.querySelector('.rank').textContent = card.rank;
  el.querySelector('.suit').textContent = card.suit;
  if (playable) el.addEventListener('click', onClick);
  return el;
}

function render() {
  if (!snapshot) return;
  if (snapshot.phase === 'lobby') {
    show('lobby');
    renderLobby();
  } else {
    show('game');
    renderGame();
  }
}

function renderLobby() {
  const list = $('roster');
  list.textContent = '';
  snapshot.order.forEach((p, i) => {
    const li = document.createElement('li');

    const seat = document.createElement('span');
    seat.className = 'seat';
    seat.textContent = `${i + 1}.`;

    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = p.name;

    li.append(seat, who);

    if (p.id === snapshot.host) {
      const t = document.createElement('span');
      t.className = 'tag';
      t.textContent = 'מארח';
      li.append(t);
    }
    if (p.id === me.id) {
      const t = document.createElement('span');
      t.className = 'tag me';
      t.textContent = 'אתה';
      li.append(t);
    }
    if (!p.online) {
      const t = document.createElement('span');
      t.className = 'tag off';
      t.textContent = 'מנותק';
      li.append(t);
    }

    if (isHost) {
      const up = document.createElement('button');
      up.className = 'move';
      up.textContent = '▲';
      up.disabled = i === 0;
      up.addEventListener('click', () => moveSeat(p.id, -1));

      const down = document.createElement('button');
      down.className = 'move';
      down.textContent = '▼';
      down.disabled = i === snapshot.order.length - 1;
      down.addEventListener('click', () => moveSeat(p.id, 1));

      li.append(up, down);
    }

    list.append(li);
  });

  $('start').disabled = snapshot.order.length < 2;
  if (!$('lobby-note').classList.contains('error')) {
    $('lobby-note').textContent = isHost
      ? 'ממתין לשחקנים. אתה המארח.'
      : 'ממתין שהמארח יתחיל את המשחק.';
  }
}

function renderGame() {
  const inGame = snapshot.order.some((p) => p.id === me.id);
  const banner = $('turn-banner');
  banner.className = 'banner';
  if (!inGame) {
    banner.textContent = 'המשחק כבר התחיל והחדר נעול. אתה צופה בלבד.';
  } else if (snapshot.over) {
    banner.textContent = 'הקלפים נגמרו. המשחק הסתיים.';
    banner.classList.add('over');
  } else if (snapshot.turn === me.id) {
    banner.textContent = 'תורך. בחר קלף.';
    banner.classList.add('mine');
  } else {
    banner.textContent = `תורו של ${nameOf(snapshot.turn)}.`;
  }

  const table = $('table');
  table.textContent = '';
  if (!snapshot.table.length) {
    const e = document.createElement('span');
    e.className = 'empty';
    e.textContent = 'עוד לא הונח קלף.';
    table.append(e);
  }
  for (const entry of snapshot.table) {
    const wrap = document.createElement('div');
    wrap.className = 'played';
    wrap.append(cardEl(entry.card, false, null));
    const by = document.createElement('span');
    by.className = 'by';
    by.textContent = nameOf(entry.by);
    wrap.append(by);
    table.append(wrap);
  }

  const players = $('players');
  players.textContent = '';
  for (const p of snapshot.order) {
    const li = document.createElement('li');
    if (p.id === snapshot.turn && !snapshot.over) li.classList.add('turn');
    li.textContent = p.name + (p.id === me.id ? ' (אתה)' : '');
    const c = document.createElement('span');
    c.className = 'count';
    c.textContent = `${p.count} קלפים`;
    li.append(c);
    players.append(li);
  }

  const hand = $('hand');
  hand.textContent = '';
  const myTurn = inGame && !snapshot.over && snapshot.turn === me.id;
  if (!myHand.length) {
    const e = document.createElement('span');
    e.className = 'empty';
    e.textContent = inGame ? 'אין לך קלפים.' : '';
    hand.append(e);
  }
  for (const card of myHand) {
    hand.append(cardEl(card, myTurn, () => playCard(card.id)));
  }
}

function playCard(cardId) {
  const msg = { t: 'play', id: me.id, card: cardId };
  if (host) onAct(msg);
  else bus.act(msg);
}

initEntry();
