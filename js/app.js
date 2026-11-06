import { createBus, brokerList, shownAs } from './net.js';
import { t, lang, setLang, onLang, applyStaticWords } from './i18n.js';
import { newGame, apply, publicView, privateView, formulaOf } from './rules.js';
import { botMove, BOT_NAMES, BOT_NAMES_EN } from './bot.js';
import { layoutFor } from './layouts.js';
import {
  MOLECULES,
  ELEMENTS,
  FUSION,
  FUSION_CARD,
  ALKANE_MIN,
  ALKANE_MAX,
  cardArt,
  nameIn,
} from './cards.js';

const $ = (id) => document.getElementById(id);

const DEFAULT_DEAL = { atoms: 12, molecules: 3 };
const DECK_SIZE = { atoms: 72, molecules: 36 };

const HEARTBEAT_MS = 4000;
// Five missed heartbeats, not three: a phone on a slow network goes quiet for
// a few seconds at a time, and a player counted as gone has his turn taken
// for him.
const OFFLINE_MS = 22000;
const STALE_MS = 20000;
const NO_HOST_MS = 15000;
const PATIENCE_MS = 9000;

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
// This page load, told apart from any other, so that two copies of one move
// can be told apart from two moves.
const TAB = Math.random().toString(36).slice(2, 10);
let noHostTimer = null;
let noHostShown = false;
let lastHandSig = '';

const seatName = (n) => t('seat.name', { n });

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
  // Each player keeps the language he chose, so it does not travel in a link.
  const params = new URLSearchParams(location.search);
  params.delete('lang');
  const query = params.toString();
  return `${location.origin}${location.pathname}${query ? '?' + query : ''}#${room}`;
}

function show(which) {
  for (const v of ['name', 'lobby', 'game']) {
    $('view-' + v).classList.toggle('hidden', v !== which);
  }
}

function setStatus(state) {
  $('status').dataset.state = state;
  $('status').textContent = t(`status.${state}`);
}

// Tapping the chip says which brokers answered and which did not.
$('status').addEventListener('click', toggleLinks);
for (const b of document.querySelectorAll('#table-views button')) {
  b.addEventListener('click', () => chooseView(b.dataset.view));
}

/* ---------- entry screen ---------- */

// The two words of the entry screen that depend on whether this tab opened
// the game or was invited to it.
function paintEntryWords() {
  const joining = !!room;
  $('name-title').textContent = t(joining ? 'entry.joinTitle' : 'entry.newTitle');
  $('name-go').textContent = t(joining ? 'entry.join' : 'entry.create');
}

function initEntry() {
  const joining = !!room;

  // A tab that was already in this room walks back into it, which is what a
  // reload in the middle of a game should do.
  if (joining && sessionStorage.getItem('cg_room') === room) {
    me.name = localStorage.getItem('cg_name') || '';
    connect();
    return;
  }

  paintEntryWords();
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
    updateDocLinks();
  }
  connect();
}

/* ---------- connection ---------- */

// Host and player alike hold a connection to every broker they can reach and
// repeat everything on all of them, so the two need only one broker in common,
// not the same one. A move that reaches the host twice is counted once, by the
// mark it carries.
function hostFanout(urls) {
  const live = [];
  const up = new Set();
  const each = (fn) => {
    for (const b of live) {
      try { fn(b); } catch { /* a broker that is down must not stop the rest */ }
    }
  };
  for (const url of urls) {
    live.push(createBus({
      url,
      room,
      clientId: me.id,
      isHost: true,
      onMessage,
      onStatus: (state) => {
        noteLink(url, state);
        if (state === 'on') {
          if (!up.has(url)) {
            up.add(url);
            // A broker that joins late has none of the retained messages yet.
            setTimeout(() => { sendHands(); publishState(true); }, 0);
          }
        } else {
          up.delete(url);
        }
        setStatus(up.size ? 'on' : 'wait');
        $('status').title = up.size ? [...up].map(shownAs).join('\n') : t('links.none');
      },
    }));
  }
  setTimeout(() => { if (!up.size) noBroker(); }, 22000);
  return {
    act: (o) => each((b) => b.act(o)),
    state: (o) => each((b) => b.state(o)),
    toPlayer: (id, o, r) => each((b) => b.toPlayer(id, o, r)),
    clearPlayer: (id) => each((b) => b.clearPlayer(id)),
    clearState: () => each((b) => b.clearState()),
    stop: () => each((b) => b.stop()),
  };
}

