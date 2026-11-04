import { createBus } from './net.js';
import { newGame, apply, publicView, privateView } from './rules.js';
import { MOLECULES, ELEMENTS } from './cards.js';

const $ = (id) => document.getElementById(id);

const DEFAULT_DEAL = { atoms: 12, molecules: 3 };
const DECK_SIZE = { atoms: 72, molecules: 36 };

const HEARTBEAT_MS = 4000;
const OFFLINE_MS = 12000;
const NO_HOST_MS = 9000;

const me = { id: clientId(), name: '' };
let room = roomFromHash();
let isHost = false;
let bus = null;
let snapshot = null; // last public state published by the host
let myCards = null; // what the host sent to me alone
let host = null; // host-only bookkeeping
let moveSeq = 0;
const awaitingMove = new Map();
let noHostTimer = null;

const seatName = (n) => `שחקן ${n}`;

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
  // No name is a fine answer: the host hands out one by join order.
  me.name = $('name-input').value.trim().slice(0, 16);
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
      players: new Map([[me.id, { id: me.id, name: me.name || seatName(1), last: Date.now() }]]),
      order: [me.id],
      locked: false,
      turn: 0,
      deal: { ...DEFAULT_DEAL },
      game: null,
      rev: 0,
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
      for (const id of host.order) bus.clearPlayer(id);
      bus.clearState();
    }
  });

  $('share').value = shareLink();
  $('copy').addEventListener('click', copyLink);
  $('start').addEventListener('click', startGame);
  for (const id of ['set-atoms', 'set-mols']) {
    $(id).addEventListener('input', () => {
      if (!host || host.locked) return;
      const { deal } = readDeal(host.order.length);
      if (deal) {
        host.deal = deal;
        publishState();
      }
    });
  }
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
    const grew = !snapshot || msg.rev > snapshot.rev;
    snapshot = msg;
    if (grew) {
      for (const [seq, resolve] of awaitingMove) {
        awaitingMove.delete(seq);
        resolve(null);
      }
    }
    if (noHostTimer) {
      clearTimeout(noHostTimer);
      noHostTimer = null;
    }
    render();
  } else if (sub === `p/${me.id}`) {
    if (msg.t === 'hand') {
      myCards = msg;
      render();
    } else if (msg.t === 'rejected') {
      const resolve = awaitingMove.get(msg.seq);
      if (resolve) {
        awaitingMove.delete(msg.seq);
        resolve(msg.error);
      }
      showReject(msg.error);
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
    return { phase: 'lobby', host: me.id, order: host.order.map(row), deal: host.deal };
  }
  const pub = publicView(host.game);
  const counts = Object.fromEntries(pub.seats.map((s) => [s.id, s]));
  return {
    phase: 'game',
    host: me.id,
    deal: host.deal,
    order: host.order.map((id) => ({
      ...row(id),
      atoms: counts[id].atoms,
      molecules: counts[id].molecules,
    })),
    turn: pub.turn,
    game: {
      phase: pub.phase,
      area: pub.area,
      pickKind: pub.pickKind,
      takeback: pub.takeback,
      atomDeck: pub.atomDeck,
      atomDiscard: pub.atomDiscard,
      molDeck: pub.molDeck,
      molDiscard: pub.molDiscard,
      winner: pub.winner,
    },
  };
}

function publishState(force) {
  if (!host) return;
  const payload = buildState();
  const sig = JSON.stringify(payload);
  if (!force && sig === host.lastSig) return;
  host.lastSig = sig;
  payload.rev = ++host.rev;
  bus.state(payload);
}

// Each player is told his own cards and nothing else.
function sendHands() {
  for (const id of host.order) {
    bus.toPlayer(id, { t: 'hand', ...privateView(host.game, id) });
  }
}

function onAct(msg) {
  if (!msg || !msg.id) return;

  if (msg.t === 'hello') {
    const p = host.players.get(msg.id);
    if (p) {
      p.last = Date.now();
      // An empty name must not wipe the one the host handed out.
      const sent = String(msg.name || '').slice(0, 16);
      if (!host.locked && sent) p.name = sent;
    } else if (!host.locked) {
      host.players.set(msg.id, {
        id: msg.id,
        name: String(msg.name || '').slice(0, 16) || seatName(host.order.length + 1),
        last: Date.now(),
      });
      host.order.push(msg.id);
    } else {
      return; // the room is locked and this is not one of its players
    }
    publishState();
    return;
  }

  if (msg.t === 'move') {
    if (!host.locked || !host.game) return;
    const p = host.players.get(msg.id);
    if (!p) return;
    p.last = Date.now();
    const r = apply(host.game, msg.id, msg.move || {});
    if (!r.ok) {
      bus.toPlayer(msg.id, { t: 'rejected', seq: msg.seq, error: r.error }, false);
      return;
    }
    sendHands();
    publishState(true);
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
}

function moveSeat(id, delta) {
  if (!host || host.locked) return;
  const i = host.order.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= host.order.length) return;
  [host.order[i], host.order[j]] = [host.order[j], host.order[i]];
  publishState();
}

