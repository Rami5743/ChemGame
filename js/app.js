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
      turn: 0,
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
  return {
    phase: 'game',
    host: me.id,
    order: host.order.map(row),
    turn: host.order[host.turn],
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
  host.locked = true;
  host.turn = 0;
  publishState(true);
}

/* ---------- rendering ---------- */

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
  // Whose turn it is shows as a frame in the list of players. The banner says
  // only what the frame cannot.
  const banner = $('turn-banner');
  banner.className = 'banner';
  if (!inGame) {
    banner.textContent = 'המשחק כבר התחיל והחדר נעול. אתה צופה בלבד.';
  } else if (snapshot.turn === me.id) {
    banner.textContent = 'תורך.';
    banner.classList.add('mine');
  } else {
    banner.textContent = '';
    banner.classList.add('hidden');
  }

  $('board').textContent = 'לוח המשחק ייבנה כאן.';

  const players = $('players');
  players.textContent = '';
  snapshot.order.forEach((p, i) => {
    const li = document.createElement('li');
    if (p.id === snapshot.turn) li.classList.add('turn');
    if (!p.online) li.classList.add('gone');

    const seat = document.createElement('span');
    seat.className = 'seat';
    seat.textContent = `${i + 1}.`;

    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = p.name + (p.id === me.id ? ' (אתה)' : '');

    li.append(seat, who);
    players.append(li);
  });
}

initEntry();
