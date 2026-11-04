import {
  ATOM_COUNTS,
  MOLECULE_COUNTS,
  DECK_SIZE,
  FUSION,
} from '../../js/cards.js';
import {
  newGame,
  apply,
  buildAtomDeck,
  buildMoleculeDeck,
  unitElement,
  composition,
  formulaOf,
  isPartOf,
  isComplete,
  publicView,
  privateView,
} from '../../js/rules.js';

let n = 0;
const atom = (el) => ({ id: `t${++n}`, el });
const mol = (m) => ({ id: `t${++n}`, mol: m });

// A table set up by hand, so a scenario does not depend on a shuffle.
function table({ seats = ['a', 'b'], hands, decks = {} }) {
  const s = newGame({ seats, deal: { atoms: 0, molecules: 0 }, seed: 7 });
  s.hands = hands;
  s.atomDeck = decks.atomDeck || [];
  s.atomDiscard = decks.atomDiscard || [];
  s.molDeck = decks.molDeck || [];
  s.molDiscard = decks.molDiscard || [];
  return s;
}

const hand = (atoms = [], molecules = []) => ({ atoms, molecules });

export default async function run({ check }) {
  /* ---------- the printed deck ---------- */

  const atoms = buildAtomDeck();
  check('the atom deck holds 72 cards', atoms.length === 72, atoms.length);
  for (const [el, count] of Object.entries(ATOM_COUNTS)) {
    const got = atoms.filter((c) => c.el === el).length;
    check(`the atom deck holds ${count} of ${el}`, got === count, got);
  }
  const mols = buildMoleculeDeck();
  check('the molecule deck holds 36 cards', mols.length === 36, mols.length);
  check('alkanes and glucose were printed once',
    MOLECULE_COUNTS.alkanes === 1 && MOLECULE_COUNTS.glucose === 1);
  check('every other molecule was printed twice',
    Object.entries(MOLECULE_COUNTS).every(([id, c]) => c === (id === 'alkanes' || id === 'glucose' ? 1 : 2)));
  check('card ids are unique', new Set([...atoms, ...mols].map((c) => c.id)).size === 108);
  check('the catalogue agrees with the printed counts',
    DECK_SIZE.atoms === 72 && DECK_SIZE.molecules === 36);

  /* ---------- being part of a molecule ---------- */

  const water = formulaOf('water');
  check('one hydrogen is part of water', isPartOf({ H: 1 }, water));
  check('two hydrogens are part of water', isPartOf({ H: 2 }, water));
  check('three hydrogens are not part of water', !isPartOf({ H: 3 }, water));
  check('carbon is not part of water', !isPartOf({ C: 1 }, water));
  check('two hydrogens are not a whole water', !isComplete({ H: 2 }, water));
  check('two hydrogens and an oxygen are water', isComplete({ H: 2, O: 1 }, water));
  check('an empty table is part of any molecule', isPartOf({}, water));

  /* ---------- alkanes ---------- */

  check('three carbons make propane', JSON.stringify(formulaOf('alkanes', 3)) === JSON.stringify({ C: 3, H: 8 }));
  check('an undeclared alkane has no formula', formulaOf('alkanes') === null);
  check('zero carbons is not an alkane', formulaOf('alkanes', 0) === null);
  check('nine carbons is past the table', formulaOf('alkanes', 9) === null);
  check('a declared alkane behaves exactly like the printed molecule',
    JSON.stringify(formulaOf('alkanes', 3)) === JSON.stringify(formulaOf('propane')));

  /* ---------- nuclear fusion ---------- */

  check('a lone atom card is itself', unitElement([atom('H')]).el === 'H');
  check('two atom cards are not one placement', !!unitElement([atom('H'), atom('H')]).error);
  check('a fusion card alone is not a placement', !!unitElement([atom(FUSION)]).error);
  check('fusion with one hydrogen is hydrogen', unitElement([atom(FUSION), atom('H')]).el === 'H');
  check('fusion with six hydrogens is carbon',
    unitElement([atom(FUSION), ...Array.from({ length: 6 }, () => atom('H'))]).el === 'C');
  check('fusion with carbon and hydrogen is nitrogen',
    unitElement([atom(FUSION), atom('C'), atom('H')]).el === 'N');
  check('fusion summing to 2 is no atom of this game',
    !!unitElement([atom(FUSION), atom('H'), atom('H')]).error);
  check('two fusion cards in one placement are refused',
    !!unitElement([atom(FUSION), atom(FUSION), atom('H')]).error);

  /* ---------- opening a molecule ---------- */

  {
    const h1 = atom('H'), w = mol('water');
    const s = table({ hands: { a: hand([h1, atom('N')], [w]), b: hand([atom('O'), atom('N')], []) } });
    check('the first player may open a molecule', apply(s, 'a', { t: 'startMolecule', molecule: w.id, cards: [h1.id] }).ok);
    check('the molecule is on the table', s.area.molecule.mol === 'water');
    check('the atom is on the table', s.area.units.length === 1 && s.area.units[0].el === 'H');
    check('opening moves the turn on', s.turn === 1);
    check('the molecule card left the hand', s.hands.a.molecules.length === 0);
    check('the game is now in building', s.phase === 'building');
  }

  {
    const a1 = atom('C'), k = mol('alkanes');
    const s = table({ hands: { a: hand([a1, atom('O')], [k]), b: hand() } });
    check('an alkane without a declaration is refused',
      !apply(s, 'a', { t: 'startMolecule', molecule: k.id, cards: [a1.id] }).ok);
    check('an alkane with a declaration is accepted',
      apply(s, 'a', { t: 'startMolecule', molecule: k.id, cards: [a1.id], alkaneN: 3 }).ok);
    check('the declaration is remembered', s.area.alkaneN === 3);
  }

  {
    const c = atom('C'), spare = atom('H'), w = mol('water');
    const s = table({ hands: { a: hand([c, spare], [w]), b: hand() } });
    const r = apply(s, 'a', { t: 'startMolecule', molecule: w.id, cards: [c.id] });
    check('opening water with a carbon is refused', !r.ok, r.error);
    check('a refused opening leaves the table empty', s.area.molecule === null && s.area.units.length === 0);
    check('a refused opening leaves the cards in hand',
      s.hands.a.molecules.length === 1 && s.hands.a.atoms.length === 2);
  }

  /* ---------- turns ---------- */

  {
    const h1 = atom('H'), h2 = atom('H'), w = mol('water');
    const s = table({ hands: { a: hand([h1, atom('N')], [w]), b: hand([h2, atom('N')], []) } });
    apply(s, 'a', { t: 'startMolecule', molecule: w.id, cards: [h1.id] });
    check('a player out of turn is refused', !apply(s, 'a', { t: 'placeUnit', cards: [h1.id] }).ok);
    const r = apply(s, 'b', { t: 'placeUnit', cards: [h2.id] });
    check('the player in turn may place', r.ok, r.error);
    check('a card not in hand is refused', !apply(s, 'a', { t: 'placeUnit', cards: ['ghost'] }).ok);
  }

  /* ---------- completing a molecule ---------- */

  {
    const h1 = atom('H'), h2 = atom('H'), o = atom('O'), spare = atom('C'), w = mol('water');
    const s = table({
      seats: ['a', 'b'],
      hands: { a: hand([h1, h2, spare], [w]), b: hand([o, atom('N')], []) },
    });
    apply(s, 'a', { t: 'startMolecule', molecule: w.id, cards: [h1.id] });
    apply(s, 'b', { t: 'placeUnit', cards: [o.id] });
    const r = apply(s, 'a', { t: 'placeUnit', cards: [h2.id] });
    check('the molecule completes', r.ok && s.phase === 'takeback', s.phase);
    check('both contributors are asked', s.takeback.pending.length === 2, JSON.stringify(s.takeback));
    check('the finisher is recorded', s.takeback.finisher === 'a');
    check('a card somebody else placed may not be taken', !apply(s, 'a', { t: 'takeBack', card: o.id }).ok);
    check('declining is allowed', apply(s, 'b', { t: 'takeBack', card: null }).ok);
    check('the other is still pending', s.phase === 'takeback');
    const back = apply(s, 'a', { t: 'takeBack', card: h1.id });
    check('taking one card back is allowed', back.ok, back.error);
    check('the card is back in the hand', s.hands.a.atoms.some((c) => c.id === h1.id));
    check('and nothing of it is left on the table',
      !s.area.units.some((u) => !u.cards.length));
    check('the table is cleared', s.area.molecule === null && s.area.units.length === 0);
    check('the molecule card went to its discard', s.molDiscard.length === 1);
    check('the remaining atoms went to their discard', s.atomDiscard.length === 2, s.atomDiscard.length);
    check('the finisher opens the next molecule', s.phase === 'opening' && s.seats[s.turn] === 'a');
  }

  {
    // Three players, so the table is still standing when the first of them
    // takes his card back: the spot it left must be empty, not a card with
    // nothing on it.
    const h1 = atom('H'), h2 = atom('H'), o = atom('O'), w = mol('water');
    const s = table({
      seats: ['a', 'b', 'c'],
      hands: {
        a: hand([h1, atom('N')], [w]),
        b: hand([h2, atom('N')], []),
        c: hand([o, atom('N')], []),
      },
    });
    apply(s, 'a', { t: 'startMolecule', molecule: w.id, cards: [h1.id] });
    apply(s, 'b', { t: 'placeUnit', cards: [h2.id] });
    apply(s, 'c', { t: 'placeUnit', cards: [o.id] });
    check('all three are asked', s.phase === 'takeback' && s.takeback.pending.length === 3,
      JSON.stringify(s.takeback));
    const r = apply(s, 'a', { t: 'takeBack', card: h1.id });
    check('the first of them takes his atom back', r.ok, r.error);
    check('the others are still being asked', s.phase === 'takeback');
    check('the atom is gone from the table',
      !s.area.units.some((u) => u.cards.some((c) => c.id === h1.id)));
    check('and left no empty place behind it',
      s.area.units.length === 2 && s.area.units.every((u) => u.cards.length === 1));
  }

  {
    const f = atom(FUSION), h1 = atom('H'), h2 = atom('H'), o = atom('O'), w = mol('water');
    const s = table({ hands: { a: hand([f, h1, atom('C')], [w]), b: hand([h2, o], []) } });
    apply(s, 'a', { t: 'startMolecule', molecule: w.id, cards: [f.id, h1.id] });
    check('a fusion placement counts as its sum', s.area.units[0].el === 'H');
    apply(s, 'b', { t: 'placeUnit', cards: [h2.id] });
    apply(s, 'a', { t: 'placeUnit', cards: [atomInHand(s, 'a', 'C').id] });
    check('a carbon is refused in water', s.phase === 'building', s.phase);
  }

  {
    const f = atom(FUSION), h1 = atom('H'), h2 = atom('H'), o = atom('O'), spare = atom('N'), w = mol('water');
    const s = table({
      hands: { a: hand([f, h1, spare], [w]), b: hand([h2, o, atom('C')], []) },
      decks: { atomDeck: [atom('C')] },
    });
    apply(s, 'a', { t: 'startMolecule', molecule: w.id, cards: [f.id, h1.id] });
    apply(s, 'b', { t: 'placeUnit', cards: [h2.id] });
    apply(s, 'a', { t: 'placeUnit', cards: [spare.id] }); // nitrogen, refused
    apply(s, 'a', { t: 'drawAtom' });
    apply(s, 'b', { t: 'placeUnit', cards: [o.id] });
    check('the molecule completed on the oxygen', s.phase === 'takeback', s.phase);
    check('a fusion card may not be taken back', !apply(s, 'a', { t: 'takeBack', card: f.id }).ok);
    // The group was laid as one atom, so it is not taken apart either.
    check('neither may an atom that went into the fusion',
      !apply(s, 'a', { t: 'takeBack', card: h1.id }).ok);
    check('the fused group is still whole on the table',
      s.area.units.some((u) => u.cards.length === 2 && u.el === 'H'));
    check('declining is allowed all the same', apply(s, 'a', { t: 'takeBack', card: null }).ok);
  }

  /* ---------- swapping the molecule ---------- */

  {
    const h1 = atom('H'), h2 = atom('H'), am = mol('ammonia'), w = mol('water');
    const s = table({ hands: { a: hand([h1, atom('O')], [am]), b: hand([h2, atom('C')], [w]) } });
    apply(s, 'a', { t: 'startMolecule', molecule: am.id, cards: [h1.id] });
    const r = apply(s, 'b', { t: 'swapMolecule', molecule: w.id, cards: [h2.id] });
    check('a molecule may be swapped for one that still fits', r.ok, r.error);
    check('the new molecule is on the table', s.area.molecule.mol === 'water');
    check('the old molecule went to the discard', s.molDiscard.length === 1);
    check('the atoms already placed stayed', s.area.units.length === 2);
  }

  {
    const c = atom('C'), o = atom('O'), me = mol('methane'), ox = mol('oxygen');
    const s = table({ hands: { a: hand([c, atom('N')], [me]), b: hand([o, atom('N')], [ox]) } });
    apply(s, 'a', { t: 'startMolecule', molecule: me.id, cards: [c.id] });
    const r = apply(s, 'b', { t: 'swapMolecule', molecule: ox.id, cards: [o.id] });
    check('a swap that strands the atoms on the table is refused', !r.ok, r.error);
    check('the refused swap changed nothing', s.area.molecule.mol === 'methane' && s.molDiscard.length === 0);
  }

  /* ---------- the decks ---------- */

  {
    const h1 = atom('H'), w = mol('water');
    const drawn = atom('O');
    const s = table({
      hands: { a: hand([h1, atom('N')], [w]), b: hand([atom('N')], []) },
      decks: { atomDeck: [drawn] },
    });
    apply(s, 'a', { t: 'startMolecule', molecule: w.id, cards: [h1.id] });
    check('drawing takes from the deck', apply(s, 'b', { t: 'drawAtom' }).ok);
    check('the card is in the hand', s.hands.b.atoms.some((c) => c.id === drawn.id));
    check('drawing passes the turn', s.seats[s.turn] === 'a');
    check('an empty deck and discard refuse a draw', !apply(s, 'a', { t: 'drawAtom' }).ok);
  }

  {
    const h1 = atom('H'), w = mol('water'), used = atom('N');
    const s = table({
      hands: { a: hand([h1, atom('N')], [w]), b: hand([atom('N')], []) },
      decks: { atomDiscard: [used] },
    });
    apply(s, 'a', { t: 'startMolecule', molecule: w.id, cards: [h1.id] });
    const r = apply(s, 'b', { t: 'drawAtom' });
    check('an empty deck is refilled from its discard', r.ok, r.error);
    check('the discard is now empty', s.atomDiscard.length === 0);
  }

  /* ---------- the deadlock rule ---------- */

  {
    const stocked = (() => {
      const h = atom('H'), w2 = mol('water');
      const t = table({
        hands: { a: hand([h, atom('N')], [w2]), b: hand([atom('N')], []) },
        decks: { atomDeck: [atom('C')] },
      });
      apply(t, 'a', { t: 'startMolecule', molecule: w2.id, cards: [h.id] });
      return t;
    })();
    check('passing while atoms can still be drawn is refused', !apply(stocked, 'b', { t: 'pass' }).ok);

    const h1 = atom('H'), w = mol('water');
    const s = table({ seats: ['a', 'b'], hands: { a: hand([h1, atom('N')], [w]), b: hand([atom('N')], []) } });
    apply(s, 'a', { t: 'startMolecule', molecule: w.id, cards: [h1.id] });
    check('passing with both empty is allowed', apply(s, 'b', { t: 'pass' }).ok);
    check('one pass is not a full round', s.area.molecule !== null);
    const r = apply(s, 'a', { t: 'pass' });
    check('a full round of passes clears the table', r.ok && s.area.molecule === null, s.phase);
    check('the turn returns to the last player who placed', s.seats[s.turn] === 'a');
    check('and he opens a new molecule', s.phase === 'opening');
  }

  /* ---------- winning ---------- */

  {
    const h1 = atom('H'), h2 = atom('H'), o = atom('O'), w = mol('water');
    const s = table({ hands: { a: hand([h1, h2], [w]), b: hand([o, atom('N')], []) } });
    apply(s, 'a', { t: 'startMolecule', molecule: w.id, cards: [h1.id] });
    apply(s, 'b', { t: 'placeUnit', cards: [o.id] });
    const r = apply(s, 'a', { t: 'placeUnit', cards: [h2.id] });
    check('emptying your hand wins', r.ok && s.winner === 'a', s.winner);
    check('winning ends the game before any take-back', s.phase === 'over');
    check('no move is accepted after the win', !apply(s, 'b', { t: 'drawAtom' }).ok);
  }

  {
    const h1 = atom('H'), h2 = atom('H'), w = mol('water');
    const s = table({ hands: { a: hand([h1], [w]), b: hand([h2, atom('O')], []) } });
    apply(s, 'a', { t: 'startMolecule', molecule: w.id, cards: [h1.id] });
    check('the opener who used his last atom wins', s.winner === 'a' && s.phase === 'over');
  }

  /* ---------- drawing five and keeping one ---------- */

  {
    const w = mol('water'), extra = [mol('methane'), mol('ethane'), mol('propane'), mol('butane'), mol('glucose')];
    const s = table({
      hands: { a: hand([atom('H')], [w]), b: hand([atom('H')], []) },
      decks: { molDeck: [...extra] },
    });
    const r = apply(s, 'a', { t: 'drawFive', kind: 'molecules' });
    check('the first player may draw five instead of opening', r.ok, r.error);
    check('five were drawn', s.phase === 'picking' && s.pick.cards.length === 5);
    check('another player may not pick', !apply(s, 'b', { t: 'pick', card: extra[0].id }).ok);
    check('picking keeps one', apply(s, 'a', { t: 'pick', card: extra[0].id }).ok);
    check('the kept card is in the hand', s.hands.a.molecules.some((c) => c.id === extra[0].id));
    check('the other four were discarded', s.molDiscard.length === 4, s.molDiscard.length);
    check('the turn moves on and the next player opens', s.phase === 'opening' && s.seats[s.turn] === 'b');
  }

  {
    const s = table({ hands: { a: hand([atom('H')], []), b: hand([atom('H')], []) } });
    check('drawing five from an empty deck is refused', !apply(s, 'a', { t: 'drawFive', kind: 'atoms' }).ok);
  }

  /* ---------- what each player may see ---------- */

  {
    const s = newGame({ seats: ['a', 'b', 'c'], deal: { atoms: 12, molecules: 3 }, seed: 42 });
    const pub = publicView(s);
    check('the public view counts cards but does not name them',
      pub.seats.every((x) => x.atoms === 12 && x.molecules === 3) && !JSON.stringify(pub).includes('"el":"H"'));
    const mine = privateView(s, 'a');
    check('a player sees his own twelve atoms', mine.atoms.length === 12);
    check('a player sees his own three molecules', mine.molecules.length === 3);
    check('the deal came out of the decks', s.atomDeck.length === 72 - 36 && s.molDeck.length === 36 - 9);
  }

  /* ---------- a whole game ---------- */

  {
    const played = playOut(['a', 'b', 'c'], { atoms: 9, molecules: 3 }, 2024);
    check('a full three-player game reaches a winner', !!played.state.winner, played.stop);
    check('no atom card was lost or invented along the way', played.conserved, played.conservedAt);
    check('the game did not need an unreasonable number of moves', played.moves < 4000, played.moves);
  }

  {
    // The same seed must give the same game, or a test can never be trusted.
    const one = playOut(['a', 'b'], { atoms: 6, molecules: 3 }, 99);
    const two = playOut(['a', 'b'], { atoms: 6, molecules: 3 }, 99);
    check('a seed replays the same game', one.state.winner === two.state.winner && one.moves === two.moves);
  }
}