// Reads the two inputs, or explains what is wrong with them.
function readDeal(seats) {
  const whole = (el, fallback) => {
    const n = Number(el.value);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  const deal = {
    atoms: whole($('set-atoms'), DEFAULT_DEAL.atoms),
    molecules: whole($('set-mols'), DEFAULT_DEAL.molecules),
  };
  for (const kind of ['atoms', 'molecules']) {
    if (deal[kind] * seats > DECK_SIZE[kind]) {
      return {
        error:
          kind === 'atoms'
            ? `אין מספיק קלפי אטום בחפיסה. יש ${DECK_SIZE.atoms}, ולכן לכל היותר ${Math.floor(DECK_SIZE.atoms / seats)} לכל שחקן.`
            : `אין מספיק קלפי מולקולה בחפיסה. יש ${DECK_SIZE.molecules}, ולכן לכל היותר ${Math.floor(DECK_SIZE.molecules / seats)} לכל שחקן.`,
      };
    }
  }
  return { deal };
}

// ?seed=<n> replays the same shuffle, which is what the tests run on and what
// makes a reported game reproducible.
function gameSeed() {
  const forced = Number(new URLSearchParams(location.search).get('seed'));
  if (Number.isInteger(forced) && forced > 0) return forced >>> 0;
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

function lobbyError(text) {
  $('lobby-note').textContent = text;
  $('lobby-note').classList.add('error');
}

function startGame() {
  if (!host || host.locked) return;
  if (host.order.length < 2) {
    lobbyError('צריך לפחות שני שחקנים כדי להתחיל.');
    return;
  }
  const { deal, error } = readDeal(host.order.length);
  if (error) {
    lobbyError(error);
    return;
  }
  host.deal = deal;
  host.locked = true;
  host.game = newGame({ seats: [...host.order], deal, seed: gameSeed() });
  sendHands();
  publishState(true);
}

// Sends a move and resolves with null when it went through, or with the
// reason it did not.
function sendMove(move) {
  const seq = ++moveSeq;
  const answer = new Promise((resolve) => {
    awaitingMove.set(seq, resolve);
    setTimeout(() => {
      if (awaitingMove.delete(seq)) resolve('אין תשובה מהמארח');
    }, 8000);
  });
  const msg = { t: 'move', id: me.id, seq, move };
  if (host) onAct(msg);
  else bus.act(msg);
  return answer;
}

function showReject(text) {
  $('game-note').textContent = text;
  $('game-note').classList.add('error');
  clearTimeout(showReject.timer);
  showReject.timer = setTimeout(() => {
    $('game-note').textContent = '';
    $('game-note').classList.remove('error');
  }, 4000);
}

/* ---------- rendering ---------- */

const PROMPT = {
  opening: 'תורך לפתוח מולקולה, או למשוך חמישה קלפים ולבחור אחד.',
  building: 'תורך.',
  picking: 'בחר קלף אחד מתוך החמישה.',
  takeback: 'אפשר לקחת בחזרה קלף אטום אחד שהנחת.',
};

function nameOf(id) {
  const row = (snapshot?.order || []).find((p) => p.id === id);
  return row ? row.name : 'שחקן';
}

// Stands in for the board until the cards are drawn on screen.
function boardSummary(g) {
  if (!g.area) return '';
  const parts = [];
  parts.push(g.area.molecule ? `מולקולה: ${MOLECULES[g.area.molecule].name}` : 'אין מולקולה על השולחן');
  if (g.area.alkaneN) parts.push(`אטומי פחמן: ${g.area.alkaneN}`);
  if (g.area.units.length) {
    parts.push('על השולחן: ' + g.area.units.map((u) => ELEMENTS[u.el].symbol).join(' '));
  }
  parts.push(`קופת אטומים: ${g.atomDeck}`, `קופת מולקולות: ${g.molDeck}`);
  return parts.join(' · ');
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
  const d = snapshot.deal || DEFAULT_DEAL;
  $('deal-note').textContent = `לכל שחקן יחולקו: ${d.atoms} קלפי אטום, ${d.molecules} קלפי מולקולה.`;
  if (!$('lobby-note').classList.contains('error')) {
    $('lobby-note').textContent = isHost
      ? 'ממתין לשחקנים. אתה המארח.'
      : 'ממתין שהמארח יתחיל את המשחק.';
  }
}

function renderGame() {
  const inGame = snapshot.order.some((p) => p.id === me.id);
  // Whose turn it is shows as a frame in the list of players. The banner says
  // only what the frame cannot.
  const g = snapshot.game || {};
  const waiting = g.phase === 'takeback' ? g.takeback.pending : [snapshot.turn];

  const banner = $('turn-banner');
  banner.className = 'banner';
  if (!inGame) {
    banner.textContent = 'המשחק כבר התחיל והחדר נעול. אתה צופה בלבד.';
  } else if (g.winner) {
    banner.textContent = g.winner === me.id ? 'ניצחת.' : `${nameOf(g.winner)} ניצח.`;
    banner.classList.add('over');
  } else if (waiting.includes(me.id)) {
    banner.textContent = PROMPT[g.phase] || 'תורך.';
    banner.classList.add('mine');
  } else {
    banner.textContent = '';
    banner.classList.add('hidden');
  }

  $('board').textContent = boardSummary(g);

  const players = $('players');
  players.textContent = '';
  snapshot.order.forEach((p, i) => {
    const li = document.createElement('li');
    if (waiting.includes(p.id) && !g.winner) li.classList.add('turn');
    if (!p.online) li.classList.add('gone');

    const seat = document.createElement('span');
    seat.className = 'seat';
    seat.textContent = `${i + 1}.`;

    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = p.name + (p.id === me.id ? ' (אתה)' : '');

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${p.atoms} · ${p.molecules}`;
    count.title = 'קלפי אטום · קלפי מולקולה';

    li.append(seat, who, count);
    players.append(li);
  });
}

// The page's own handle on the game. The host validates every move, so
// nothing here grants a player anything he could not ask for anyway.
window.chemgame = {
  move: sendMove,
  state: () => snapshot,
  cards: () => myCards,
  me: () => ({ ...me }),
};

initEntry();
