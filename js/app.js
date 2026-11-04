import { createBus } from './net.js';
import { newGame, apply, publicView, privateView } from './rules.js';
import { layoutFor } from './layouts.js';
import {
  MOLECULES,
  ELEMENTS,
  FUSION,
  FUSION_CARD,
  ALKANE_MIN,
  ALKANE_MAX,
  cardArt,
} from './cards.js';

const $ = (id) => document.getElementById(id);

const DEFAULT_DEAL = { atoms: 12, molecules: 3 };
const DECK_SIZE = { atoms: 72, molecules: 36 };

const HEARTBEAT_MS = 4000;
const OFFLINE_MS = 12000;
const STALE_MS = 20000;
const NO_HOST_MS = 9000;

const me = { id: clientId(), name: '' };
let room = roomFromHash();
let isHost = false;
let bus = null;
let snapshot = null; // last public state published by the host
let myCards = null; // what the host sent to me alone
let host = null; // host-only bookkeeping
let lastStateAt = 0;
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

  // A tab that was already in this room walks back into it, which is what a
  // reload in the middle of a game should do.
  if (joining && sessionStorage.getItem('cg_room') === room) {
    me.name = localStorage.getItem('cg_name') || '';
    connect();
    return;
  }

  $('name-title').textContent = joining ? 'הצטרפות למשחק' : 'משחק חדש';
  $('name-go').textContent = joining ? 'הצטרף' : 'צור משחק';
  $('name-input').value = localStorage.getItem('cg_name') || '';
  $('name-fresh').classList.toggle('hidden', !joining);
  $('name-fresh').addEventListener('click', () => {
    location.href = `${location.origin}${location.pathname}${location.search}`;
  });
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

  if (!isHost) sessionStorage.setItem('cg_room', room);

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
    let tick = 0;
    setInterval(() => {
      host.players.get(me.id).last = Date.now();
      answerForTheAbsent();
      // Every tenth second the snapshot goes out whether it changed or not,
      // so the others can tell a quiet host from a host who has gone.
      publishState(++tick % 5 === 0);
    }, 2000);
    publishState();
  } else {
    const beat = () => bus.act({ t: 'hello', id: me.id, name: me.name });
    beat();
    setInterval(beat, HEARTBEAT_MS);
    setInterval(() => {
      const stale = lastStateAt && Date.now() - lastStateAt > STALE_MS;
      $('alert').classList.toggle('hidden', !stale);
      if (stale) {
        $('alert').textContent = 'המארח אינו מחובר. המשחק ממתין לו, או שאפשר לפתוח משחק חדש.';
      }
    }, 4000);
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
    lastStateAt = Date.now();
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
  // Everything the rules make public travels, minus what the seats already
  // carry, so a new field never has to be listed here twice.
  const { seats, turn, ...game } = publicView(host.game);
  const counts = Object.fromEntries(seats.map((s) => [s.id, s]));
  return {
    phase: 'game',
    host: me.id,
    deal: host.deal,
    order: host.order.map((id) => ({
      ...row(id),
      atoms: counts[id].atoms,
      molecules: counts[id].molecules,
    })),
    turn,
    game,
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

// Reads a pair of inputs, or explains what is wrong with them.
function readDeal(seats, atomsEl = 'set-atoms', molsEl = 'set-mols') {
  const whole = (el, fallback) => {
    const n = Number(el.value);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  const deal = {
    atoms: whole($(atomsEl), DEFAULT_DEAL.atoms),
    molecules: whole($(molsEl), DEFAULT_DEAL.molecules),
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

// A player who has dropped off must not hold the whole table up at the one
// point where the game waits for everybody: declining is the neutral answer.
function answerForTheAbsent() {
  const g = host.game;
  if (!g || g.phase !== 'takeback') return;
  const now = Date.now();
  for (const id of [...g.takeback.pending]) {
    const p = host.players.get(id);
    if (p && now - p.last > OFFLINE_MS) apply(g, id, { t: 'takeBack', card: null });
  }
  sendHands();
  publishState(true);
}

// The same players, dealt again, with sizes the host may change first.
function startAgain() {
  if (!host || !host.game) return;
  const { deal, error } = readDeal(host.order.length, 'again-atoms', 'again-mols');
  if (error) {
    showReject(error);
    return;
  }
  host.deal = deal;
  host.rematches = (host.rematches || 0) + 1;
  host.game = newGame({
    seats: [...host.order],
    deal,
    seed: (gameSeed() + host.rematches) >>> 0,
  });
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

/* ---------- what the player has selected ---------- */

// A move is chosen first and its cards second, so at every moment the screen
// can say which card it is waiting for.
const chosen = { mode: null, molecule: null, atoms: new Set(), alkaneN: 3 };

function clearChoice() {
  chosen.mode = null;
  chosen.molecule = null;
  chosen.atoms.clear();
}

function setMode(mode) {
  clearChoice();
  chosen.mode = mode;
  render();
}

// Which card the move that is under way is waiting for.
function currentStep() {
  if (!chosen.mode) return null;
  if (chosen.mode === 'takeOne') return 'table';
  if ((chosen.mode === 'open' || chosen.mode === 'swap') && !chosen.molecule) return 'molecule';
  return 'atoms';
}

const STEP_PROMPT = {
  molecule: {
    open: 'בחר מהיד את קלף המולקולה שתרצה לפתוח בה.',
    swap: 'בחר מהיד את קלף המולקולה שיחליף את זו שעל השולחן.',
  },
  atoms: 'תורך. בחר קלף אטום והנח אותו. להיתוך גרעיני, בחר את קלף ההיתוך ואת האטומים שמתאחים איתו.',
  table: 'בחר אטום שהנחת בעצמך, כדי לקחת אותו בחזרה.',
};

function stepPrompt() {
  const step = currentStep();
  if (step === 'molecule') return STEP_PROMPT.molecule[chosen.mode];
  if (step) return STEP_PROMPT[step];
  return null;
}

async function act(move) {
  const error = await sendMove(move);
  if (!error) {
    clearChoice();
    render();
  }
}

/* ---------- building blocks ---------- */

function cardButton({ src, alt, pickable, chosen: isChosen, dim, badge, onClick, title, id }) {
  const el = document.createElement('button');
  el.className =
    'cardbtn' + (pickable ? ' pickable' : '') + (isChosen ? ' chosen' : '') + (dim ? ' dim' : '');
  el.type = 'button';
  el.disabled = !pickable;
  if (title) el.title = title;
  if (id) el.dataset.id = id;

  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  img.loading = 'lazy';
  el.append(img);

  if (badge) {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = badge;
    el.append(b);
  }
  if (pickable && onClick) el.addEventListener('click', onClick);
  return el;
}

const atomCard = (el, opts = {}) =>
  cardButton({ src: cardArt.atom(el), alt: el === FUSION ? FUSION_CARD.name : ELEMENTS[el].name, ...opts });

const moleculeCard = (id, opts = {}) =>
  cardButton({ src: cardArt.molecule(id), alt: MOLECULES[id].name, ...opts });

function button(label, act, onClick, enabled = true) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.dataset.act = act;
  b.disabled = !enabled;
  if (enabled) b.addEventListener('click', onClick);
  return b;
}

const alkaneLabel = (n) => `C${n}H${2 * n + 2}`;
const isAlkane = (id) => MOLECULES[id] && MOLECULES[id].special === 'alkanes';

function chosenMoleculeId() {
  const card = (myCards?.molecules || []).find((c) => c.id === chosen.molecule);
  return card ? card.mol : null;
}

/* ---------- the screen ---------- */

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
  const g = snapshot.game || {};
  const waiting = g.phase === 'takeback' ? g.takeback.pending : [snapshot.turn];
  const myMove = inGame && !g.winner && waiting.includes(me.id);

  // While a molecule is being built, laying an atom is what a turn is for, so
  // that move is already under way and a card can simply be clicked.
  if (!myMove) clearChoice();
  else if (g.phase === 'building' && !chosen.mode) chosen.mode = 'place';

  renderBanner(g, inGame, waiting);
  renderSeats(g, waiting);
  renderTable(g, myMove);
  renderDecks(g);
  renderHand(g, myMove);
  renderActions(g, myMove);
  renderOverlay(g);
}

function renderBanner(g, inGame, waiting) {
  const banner = $('turn-banner');
  banner.className = 'banner';
  if (!inGame) {
    banner.textContent = 'המשחק כבר התחיל והחדר נעול. אתה צופה בלבד.';
  } else if (g.winner) {
    banner.textContent = g.winner === me.id ? 'ניצחת.' : `${nameOf(g.winner)} ניצח.`;
    banner.classList.add('over');
  } else if (waiting.includes(me.id)) {
    banner.textContent = stepPrompt() || PROMPT[g.phase] || 'תורך.';
    banner.classList.add('mine');
  } else {
    banner.textContent = `ממתינים ל${nameOf(waiting[0])}.`;
  }
}

function renderSeats(g, waiting) {
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

function renderTable(g, myMove) {
  const slot = $('table-mol');
  slot.textContent = '';
  if (g.area.molecule) {
    slot.append(
      moleculeCard(g.area.molecule, {
        badge: g.area.alkaneN ? alkaneLabel(g.area.alkaneN) : null,
        title: MOLECULES[g.area.molecule].name,
      })
    );
  } else {
    const e = document.createElement('span');
    e.className = 'empty';
    e.textContent = 'אין מולקולה על השולחן.';
    slot.append(e);
  }

  const takingBack = myMove && g.phase === 'takeback' && currentStep() === 'table';
  const grid = $('table-units');
  grid.textContent = '';

  const layout = g.area.molecule ? layoutFor(g.area.molecule, g.area.alkaneN) : null;
  grid.className = layout ? 'units-grid' : 'units-grid units-plain';
  if (!layout) {
    for (const u of g.area.units) grid.append(unitEl(u, takingBack));
    return;
  }

  // Each atom goes to the first free spot of its own kind, so the table grows
  // into the shape the card draws.
  const slots = layout.map((s) => ({ ...s, unit: null }));
  const extras = [];
  for (const u of g.area.units) {
    const slot = slots.find((s) => s.el === u.el && !s.unit);
    if (slot) slot.unit = u;
    else extras.push(u);
  }
  for (const s of slots) {
    const node = s.unit ? unitEl(s.unit, takingBack) : emptySlotEl(s.el);
    node.style.gridColumn = String(s.x + 1);
    node.style.gridRow = String(s.y + 1);
    grid.append(node);
  }
  for (const u of extras) grid.append(unitEl(u, takingBack));
}

// A fused group lies on the table as a pile: only the fusion card shows, and
// what the fusion came to is written above it. It opens out only for the one
// moment its owner may take a card back out of it.
function unitEl(u, takingBack) {
  const fused = u.cards.length > 1;
  const mineNow = takingBack && u.by === me.id;
  const wrap = document.createElement('div');
  wrap.className = 'unit' + (fused ? ' fused' : '');

  const cardFor = (c) => {
    const mine = mineNow && c.el !== FUSION;
    return atomCard(c.el, {
      id: c.id,
      pickable: mine,
      title: mine ? 'קח בחזרה' : nameOf(u.by),
      onClick: () => act({ t: 'takeBack', card: c.id }),
    });
  };

  if (!fused) {
    wrap.append(cardFor(u.cards[0]));
    return wrap;
  }

  const label = document.createElement('span');
  label.className = 'sum';
  label.textContent = `${ELEMENTS[u.el].name} ${ELEMENTS[u.el].z}`;
  wrap.append(label);

  if (mineNow) {
    const spread = document.createElement('div');
    spread.className = 'spread';
    for (const c of u.cards) spread.append(cardFor(c));
    wrap.append(spread);
    return wrap;
  }

  const stack = document.createElement('div');
  stack.className = 'stack';
  const under = u.cards.filter((c) => c.el !== FUSION);
  under.forEach((c, i) => {
    const el = cardFor(c);
    el.classList.add('buried');
    const off = (under.length - i) * 4;
    el.style.transform = `translate(${off}px, ${off}px)`;
    stack.append(el);
  });
  for (const c of u.cards.filter((c) => c.el === FUSION)) stack.append(cardFor(c));
  wrap.append(stack);
  return wrap;
}

function emptySlotEl(el) {
  const d = document.createElement('div');
  d.className = 'slot-empty';
  d.textContent = ELEMENTS[el].symbol;
  d.title = `חסר ${ELEMENTS[el].name}`;
  return d;
}

function pile(src, label, count) {
  const d = document.createElement('div');
  d.className = 'pile';
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    d.append(img);
  } else {
    const blank = document.createElement('div');
    blank.className = 'blank';
    blank.textContent = 'ריקה';
    d.append(blank);
  }
  const t = document.createElement('span');
  t.className = 'pile-label';
  t.textContent = `${label}: ${count}`;
  d.append(t);
  return d;
}

function renderDecks(g) {
  const decks = $('decks');
  decks.textContent = '';
  decks.append(
    pile(cardArt.atomBack(), 'קופת אטומים', g.atomDeck),
    pile(g.atomDiscardTop ? cardArt.atom(g.atomDiscardTop) : null, 'אטומים משומשים', g.atomDiscard),
    pile(cardArt.moleculeBack(), 'קופת מולקולות', g.molDeck),
    pile(g.molDiscardTop ? cardArt.molecule(g.molDiscardTop) : null, 'מולקולות משומשות', g.molDiscard)
  );
}

function renderHand(g, myMove) {
  const step = myMove ? currentStep() : null;
  const molTurn = step === 'molecule';
  const atomTurn = step === 'atoms';

  const mols = $('hand-mols');
  mols.textContent = '';
  for (const c of myCards?.molecules || []) {
    mols.append(
      moleculeCard(c.mol, {
        id: c.id,
        pickable: molTurn,
        dim: !!step && !molTurn,
        chosen: chosen.molecule === c.id,
        title: MOLECULES[c.mol].name,
        onClick: () => {
          chosen.molecule = chosen.molecule === c.id ? null : c.id;
          render();
        },
      })
    );
  }

  const atoms = $('hand-atoms');
  atoms.textContent = '';
  for (const c of myCards?.atoms || []) {
    atoms.append(
      atomCard(c.el, {
        id: c.id,
        pickable: atomTurn,
        dim: !!step && !atomTurn,
        chosen: chosen.atoms.has(c.id),
        onClick: () => {
          if (chosen.atoms.has(c.id)) chosen.atoms.delete(c.id);
          else chosen.atoms.add(c.id);
          render();
        },
      })
    );
  }
}

function numberField(id, label, value, max) {
  const field = document.createElement('label');
  field.className = 'num';
  field.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.id = id;
  input.min = '1';
  input.max = String(max);
  input.value = String(value);
  field.append(input);
  return field;
}

function renderActions(g, myMove) {
  const bar = $('actions');

  if (g.winner) {
    // Leave the fields alone once they are up, so typing in them survives.
    if (!isHost || $('again-atoms')) return;
    bar.textContent = '';
    bar.append(
      numberField('again-atoms', 'קלפי אטום לכל שחקן', snapshot.deal.atoms, 24),
      numberField('again-mols', 'קלפי מולקולה לכל שחקן', snapshot.deal.molecules, 8),
      button('משחק חדש', 'again', startAgain)
    );
    return;
  }

  bar.textContent = '';
  if (!myMove || g.phase === 'picking') return;

  if (g.phase === 'opening') {
    if (chosen.mode === 'open') {
      renderModeBar(bar);
      return;
    }
    bar.append(
      button('פתח מולקולה', 'open', () => setMode('open')),
      button('בחר מולקולה', 'fiveMolecules', () => act({ t: 'drawFive', kind: 'molecules' })),
      button('בחר אטום', 'fiveAtoms', () => act({ t: 'drawFive', kind: 'atoms' }))
    );
    return;
  }

  if (g.phase === 'building') {
    if (chosen.mode === 'swap') {
      renderModeBar(bar);
      return;
    }
    const atoms = [...chosen.atoms];
    bar.append(
      button('הנח', 'place', () => act({ t: 'placeUnit', cards: atoms }), atoms.length > 0),
      button('החלף מולקולה', 'swap', () => setMode('swap'))
    );
    if (g.atomDeck || g.atomDiscard) {
      bar.append(button('משוך קלף אטום', 'draw', () => act({ t: 'drawAtom' })));
    } else {
      bar.append(button('ויתור על התור', 'pass', () => act({ t: 'pass' })));
    }
    return;
  }

  if (g.phase === 'takeback') {
    bar.append(
      button('קח קלף בחזרה', 'takeOne', () => setMode('takeOne')),
      button('לא לקחת כלום', 'takeNothing', () => act({ t: 'takeBack', card: null }))
    );
  }
}

// While a move is under way the bar holds what that move still needs.
function renderModeBar(bar) {
  const atoms = [...chosen.atoms];
  const molId = chosenMoleculeId();

  if (isAlkane(molId)) {
    const field = document.createElement('label');
    field.className = 'num';
    field.textContent = 'אטומי פחמן';
    const input = document.createElement('input');
    input.type = 'number';
    input.id = 'alkane-n';
    input.min = String(ALKANE_MIN);
    input.max = String(ALKANE_MAX);
    input.value = String(chosen.alkaneN);
    // Stored without a re-render, so typing does not steal the field away.
    input.addEventListener('input', () => {
      chosen.alkaneN = Number(input.value);
    });
    field.append(input);
    bar.append(field);
  }
  const alkaneN = isAlkane(molId) ? chosen.alkaneN : undefined;

  if (chosen.mode === 'open') {
    bar.append(
      button('אשר', 'confirm', () =>
        act({ t: 'startMolecule', molecule: chosen.molecule, cards: atoms, alkaneN }),
        !!chosen.molecule && atoms.length > 0
      )
    );
  } else if (chosen.mode === 'swap') {
    bar.append(
      button('אשר', 'confirm', () =>
        act({ t: 'swapMolecule', molecule: chosen.molecule, cards: atoms, alkaneN }),
        !!chosen.molecule && atoms.length > 0
      )
    );
  }

  bar.append(button('ביטול', 'cancel', () => {
    clearChoice();
    render();
  }));
}

function renderOverlay(g) {
  const overlay = $('overlay');
  const pick = myCards?.pick;
  const mine = g.phase === 'picking' && snapshot.turn === me.id && pick;
  overlay.classList.toggle('hidden', !mine);
  if (!mine) return;

  $('overlay-title').textContent =
    pick.kind === 'atoms'
      ? 'בחר קלף אטום אחד מתוך החמישה. השאר יושלכו.'
      : 'בחר קלף מולקולה אחד מתוך החמישה. השאר יושלכו.';
  const box = $('overlay-cards');
  box.textContent = '';
  for (const c of pick.cards) {
    const opts = { id: c.id, pickable: true, onClick: () => act({ t: 'pick', card: c.id }) };
    box.append(pick.kind === 'atoms' ? atomCard(c.el, opts) : moleculeCard(c.mol, opts));
  }
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