function atomInHand(state, pid, el) {
  return state.hands[pid].atoms.find((c) => c.el === el);
}

// A player that always prefers placing a card over drawing one.
function candidateMoves(state, pid) {
  const hand = state.hands[pid];
  const out = [];
  if (state.phase === 'takeback') return [{ t: 'takeBack', card: null }];
  if (state.phase === 'picking') return state.pick.cards.map((c) => ({ t: 'pick', card: c.id }));
  if (state.phase === 'building') {
    for (const c of hand.atoms) out.push({ t: 'placeUnit', cards: [c.id] });
    for (const m of hand.molecules) {
      for (const c of hand.atoms) {
        out.push({ t: 'swapMolecule', molecule: m.id, cards: [c.id], alkaneN: 3 });
      }
    }
    out.push({ t: 'drawAtom' }, { t: 'pass' });
  } else if (state.phase === 'opening') {
    for (const m of hand.molecules) {
      for (const c of hand.atoms) {
        out.push({ t: 'startMolecule', molecule: m.id, cards: [c.id], alkaneN: 3 });
      }
    }
    out.push({ t: 'drawFive', kind: 'atoms' }, { t: 'drawFive', kind: 'molecules' });
  }
  return out;
}

function playOut(seats, deal, seed) {
  const state = newGame({ seats, deal, seed });
  let moves = 0;
  let conserved = true;
  let conservedAt = '';
  let stop = 'winner';
  while (!state.winner && moves < 4000) {
    const pid = state.phase === 'takeback' ? state.takeback.pending[0] : state.seats[state.turn];
    let acted = false;
    for (const move of candidateMoves(state, pid)) {
      const probe = structuredClone(state);
      if (apply(probe, pid, move).ok) {
        apply(state, pid, move);
        acted = true;
        break;
      }
    }
    moves += 1;
    if (!acted) { stop = `stuck at move ${moves} in ${state.phase}`; break; }
    if (countAtomsOf(state) !== 72) {
      conserved = false;
      conservedAt = `${countAtomsOf(state)} atoms after move ${moves}`;
      break;
    }
  }
  if (!state.winner && stop === 'winner') stop = `no winner after ${moves} moves`;
  return { state, moves, conserved, conservedAt, stop };
}

function countAtomsOf(s) {
  let total = s.atomDeck.length + s.atomDiscard.length;
  for (const id of s.seats) total += s.hands[id].atoms.length;
  for (const u of s.area.units) total += u.cards.length;
  if (s.pick && s.pick.kind === 'atoms') total += s.pick.cards.length;
  return total;
}
