// The rules of the game. No network, no DOM, no clock: a state and the moves
// that may be applied to it. Every move returns {ok:true} or {ok:false,error}.

import {
  ELEMENTS,
  FUSION,
  ATOM_COUNTS,
  Z_TO_ELEMENT,
  MOLECULES,
  MOLECULE_COUNTS,
  alkaneFormula,
  ALKANE_MIN,
  ALKANE_MAX,
} from './cards.js';

/* ---------- randomness ---------- */

// Seeded, so a test can replay an entire game.
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ---------- decks ---------- */

export function buildAtomDeck() {
  const deck = [];
  let n = 0;
  for (const [el, count] of Object.entries(ATOM_COUNTS)) {
    for (let i = 0; i < count; i++) deck.push({ id: `a${++n}`, el });
  }
  return deck;
}

export function buildMoleculeDeck() {
  const deck = [];
  let n = 0;
  for (const [mol, count] of Object.entries(MOLECULE_COUNTS)) {
    for (let i = 0; i < count; i++) deck.push({ id: `m${++n}`, mol });
  }
  return deck;
}

/* ---------- compositions ---------- */

// What one placement is worth. A fusion card plus regular atoms counts as the
// single atom whose atomic number is their sum.
export function unitElement(cards) {
  if (!cards.length) return { error: 'לא נבחרו קלפים' };
  const fusions = cards.filter((c) => c.el === FUSION);
  if (fusions.length > 1) return { error: 'אפשר להניח רק קלף היתוך אחד בכל יחידה' };
  if (!fusions.length) {
    if (cards.length > 1) return { error: 'אפשר להניח רק קלף אטום אחד בכל פעם' };
    return { el: cards[0].el };
  }
  const rest = cards.filter((c) => c.el !== FUSION);
  if (!rest.length) return { error: 'קלף היתוך מונח יחד עם קלף אטום אחד לפחות' };
  const z = rest.reduce((sum, c) => sum + ELEMENTS[c.el].z, 0);
  const el = Z_TO_ELEMENT[z];
  if (!el) return { error: `סכום המספרים האטומיים הוא ${z}, ואין במשחק אטום כזה` };
  return { el };
}

export function composition(units) {
  const comp = {};
  for (const u of units) comp[u.el] = (comp[u.el] || 0) + 1;
  return comp;
}

export function formulaOf(moleculeId, alkaneN) {
  const mol = MOLECULES[moleculeId];
  if (!mol) return null;
  if (mol.special === 'alkanes') {
    if (!Number.isInteger(alkaneN) || alkaneN < ALKANE_MIN || alkaneN > ALKANE_MAX) return null;
    return alkaneFormula(alkaneN);
  }
  return mol.formula;
}

export function isPartOf(comp, formula) {
  for (const [el, n] of Object.entries(comp)) {
    if (!formula[el] || n > formula[el]) return false;
  }
  return true;
}

export function isComplete(comp, formula) {
  for (const [el, n] of Object.entries(formula)) {
    if ((comp[el] || 0) !== n) return false;
  }
  return isPartOf(comp, formula);
}

/* ---------- the game ---------- */

export function newGame({ seats, deal = { atoms: 12, molecules: 3 }, seed = 1 }) {
  const rng = makeRng(seed);
  const atomDeck = shuffle(buildAtomDeck(), rng);
  const molDeck = shuffle(buildMoleculeDeck(), rng);
  const hands = {};
  for (const id of seats) {
    hands[id] = {
      atoms: atomDeck.splice(0, deal.atoms),
      molecules: molDeck.splice(0, deal.molecules),
    };
  }
  return {
    seats: [...seats],
    deal: { ...deal },
    hands,
    atomDeck,
    atomDiscard: [],
    molDeck,
    molDiscard: [],
    area: { molecule: null, alkaneN: null, units: [] },
    turn: 0,
    phase: 'opening',
    pick: null,
    takeback: null,
    passes: 0,
    lastPlacer: null,
    winner: null,
    seed,
  };
}