// A player holds them all too, and sends on every one that is up: the host may
// be listening on a different one from the one the state came in on.
function playerRelay(urls) {
  const buses = [];
  const live = new Set();
  const each = (fn) => {
    for (const b of buses) {
      if (!live.has(b)) continue;
      try { fn(b); } catch { /* a broker that is down must not stop the rest */ }
    }
  };

  for (const url of urls) {
    // A broker is never dropped, but one that has not answered in time is
    // named as such in the diagnostic, so the list says what is going on.
    let answered = false;
    let patience = true;
    setTimeout(() => {
      patience = false;
      if (!answered) noteLink(url, 'dead');
    }, PATIENCE_MS);

    const b = createBus({
      url,
      room,
      clientId: me.id,
      isHost: false,
      onMessage,
      onStatus: (state) => {
        if (state === 'on') answered = true;
        noteLink(url, !answered && !patience ? 'dead' : state);
        const had = live.size;
        if (state === 'on') live.add(b);
        else live.delete(b);
        setStatus(live.size ? 'on' : state === 'err' ? 'err' : 'wait');
        $('status').title = live.size
          ? [...live].map((x) => shownAs(x.url)).join('\n')
          : t('links.none');
        if (state === 'on') {
          b.act({ t: 'hello', id: me.id, name: me.name });
          // Back in touch: whatever was said about being cut off is over,
          // unless the list of brokers is what is on the screen.
          if (!had && !linksOpen) $('alert').classList.add('hidden');
        }
      },
    });
    buses.push(b);
  }

  // None is ever given up on: the connection keeps trying by itself, so a
  // phone that was out of reach walks back in without a reload.
  setTimeout(() => { if (!live.size) noBroker(); }, 22000);

  return {
    act: (o) => each((b) => b.act(o)),
    state: () => {},
    toPlayer: () => {},
    clearPlayer: () => {},
    clearState: () => {},
    stop: () => { for (const b of buses) b.stop(); },
  };
}

/* ---------- which brokers answered ---------- */

const links = new Map();
const LINK_STATES = ['on', 'wait', 'err', 'dead'];
let linksOpen = false;

function noteLink(url, state) {
  links.set(url, state);
  if (linksOpen) showLinks();
}

// Readable on a phone, where there is nothing to hover over.
function showLinks() {
  const box = $('alert');
  box.textContent = '';
  const title = document.createElement('div');
  title.textContent = t('links.title');
  box.append(title);
  for (const [url, state] of links) {
    const row = document.createElement('div');
    row.className = 'link-row';
    const word = document.createElement('span');
    word.className = 'link-state';
    word.textContent = LINK_STATES.includes(state) ? t(`links.${state}`) : state;
    const where = document.createElement('span');
    where.dir = 'ltr';
    where.className = 'link-url';
    where.textContent = shownAs(url).replace(/^wss?:\/\//, '');
    row.append(word, where);
    box.append(row);
  }
  box.classList.remove('hidden');
}

function toggleLinks() {
  linksOpen = !linksOpen;
  if (linksOpen) showLinks();
  else $('alert').classList.add('hidden');
}

function noBroker() {
  setStatus('err');
  $('alert').classList.remove('hidden');
  $('alert').textContent =
    t('alert.noBroker');
}

function connect() {
  setStatus('wait');
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
      // This host, told apart from any other that may hold the same room, so
      // that a game begun again is not taken for an old snapshot.
      epoch: Date.now(),
      lastSig: '',
      done: new Set(),
      bots: new Map(),  // id -> name, the seats the host plays himself
    };
    bus = hostFanout(brokerList());
    let tick = 0;
    setInterval(() => {
      host.players.get(me.id).last = Date.now();
      for (const id of host.bots.keys()) {
        const seat = host.players.get(id);
        if (seat) seat.last = Date.now();
      }
      answerForTheAbsent();
      // Every tenth second the snapshot goes out whether it changed or not,
      // so the others can tell a quiet host from a host who has gone.
      publishState(++tick % 5 === 0);
    }, 2000);
    publishState();
  } else {
    bus = playerRelay(brokerList());
    setInterval(() => bus.act({ t: 'hello', id: me.id, name: me.name }), HEARTBEAT_MS);
    setInterval(() => {
      if (linksOpen) return;
      const stale = lastStateAt && Date.now() - lastStateAt > STALE_MS;
      $('alert').classList.toggle('hidden', !stale);
      if (stale) {
        $('alert').textContent = t('alert.hostGone');
      }
    }, 4000);
    noHostTimer = setTimeout(() => {
      if (!snapshot) {
        noHostShown = true;
        lobbyError(t('lobby.noHost'));
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
  $('add-bot').addEventListener('click', addBot);
  for (const id of ['set-atoms', 'set-mols']) {
    $(id).addEventListener('input', () => {
      if (!host || host.locked) return;
      // A deal that was refused is no longer the deal on the screen.
      $('lobby-note').classList.remove('error');
      const { deal } = readDeal(host.order.length);
      if (deal) {
        host.deal = deal;
        publishState();
      }
    });
  }
  $('host-controls').classList.toggle('hidden', !isHost);

  show('lobby');
  $('lobby-note').textContent = t('lobby.connecting');
  render();
}

function copyLink() {
  const done = () => {
    $('copy').textContent = t('lobby.copied');
    setTimeout(() => ($('copy').textContent = t('lobby.copy')), 1500);
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
    if (noHostTimer) {
      clearTimeout(noHostTimer);
      noHostTimer = null;
    }
    // A slow phone can be told there is no host and then hear from him all
    // the same. The word stands only as long as it is true.
    let repaint = false;
    if (noHostShown) {
      noHostShown = false;
      $('lobby-note').classList.remove('error');
      repaint = true;
    }
    // Every broker the two share carries the same snapshot. A copy that is
    // not newer than the one on the screen is one copy too many — unless it
    // comes from another host, whose count starts afresh.
    if (snapshot && msg.epoch === snapshot.epoch && msg.rev <= snapshot.rev) {
      if (repaint) render();
      return;
    }
    snapshot = msg;
    for (const [seq, resolve] of awaitingMove) {
      awaitingMove.delete(seq);
      resolve(null);
    }
    render();
  } else if (sub === `p/${me.id}`) {
    if (msg.t === 'hand') {
      const sig = JSON.stringify(msg);
      if (sig === lastHandSig) return;
      lastHandSig = sig;
      myCards = msg;
      render();
    } else if (msg.t === 'rejected') {
      const said = refusal(msg);
      const resolve = awaitingMove.get(msg.seq);
      if (resolve) {
        awaitingMove.delete(msg.seq);
        resolve(said);
      }
      showReject(said);
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
    return { id, name: p.name, online: p.bot || now - p.last < OFFLINE_MS, bot: !!p.bot };
  };
  if (!host.locked) {
    return {
      phase: 'lobby', host: me.id, epoch: host.epoch,
      order: host.order.map(row), deal: host.deal,
    };
  }
  // Everything the rules make public travels, minus what the seats already
  // carry, so a new field never has to be listed here twice.
  const { seats, turn, ...game } = publicView(host.game);
  const counts = Object.fromEntries(seats.map((s) => [s.id, s]));
  return {
    phase: 'game',
    host: me.id,
    epoch: host.epoch,
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
  if (!host || !host.game) return;
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
    // The same move arrives on every broker the two share. Its mark is what
    // tells a second copy from a second move.
    if (msg.mid) {
      if (host.done.has(msg.mid)) return;
      host.done.add(msg.mid);
      if (host.done.size > 400) host.done.delete(host.done.values().next().value);
    }
    const r = apply(host.game, msg.id, msg.move || {});
    if (!r.ok) {
      bus.toPlayer(msg.id, { t: 'rejected', seq: msg.seq, error: r.error, z: r.z, el: r.el }, false);
      return;
    }
    sendHands();
    publishState(true);
    stirBots();
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
            ? t('lobby.tooManyAtoms', { deck: DECK_SIZE.atoms, max: Math.floor(DECK_SIZE.atoms / seats) })
            : t('lobby.tooManyMols', { deck: DECK_SIZE.molecules, max: Math.floor(DECK_SIZE.molecules / seats) }),
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

/* ---------- the robots ---------- */

// A robot is a seat like any other, except that the host moves for it. It is
// never waited for and never counted as gone.
const BOT_PAUSE = [1000, 2000];
let botTimer = null;

const botNames = () => (lang() === 'en' ? BOT_NAMES_EN : BOT_NAMES);

function addBot() {
  if (!host || host.locked) return;
  const taken = new Set([...host.players.values()].map((p) => p.name));
  const name = botNames().find((n) => !taken.has(n)) ||
    `${botNames()[0]} ${host.bots.size + 1}`;
  const id = `bot_${Math.random().toString(36).slice(2, 9)}`;
  host.bots.set(id, name);
  host.players.set(id, { id, name, last: Date.now(), bot: true });
  host.order.push(id);
  publishState();
}

function dropBot(id) {
  if (!host || host.locked || !host.bots.has(id)) return;
  host.bots.delete(id);
  host.players.delete(id);
  host.order = host.order.filter((x) => x !== id);
  publishState();
}

function nameBot(id, name) {
  if (!host || host.locked || !host.bots.has(id)) return;
  const given = String(name || '').slice(0, 16);
  host.bots.set(id, given);
  host.players.get(id).name = given || botNames()[0];
  publishState();
}

// After every turn the host looks at whose move it is, and if it is a robot's
// he makes it, a second or two later so that it can be watched.
function stirBots() {
  if (!host || !host.game || host.game.winner || botTimer) return;
  const g = host.game;
  const who = g.phase === 'takeback' ? g.takeback.pending[0] : g.seats[g.turn];
  if (!host.bots.has(who)) return;
  const wait = BOT_PAUSE[0] + Math.random() * (BOT_PAUSE[1] - BOT_PAUSE[0]);
  botTimer = setTimeout(() => {
    botTimer = null;
    playBot(who);
  }, wait);
}

function playBot(id) {
  if (!host || !host.game || !host.bots.has(id)) return;
  const g = host.game;
  const move = botMove(publicView(g), privateView(g, id));
  if (!move) return;
  const r = apply(g, id, move);
  if (!r.ok) {
    // It asked for something the rules refuse; let it pass rather than stall.
    apply(g, id, g.phase === 'takeback' ? { t: 'takeBack', card: null } : { t: 'pass' });
  }
  sendHands();
  publishState(true);
  stirBots();
}

function startGame() {
  if (!host || host.locked) return;
  if (host.order.length < 2) {
    lobbyError(t('lobby.needTwo'));
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
  stirBots();
}

// A player who has dropped off must not hold the whole table up at the one
// point where the game waits for everybody: declining is the neutral answer.
function answerForTheAbsent() {
  const g = host.game;
  if (!g || g.phase !== 'takeback') return;
  const now = Date.now();
  for (const id of [...g.takeback.pending]) {
    const p = host.players.get(id);
    if (p && !p.bot && now - p.last > OFFLINE_MS) apply(g, id, { t: 'takeBack', card: null });
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
  stirBots();
}

// Sends a move and resolves with null when it went through, or with the
// reason it did not.
function sendMove(move) {
  const seq = ++moveSeq;
  const msg = { t: 'move', id: me.id, seq, mid: `${TAB}-${seq}`, move };
  const answer = new Promise((resolve) => {
    awaitingMove.set(seq, resolve);
    // A connection that went to sleep while the page was away takes a moment
    // to notice, and a move sent into it is lost without a word. It is said
    // again, twice; the host counts a move by its mark, so a second copy of
    // one he already made is dropped.
    const again = [1800, 4200].map((wait) =>
      setTimeout(() => {
        if (!host && awaitingMove.has(seq)) bus.act(msg);
      }, wait)
    );
    setTimeout(() => {
      for (const timer of again) clearTimeout(timer);
      if (awaitingMove.delete(seq)) resolve(t('move.noAnswer'));
    }, 9000);
  });
  if (host) onAct(msg);
  else bus.act(msg);
  return answer;
}

// The engine refuses in codes; this says it in the player's own language.
function refusal(msg) {
  const parts = { z: msg.z, min: ALKANE_MIN, max: ALKANE_MAX };
  if (msg.el) parts.el = nameIn(ELEMENTS[msg.el], lang());
  return t(`err.${msg.error}`, parts);
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

const PROMPT = (phase) => t(`prompt.${phase}`);

function nameOf(id) {
  const row = (snapshot?.order || []).find((p) => p.id === id);
  return row ? row.name : t('game.somebody');
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

function stepPrompt() {
  if (!chosen.mode) return null;
  if (fusionChosen()) return t('step.fusing');
  const step = currentStep();
  if (step === 'molecule') return t(chosen.mode === 'swap' ? 'step.moleculeSwap' : 'step.moleculeOpen');
  if (step === 'table') return t('step.table');
  if (chosen.mode === 'place') return t('step.place');
  return t(isAlkane(chosenMoleculeId()) ? 'step.alkane' : 'step.withMolecule');
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
  cardButton({
    src: cardArt.atom(el, lang()),
    alt: nameIn(el === FUSION ? FUSION_CARD : ELEMENTS[el], lang()),
    ...opts,
  });

const moleculeCard = (id, opts = {}) =>
  cardButton({ src: cardArt.molecule(id, lang()), alt: nameIn(MOLECULES[id], lang()), ...opts });

function button(label, act, onClick, enabled = true, cls = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.dataset.act = act;
  if (cls) b.className = cls;
  b.disabled = !enabled;
  if (enabled) b.addEventListener('click', onClick);
  return b;
}

// A fusion is under way as soon as the fusion card itself is picked up.
function fusionChosen() {
  return (myCards?.atoms || []).some((c) => c.el === FUSION && chosen.atoms.has(c.id));
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
  // A row in the host's hand holds the seat list still, and nothing else: a
  // drag that was never let go of must not freeze the game screen with it.
  if (dragging && snapshot.phase === 'lobby') return;
  if (snapshot.phase === 'lobby') {
    show('lobby');
    renderLobby();
  } else {
    show('game');
    renderGame();
  }
}

// The host can take a seat by its handle and put it where he wants it. While
// that is going on the list is left alone, or the snapshot that arrives every
// other second would pull the row out of his hand.
let dragging = null;

// A window that loses the pointer — the tab is left, the screen is turned off
// — never sends the pointerup, so the drag is ended here as well.
function endDrag() {
  if (dragging) dragging();
}
window.addEventListener('blur', endDrag);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) endDrag();
});

function dragSeat(event, li) {
  if (!host || host.locked) return;
  event.preventDefault();
  const list = $('roster');
  li.classList.add('dragging');
  // The pointer is followed on the window: taking the row out of the list and
  // putting it back lets go of anything captured on the row itself.
  const over = (e) => {
    const others = [...list.children].filter((x) => x !== li);
    const before = others.find((x) => {
      const box = x.getBoundingClientRect();
      return e.clientY < box.top + box.height / 2;
    });
    list.insertBefore(li, before || null);
  };
  const done = () => {
    if (!dragging) return;
    dragging = null;
    window.removeEventListener('pointermove', over);
    window.removeEventListener('pointerup', done);
    window.removeEventListener('pointercancel', done);
    li.classList.remove('dragging');
    seatsAre([...list.children].map((x) => x.dataset.id));
  };
  dragging = done;
  window.addEventListener('pointermove', over);
  window.addEventListener('pointerup', done);
  window.addEventListener('pointercancel', done);
}

// The order the rows are in is the order of play.
function seatsAre(ids) {
  if (!host || host.locked ||
      ids.length !== host.order.length ||
      ids.some((id) => !host.players.has(id))) {
    render();
    return;
  }
  host.order = ids;
  // The list is left as the host put it: it is drawn again when his own
  // snapshot comes back, and drawing it now would only flicker back.
  publishState();
}

function renderLobby() {
  const list = $('roster');
  list.textContent = '';
  snapshot.order.forEach((p, i) => {
    const li = document.createElement('li');
    li.dataset.id = p.id;

    const seat = document.createElement('span');
    seat.className = 'seat';
    seat.textContent = `${i + 1}.`;

    let who;
    if (p.bot && isHost) {
      who = document.createElement('input');
      who.className = 'who botname';
      who.value = p.name;
      who.maxLength = 16;
      who.setAttribute('aria-label', t('lobby.botName'));
      who.addEventListener('input', () => nameBot(p.id, who.value));
      who.addEventListener('pointerdown', (e) => e.stopPropagation());
    } else {
      who = document.createElement('span');
      who.className = 'who' + (p.bot ? ' bot' : '');
      who.textContent = p.name;
    }

    li.append(seat, who);

    if (p.id === snapshot.host) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = t('seat.host');
      li.append(tag);
    }
    if (p.id === me.id) {
      const tag = document.createElement('span');
      tag.className = 'tag me';
      tag.textContent = t('seat.you');
      li.append(tag);
    }
    if (!p.online) {
      const tag = document.createElement('span');
      tag.className = 'tag off';
      tag.textContent = t('seat.offline');
      li.append(tag);
    }

    if (isHost) {
      const grip = document.createElement('button');
      grip.className = 'grip';
      grip.type = 'button';
      grip.textContent = '⠿';
      grip.title = t('lobby.drag');
      grip.setAttribute('aria-label', t('lobby.drag'));
      grip.addEventListener('pointerdown', (e) => dragSeat(e, li));
      li.prepend(grip);

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

      if (p.bot) {
        const away = document.createElement('button');
        away.className = 'move drop';
        away.type = 'button';
        away.textContent = '\u2715';
        away.title = t('lobby.dropBot');
        away.addEventListener('click', () => dropBot(p.id));
        li.append(away);
      }
    }

    list.append(li);
  });

  $('start').disabled = snapshot.order.length < 2;
  const d = snapshot.deal || DEFAULT_DEAL;
  $('deal-note').textContent = t('lobby.deal', { atoms: d.atoms, molecules: d.molecules });
  if (!$('lobby-note').classList.contains('error')) {
    $('lobby-note').textContent = isHost
      ? t('lobby.hostWaiting')
      : t('lobby.guestWaiting');
  }
}

function renderGame() {
  const inGame = snapshot.order.some((p) => p.id === me.id);
  const g = snapshot.game || {};
  const waiting = g.phase === 'takeback' ? g.takeback.pending : [snapshot.turn];
  const myMove = inGame && !g.winner && waiting.includes(me.id);

  // The move a turn is for is already under way, so a card can simply be
  // clicked: an atom while a molecule is being built, and a molecule at the
  // start of the game and after one was completed.
  if (!myMove) clearChoice();
  else if (!chosen.mode && g.phase === 'building') chosen.mode = 'place';
  else if (!chosen.mode && g.phase === 'opening') chosen.mode = 'open';

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
    banner.textContent = t('game.spectator');
  } else if (g.winner) {
    banner.textContent =
      g.winner === me.id ? t('game.youWon') : t('game.someoneWon', { name: nameOf(g.winner) });
    banner.classList.add('over');
  } else if (waiting.includes(me.id)) {
    banner.textContent = stepPrompt() || PROMPT(g.phase);
    banner.classList.add('mine');
  } else {
    banner.textContent = t('game.waitingFor', { name: nameOf(waiting[0]) });
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
    who.className = 'who' + (p.bot ? ' bot' : '');
    who.textContent = p.name + (p.id === me.id ? ` (${t('seat.you')})` : '');

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${p.atoms} · ${p.molecules}`;
    count.title = t('seat.counts');

    li.append(seat, who, count);
    players.append(li);
  });
}

// How the table is laid out: the shape the card draws, or a pile for each
// element of the formula. A phone has no room for the shape, and glucose has
// too many atoms for it on any screen, so those open on the piles; everywhere
// else the shape is what a player sees first. A choice of his own holds for as
// long as that molecule is on the table.
let tableView = null;
let viewFor = null;

const onPhone = () => window.matchMedia('(max-width: 640px)').matches;

function defaultView(molecule) {
  return onPhone() || molecule === 'glucose' ? 'formula' : 'shape';
}

function viewOf(g) {
  const molecule = g.area.molecule;
  if (!molecule) return 'shape';
  return tableView && viewFor === molecule ? tableView : defaultView(molecule);
}

function chooseView(view) {
  tableView = view;
  viewFor = snapshot?.game?.area?.molecule || null;
  render();
}

const canTakeBack = (u) => (u.by === me.id && u.cards.length === 1 ? 1 : 0);

// A pile for each element the molecule asks for, with how many of them are
// down and how many are wanted written above it.
function renderFormula(g, grid, takingBack) {
  const formula = formulaOf(g.area.molecule, g.area.alkaneN) || {};
  grid.className = 'units-formula';
  const mine = new Map();
  for (const u of g.area.units) {
    if (!mine.has(u.el)) mine.set(u.el, []);
    mine.get(u.el).push(u);
  }
  for (const [el, wanted] of Object.entries(formula)) {
    const down = mine.get(el) || [];
    mine.delete(el);
    const pile = document.createElement('div');
    pile.className = 'el-pile' + (down.length >= wanted ? ' full' : '');

    const head = document.createElement('span');
    head.className = 'el-head';
    head.dir = 'ltr';
    head.textContent = `${el} ${down.length}/${wanted}`;
    head.title = nameIn(ELEMENTS[el], lang());

    const stack = document.createElement('div');
    stack.className = 'el-stack';
    if (down.length) {
      // The cards of a pile are the same card, so which of them is on top
      // matters only when one may be taken back: then the player's own card
      // goes up, since a card with another one lying on it cannot be clicked
      // and a fusion is never taken back anyway.
      const order = takingBack
        ? [...down].sort((a, b) => canTakeBack(a) - canTakeBack(b))
        : down;
      const top = order[order.length - 1];
      for (const u of order) stack.append(unitEl(u, takingBack && u === top));
    } else {
      stack.append(emptySlotEl(el));
    }
    pile.append(head, stack);
    grid.append(pile);
  }
  // Anything on the table the formula did not ask for still has to be seen.
  for (const left of mine.values()) {
    for (const u of left) grid.append(unitEl(u, takingBack));
  }
}

function renderTable(g, myMove) {
  const slot = $('table-mol');
  slot.textContent = '';
  if (g.area.molecule) {
    slot.append(
      moleculeCard(g.area.molecule, {
        badge: g.area.alkaneN ? alkaneLabel(g.area.alkaneN) : null,
        title: nameIn(MOLECULES[g.area.molecule], lang()),
      })
    );
  } else {
    const e = document.createElement('span');
    e.className = 'empty';
    e.textContent = t('game.noMolecule');
    slot.append(e);
  }

  const takingBack = myMove && g.phase === 'takeback' && currentStep() === 'table';
  const grid = $('table-units');
  grid.textContent = '';

  const views = $('table-views');
  views.classList.toggle('hidden', !g.area.molecule);
  const view = viewOf(g);
  for (const b of views.querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.view === view);
  }
  if (g.area.molecule && view === 'formula') {
    renderFormula(g, grid, takingBack);
    return;
  }

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
// what the fusion came to is written above it. It is never opened out, since
// it is one atom as far as the game is concerned.
function unitEl(u, takingBack) {
  const fused = u.cards.length > 1;
  // A fusion is laid as one atom and is never taken apart, so only an atom
  // lying on its own can be clicked back into its owner's hand.
  const mineNow = takingBack && u.by === me.id && !fused;
  const wrap = document.createElement('div');
  wrap.className = 'unit' + (fused ? ' fused' : '');

  const cardFor = (c) => {
    const mine = mineNow && c.el !== FUSION;
    return atomCard(c.el, {
      id: c.id,
      pickable: mine,
      title: mine ? t('game.takeBack') : nameOf(u.by),
      onClick: () => act({ t: 'takeBack', card: c.id }),
    });
  };

  if (!fused) {
    wrap.append(cardFor(u.cards[0]));
    return wrap;
  }

  const label = document.createElement('span');
  label.className = 'sum';
  label.textContent = `${nameIn(ELEMENTS[u.el], lang())} ${ELEMENTS[u.el].z}`;
  wrap.append(label);

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
  d.title = t('game.missing', { el: nameIn(ELEMENTS[el], lang()) });
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
    blank.textContent = t('deck.empty');
    d.append(blank);
  }
  const caption = document.createElement('span');
  caption.className = 'pile-label';
  caption.textContent = `${label}: ${count}`;
  d.append(caption);
  return d;
}

function renderDecks(g) {
  const decks = $('decks');
  decks.textContent = '';
  decks.append(
    pile(cardArt.atomBack(lang()), t('deck.atoms'), g.atomDeck),
    pile(g.atomDiscardTop ? cardArt.atom(g.atomDiscardTop, lang()) : null, t('deck.atomsUsed'), g.atomDiscard),
    pile(cardArt.moleculeBack(lang()), t('deck.molecules'), g.molDeck),
    pile(g.molDiscardTop ? cardArt.molecule(g.molDiscardTop, lang()) : null, t('deck.moleculesUsed'), g.molDiscard)
  );
}

function renderHand(g, myMove) {
  const step = myMove ? currentStep() : null;
  // The molecules stay live through the whole move, so a choice can be
  // changed or dropped without starting over.
  const molTurn = !!step && (chosen.mode === 'open' || chosen.mode === 'swap');
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
        title: nameIn(MOLECULES[c.mol], lang()),
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
        onClick: () => pickAtom(c),
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

// The move the current choice adds up to.
function moveFor(atomIds) {
  const molId = chosenMoleculeId();
  const alkaneN = isAlkane(molId) ? chosen.alkaneN : undefined;
  if (chosen.mode === 'open') {
    return { t: 'startMolecule', molecule: chosen.molecule, cards: atomIds, alkaneN };
  }
  if (chosen.mode === 'swap') {
    return { t: 'swapMolecule', molecule: chosen.molecule, cards: atomIds, alkaneN };
  }
  return { t: 'placeUnit', cards: atomIds };
}

// The atom is the last card any of these moves needs, so clicking it finishes
// the move. Only the fusion card opens a group that has to be confirmed.
function pickAtom(c) {
  const ready = chosen.mode === 'place' || !!chosen.molecule;
  if (ready && !fusionChosen() && c.el !== FUSION) {
    const move = moveFor([c.id]);
    chosen.atoms.clear();
    act(move);
    return;
  }
  if (chosen.atoms.has(c.id)) chosen.atoms.delete(c.id);
  else chosen.atoms.add(c.id);
  render();
}

function renderActions(g, myMove) {
  const bar = $('actions');

  if (g.winner) {
    // Leave the fields alone once they are up, so typing in them survives.
    if (!isHost || $('again-atoms')) return;
    bar.textContent = '';
    bar.append(
      numberField('again-atoms', t('lobby.atomsPer'), snapshot.deal.atoms, 24),
      numberField('again-mols', t('lobby.molsPer'), snapshot.deal.molecules, 8),
      button(t('act.again'), 'again', startAgain)
    );
    return;
  }

  bar.textContent = '';
  if (!myMove || g.phase === 'picking') return;

  if (g.phase === 'opening') {
    // Opening a molecule is the move under way, but the two ways of drawing
    // stay on the bar until a molecule is actually chosen.
    if (chosen.mode === 'open' && chosen.molecule) {
      renderModeBar(bar);
      return;
    }
    bar.append(
      button(t('act.open'), 'open', () => setMode('open'), true,
        chosen.mode === 'open' ? 'active' : ''),
      button(t('act.fiveMolecules'), 'fiveMolecules', () => act({ t: 'drawFive', kind: 'molecules' })),
      button(t('act.fiveAtoms'), 'fiveAtoms', () => act({ t: 'drawFive', kind: 'atoms' }))
    );
    return;
  }

  if (g.phase === 'building') {
    if (chosen.mode === 'swap' || fusionChosen()) {
      renderModeBar(bar);
      return;
    }
    bar.append(
      button(t('act.place'), 'place', () => render(), true, 'active'),
      button(t('act.swap'), 'swap', () => setMode('swap'))
    );
    if (g.atomDeck || g.atomDiscard) {
      bar.append(button(t('act.draw'), 'draw', () => act({ t: 'drawAtom' })));
    } else {
      bar.append(button(t('act.pass'), 'pass', () => act({ t: 'pass' })));
    }
    return;
  }

  if (g.phase === 'takeback') {
    bar.append(
      button(t('act.takeOne'), 'takeOne', () => setMode('takeOne')),
      button(t('act.takeNothing'), 'takeNothing', () => act({ t: 'takeBack', card: null }))
    );
  }
}

// While a move is under way the bar holds what that move still needs: the
// carbon count of an alkane, a confirm for a fusion group, and a way out.
function renderModeBar(bar) {
  const atoms = [...chosen.atoms];
  const molId = chosenMoleculeId();

  if (isAlkane(molId)) {
    const field = document.createElement('label');
    field.className = 'num';
    field.textContent = t('field.carbons');
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
  if (fusionChosen()) {
    bar.append(
      button(t('act.confirm'), 'confirm', () => act(moveFor(atoms)), atoms.length > 1)
    );
  }

  bar.append(button(t('act.cancel'), 'cancel', () => {
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
      ? t('overlay.pickAtom')
      : t('overlay.pickMolecule');
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
  links: () => Object.fromEntries(links),
  me: () => ({ ...me }),
};

// The pages beside the game keep the room and the language.
function updateDocLinks() {
  const here = lang();
  for (const a of document.querySelectorAll('a[href^="rules"]')) {
    a.href = (here === 'en' ? 'rules.en.html' : 'rules.html') + location.hash;
  }
  for (const a of document.querySelectorAll('a[href^="facts"]')) {
    a.href = here === 'en' ? 'facts.en.pdf' : 'facts.pdf';
  }
}

function markFlags() {
  for (const b of document.querySelectorAll('.flag')) {
    b.classList.toggle('active', b.dataset.lang === lang());
  }
}

function initLanguage() {
  applyStaticWords();
  updateDocLinks();
  markFlags();
  for (const b of document.querySelectorAll('.flag')) {
    b.addEventListener('click', () => setLang(b.dataset.lang));
  }
  // A switch in the middle of a game repaints the page and leaves the game
  // where it was: the room, the hand and the host's bookkeeping all stay.
  onLang(() => {
    markFlags();
    updateDocLinks();
    paintEntryWords();
    if (noHostShown) lobbyError(t('lobby.noHost'));
    else if (!snapshot) $('lobby-note').textContent = t('lobby.connecting');
    setStatus($('status').dataset.state || 'wait');
    $('share').value = shareLink();
    render();
  });
}

initLanguage();
initEntry();