const currentPlayer = (s) => s.seats[s.turn];
const nextTurn = (s) => {
  s.turn = (s.turn + 1) % s.seats.length;
};
const fail = (error) => ({ ok: false, error });

export function areaFormula(state) {
  return state.area.molecule ? formulaOf(state.area.molecule.mol, state.area.alkaneN) : null;
}

function takeFromDeck(state, kind) {
  const deck = kind === 'atoms' ? 'atomDeck' : 'molDeck';
  const discard = kind === 'atoms' ? 'atomDiscard' : 'molDiscard';
  if (!state[deck].length) {
    if (!state[discard].length) return null;
    state[deck] = shuffle(state[discard], makeRng(state.seed + state.atomDiscard.length + state.turn));
    state[discard] = [];
  }
  return state[deck].shift();
}

// Pulls the named cards out of a hand, or says which one is not there.
function takeCards(hand, ids) {
  const picked = [];
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) return { error: 'אותו קלף נבחר פעמיים' };
    seen.add(id);
    const card = hand.find((c) => c.id === id);
    if (!card) return { error: 'הקלף אינו בידך' };
    picked.push(card);
  }
  return { picked };
}

function removeCards(hand, cards) {
  for (const c of cards) hand.splice(hand.indexOf(c), 1);
}

// Everything that has to happen after cards left a player's hand onto the area.
function afterPlacement(state, playerId) {
  state.lastPlacer = playerId;
  state.passes = 0;

  // Note 1 of the rules: running out of atom cards wins there and then.
  if (!state.hands[playerId].atoms.length) {
    state.winner = playerId;
    state.phase = 'over';
    return { ok: true };
  }

  const formula = areaFormula(state);
  if (formula && isComplete(composition(state.area.units), formula)) {
    const contributors = state.seats.filter((id) =>
      state.area.units.some((u) => u.by === id && u.cards.some((c) => c.el !== FUSION))
    );
    state.phase = 'takeback';
    state.takeback = { finisher: playerId, pending: contributors };
    if (!contributors.length) finishTakeback(state);
    return { ok: true };
  }

  nextTurn(state);
  return { ok: true };
}

function finishTakeback(state) {
  const finisher = state.takeback.finisher;
  for (const u of state.area.units) state.atomDiscard.push(...u.cards);
  state.molDiscard.push(state.area.molecule);
  state.area = { molecule: null, alkaneN: null, units: [] };
  state.takeback = null;
  state.turn = state.seats.indexOf(finisher);
  state.phase = 'opening';
}

function placeUnitInto(state, playerId, cards, formula) {
  const unit = unitElement(cards);
  if (unit.error) return fail(unit.error);
  const next = composition([...state.area.units, { el: unit.el }]);
  if (!isPartOf(next, formula)) {
    return fail(`${ELEMENTS[unit.el].name} אינו משתלב במולקולה שעל השולחן`);
  }
  removeCards(state.hands[playerId].atoms, cards);
  state.area.units.push({ by: playerId, el: unit.el, cards });
  return { ok: true };
}

/* ---------- moves ---------- */

export function apply(state, playerId, move) {
  if (state.phase === 'over') return fail('המשחק נגמר');

  if (state.phase === 'takeback') {
    if (move.t !== 'takeBack') return fail('ממתינים להחזרת קלפים');
    return applyTakeBack(state, playerId, move);
  }

  if (playerId !== currentPlayer(state)) return fail('לא תורך');

  switch (move.t) {
    case 'startMolecule':
      return applyStartMolecule(state, playerId, move);
    case 'drawFive':
      return applyDrawFive(state, playerId, move);
    case 'pick':
      return applyPick(state, playerId, move);
    case 'placeUnit':
      return applyPlaceUnit(state, playerId, move);
    case 'swapMolecule':
      return applySwapMolecule(state, playerId, move);
    case 'drawAtom':
      return applyDrawAtom(state, playerId);
    case 'pass':
      return applyPass(state, playerId);
    default:
      return fail('מהלך לא מוכר');
  }
}

function applyStartMolecule(state, playerId, move) {
  if (state.phase !== 'opening') return fail('אי אפשר לפתוח מולקולה עכשיו');
  const hand = state.hands[playerId];
  const card = hand.molecules.find((c) => c.id === move.molecule);
  if (!card) return fail('קלף המולקולה אינו בידך');
  const formula = formulaOf(card.mol, move.alkaneN);
  if (!formula) {
    return fail(`צריך להכריז על מספר אטומי פחמן בין ${ALKANE_MIN} ל ${ALKANE_MAX}`);
  }
  const taken = takeCards(hand.atoms, move.cards || []);
  if (taken.error) return fail(taken.error);

  state.area = { molecule: card, alkaneN: move.alkaneN ?? null, units: [] };
  const placed = placeUnitInto(state, playerId, taken.picked, formula);
  if (!placed.ok) {
    state.area = { molecule: null, alkaneN: null, units: [] };
    return placed;
  }
  hand.molecules.splice(hand.molecules.indexOf(card), 1);
  state.phase = 'building';
  return afterPlacement(state, playerId);
}

function applyDrawFive(state, playerId, move) {
  if (state.phase !== 'opening') return fail('אפשר למשוך חמישה רק בתחילת מולקולה');
  const kind = move.kind === 'molecules' ? 'molecules' : 'atoms';
  const drawn = [];
  for (let i = 0; i < 5; i++) {
    const card = takeFromDeck(state, kind);
    if (!card) break;
    drawn.push(card);
  }
  if (!drawn.length) return fail('הקופה והערמה ריקות');
  state.pick = { kind, cards: drawn };
  state.phase = 'picking';
  return { ok: true };
}

function applyPick(state, playerId, move) {
  if (state.phase !== 'picking') return fail('אין מה לבחור');
  const { kind, cards } = state.pick;
  const card = cards.find((c) => c.id === move.card);
  if (!card) return fail('הקלף אינו בין החמישה');
  const hand = state.hands[playerId];
  (kind === 'atoms' ? hand.atoms : hand.molecules).push(card);
  const rest = cards.filter((c) => c !== card);
  (kind === 'atoms' ? state.atomDiscard : state.molDiscard).push(...rest);
  state.pick = null;
  state.phase = 'opening';
  nextTurn(state);
  return { ok: true };
}

function applyPlaceUnit(state, playerId, move) {
  if (state.phase !== 'building') return fail('אין מולקולה על השולחן');
  const taken = takeCards(state.hands[playerId].atoms, move.cards || []);
  if (taken.error) return fail(taken.error);
  const placed = placeUnitInto(state, playerId, taken.picked, areaFormula(state));
  if (!placed.ok) return placed;
  return afterPlacement(state, playerId);
}

function applySwapMolecule(state, playerId, move) {
  if (state.phase !== 'building') return fail('אין מולקולה להחליף');
  const hand = state.hands[playerId];
  const card = hand.molecules.find((c) => c.id === move.molecule);
  if (!card) return fail('קלף המולקולה אינו בידך');
  const formula = formulaOf(card.mol, move.alkaneN);
  if (!formula) {
    return fail(`צריך להכריז על מספר אטומי פחמן בין ${ALKANE_MIN} ל ${ALKANE_MAX}`);
  }
  const taken = takeCards(hand.atoms, move.cards || []);
  if (taken.error) return fail(taken.error);

  const unit = unitElement(taken.picked);
  if (unit.error) return fail(unit.error);
  const next = composition([...state.area.units, { el: unit.el }]);
  if (!isPartOf(next, formula)) {
    return fail('האטומים שכבר על השולחן אינם משתלבים במולקולה החדשה');
  }

  state.molDiscard.push(state.area.molecule);
  state.area.molecule = card;
  state.area.alkaneN = move.alkaneN ?? null;
  hand.molecules.splice(hand.molecules.indexOf(card), 1);
  removeCards(hand.atoms, taken.picked);
  state.area.units.push({ by: playerId, el: unit.el, cards: taken.picked });
  return afterPlacement(state, playerId);
}

function applyDrawAtom(state, playerId) {
  if (state.phase !== 'building') return fail('אי אפשר למשוך עכשיו');
  const card = takeFromDeck(state, 'atoms');
  if (!card) return fail('קופת האטומים והערמה ריקות');
  state.hands[playerId].atoms.push(card);
  nextTurn(state);
  return { ok: true };
}

function applyPass(state, playerId) {
  if (state.phase !== 'building') return fail('אי אפשר לוותר על התור עכשיו');
  if (state.atomDeck.length || state.atomDiscard.length) {
    return fail('יש עדיין קלפי אטום, אפשר למשוך');
  }
  state.passes += 1;
  if (state.passes >= state.seats.length) {
    // Rule 4: a full round with nobody placing clears the area.
    for (const u of state.area.units) state.atomDiscard.push(...u.cards);
    state.molDiscard.push(state.area.molecule);
    state.area = { molecule: null, alkaneN: null, units: [] };
    state.passes = 0;
    state.turn = state.seats.indexOf(state.lastPlacer ?? playerId);
    state.phase = 'opening';
    return { ok: true };
  }
  nextTurn(state);
  return { ok: true };
}

function applyTakeBack(state, playerId, move) {
  const pending = state.takeback.pending;
  if (!pending.includes(playerId)) return fail('אינך בין מי שהניחו קלפים');
  if (move.card) {
    const unit = state.area.units.find(
      (u) => u.by === playerId && u.cards.some((c) => c.id === move.card)
    );
    if (!unit) return fail('הקלף אינו מהקלפים שהנחת');
    const card = unit.cards.find((c) => c.id === move.card);
    if (card.el === FUSION) return fail('אי אפשר לקחת בחזרה קלף היתוך גרעיני');
    unit.cards.splice(unit.cards.indexOf(card), 1);
    state.hands[playerId].atoms.push(card);
  }
  state.takeback.pending = pending.filter((id) => id !== playerId);
  if (!state.takeback.pending.length) finishTakeback(state);
  return { ok: true };
}

/* ---------- views ---------- */

const topOf = (pile) => (pile.length ? pile[pile.length - 1] : null);

// What everybody may see.
export function publicView(state) {
  return {
    seats: state.seats.map((id) => ({
      id,
      atoms: state.hands[id].atoms.length,
      molecules: state.hands[id].molecules.length,
    })),
    area: {
      molecule: state.area.molecule ? state.area.molecule.mol : null,
      alkaneN: state.area.alkaneN,
      units: state.area.units.map((u) => ({
        by: u.by,
        el: u.el,
        cards: u.cards.map((c) => ({ id: c.id, el: c.el })),
      })),
    },
    turn: state.seats[state.turn],
    phase: state.phase,
    pickKind: state.pick ? state.pick.kind : null,
    takeback: state.takeback ? { ...state.takeback } : null,
    atomDeck: state.atomDeck.length,
    atomDiscard: state.atomDiscard.length,
    atomDiscardTop: topOf(state.atomDiscard)?.el ?? null,
    molDeck: state.molDeck.length,
    molDiscard: state.molDiscard.length,
    molDiscardTop: topOf(state.molDiscard)?.mol ?? null,
    winner: state.winner,
  };
}

// What one player may see of his own.
export function privateView(state, playerId) {
  const hand = state.hands[playerId];
  if (!hand) return null;
  const mine = state.phase === 'picking' && state.seats[state.turn] === playerId;
  return {
    atoms: hand.atoms.map((c) => ({ id: c.id, el: c.el })),
    molecules: hand.molecules.map((c) => ({ id: c.id, mol: c.mol })),
    pick: mine && state.pick ? { kind: state.pick.kind, cards: state.pick.cards } : null,
  };
}
