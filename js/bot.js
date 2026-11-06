// A player the host plays for. It wants what a player wants — to be rid of
// its atoms — and it goes about it simply:
//
//   * oxygen first. An oxygen card is the one hardest to place, so whatever
//     lets one go down is taken before anything else, and the molecule in
//     play is traded for another if that is what it takes.
//   * a fusion only when nothing else fits. It spends several cards to place
//     one atom, which is a loss unless it is the only way on.
//   * a new molecule when an oxygen is held and nothing on offer takes it,
//     or when there is no other move.
//   * glucose only with three oxygens or more in hand. It asks for six of
//     them, which is a fine thing to open with holding plenty and a trap
//     holding one.
//
// It knows only what a player knows: the public state and its own hand.

import { MOLECULES, FUSION, ELEMENTS, ALKANE_MIN, ALKANE_MAX } from './cards.js';
import { formulaOf, isPartOf, unitElement } from './rules.js';

const GOOD = 'O';            // the atom worth playing a turn to be rid of
const GLUCOSE_WANTS = 3;     // oxygens in hand before glucose is worth opening

const countOf = (atoms, el) => atoms.filter((c) => c.el === el).length;
const isAlkane = (mol) => MOLECULES[mol]?.special === 'alkanes';

// What is on the table, counted by element.
function onTable(area) {
  const out = {};
  for (const u of area.units) out[u.el] = (out[u.el] || 0) + 1;
  return out;
}

// Every number of carbons the alkanes card may stand for, best first: the
// one that asks for the most atoms the bot is holding.
function alkaneChoices(atoms) {
  const out = [];
  for (let n = ALKANE_MIN; n <= ALKANE_MAX; n += 1) out.push(n);
  const h = countOf(atoms, 'H');
  const c = countOf(atoms, 'C');
  return out.sort((a, b) => Math.min(c, b) + Math.min(h, 2 * b + 2) -
    (Math.min(c, a) + Math.min(h, 2 * a + 2)));
}

// The plain atoms of a hand that may go down on their own, best first.
function placeable(atoms, formula, here) {
  const out = [];
  for (const card of atoms) {
    if (card.el === FUSION) continue;
    const next = { ...here, [card.el]: (here[card.el] || 0) + 1 };
    if (isPartOf(next, formula)) out.push(card);
  }
  return out.sort((a, b) => worth(b.el) - worth(a.el));
}

// Oxygen above all, then whatever is heaviest: a card that is hard to place
// is better gone while there is somewhere to put it.
const worth = (el) => (el === GOOD ? 100 : ELEMENTS[el]?.z || 0);

// A fusion that fits: the fusion card with the fewest atoms that make an
// element the molecule still wants.
function fusion(atoms, formula, here) {
  const fuse = atoms.find((c) => c.el === FUSION);
  if (!fuse) return null;
  const rest = atoms.filter((c) => c.el !== FUSION);
  const tries = [];
  for (let size = 1; size <= Math.min(4, rest.length); size += 1) {
    for (const group of combinations(rest, size)) {
      const unit = unitElement([fuse, ...group]);
      if (unit.error) continue;
      const next = { ...here, [unit.el]: (here[unit.el] || 0) + 1 };
      if (isPartOf(next, formula)) tries.push([fuse, ...group]);
    }
    if (tries.length) break; // the fewest cards spent is the best fusion
  }
  if (!tries.length) return null;
  // Among equals, the one that is rid of an oxygen.
  tries.sort((a, b) => count(b, GOOD) - count(a, GOOD));
  return tries[0];
}

const count = (cards, el) => cards.filter((c) => c.el === el).length;

function* combinations(cards, size, from = 0, picked = []) {
  if (picked.length === size) {
    yield picked;
    return;
  }
  for (let i = from; i < cards.length; i += 1) {
    yield* combinations(cards, size, i + 1, [...picked, cards[i]]);
  }
}

// What a molecule card is worth opening with, holding this hand.
function moleculeWorth(card, atoms, here = {}) {
  const oxygens = countOf(atoms, GOOD);
  let best = null;
  for (const n of isAlkane(card.mol) ? alkaneChoices(atoms) : [undefined]) {
    const formula = formulaOf(card.mol, n);
    if (!formula || !isPartOf(here, formula)) continue;
    const fits = placeable(atoms, formula, here);
    if (!fits.length) continue;
    let score = fits.length;
    if (formula[GOOD]) score += 50 * Math.min(oxygens, formula[GOOD] - (here[GOOD] || 0));
    if (card.mol === 'glucose' && oxygens < GLUCOSE_WANTS) score -= 200;
    if (!best || score > best.score) best = { score, alkaneN: n, card, first: fits[0] };
  }
  return best;
}

// The move the bot makes, or null if it has nothing to do.
export function botMove(view, hand) {
  const { phase, area } = view;

  if (phase === 'picking') return pick(view, hand);
  if (phase === 'takeback') {
    // A card taken back is a card to be rid of again; it declines.
    return { t: 'takeBack', card: null };
  }

  if (phase === 'opening') {
    const best = bestMolecule(hand);
    if (best) {
      return {
        t: 'startMolecule',
        molecule: best.card.id,
        cards: [best.first.id],
        ...(best.alkaneN === undefined ? {} : { alkaneN: best.alkaneN }),
      };
    }
    // Nothing to open with: ask for molecules, or for atoms if none are left.
    return { t: 'drawFive', kind: view.molDeck + view.molDiscard > 0 ? 'molecules' : 'atoms' };
  }

  // --- a molecule is being built ------------------------------------------
  const formula = formulaOf(area.molecule, area.alkaneN);
  const here = onTable(area);
  const fits = formula ? placeable(hand.atoms, formula, here) : [];

  if (fits.length && fits[0].el === GOOD) return { t: 'placeUnit', cards: [fits[0].id] };

  // An oxygen in hand that this molecule will not take: another might.
  if (countOf(hand.atoms, GOOD) > 0 && (!fits.length || fits[0].el !== GOOD)) {
    const swap = bestMolecule(hand, here, true);
    if (swap && swap.first.el === GOOD) {
      return {
        t: 'swapMolecule',
        molecule: swap.card.id,
        cards: [swap.first.id],
        ...(swap.alkaneN === undefined ? {} : { alkaneN: swap.alkaneN }),
      };
    }
  }

  if (fits.length) return { t: 'placeUnit', cards: [fits[0].id] };

  const fused = formula ? fusion(hand.atoms, formula, here) : null;
  if (fused) return { t: 'placeUnit', cards: fused.map((c) => c.id) };

  // Nothing fits. A molecule of its own is better than a card from the deck.
  const other = bestMolecule(hand, here, true);
  if (other) {
    return {
      t: 'swapMolecule',
      molecule: other.card.id,
      cards: [other.first.id],
      ...(other.alkaneN === undefined ? {} : { alkaneN: other.alkaneN }),
    };
  }
  if (view.atomDeck + view.atomDiscard > 0) return { t: 'drawAtom' };
  return { t: 'pass' };
}

// The molecule card worth the most, either to open with or to swap in.
function bestMolecule(hand, here = {}, mustFitTable = false) {
  let best = null;
  for (const card of hand.molecules) {
    const worthIt = moleculeWorth(card, hand.atoms, mustFitTable ? here : {});
    if (worthIt && worthIt.score > 0 && (!best || worthIt.score > best.score)) best = worthIt;
  }
  return best;
}

// One of five cards drawn: the one that helps most.
function pick(view, hand) {
  const cards = hand.pick?.cards || [];
  if (!cards.length) return null;
  if (view.pickKind === 'molecules') {
    let best = cards[0];
    let score = -Infinity;
    for (const card of cards) {
      const worthIt = moleculeWorth(card, hand.atoms);
      const value = worthIt ? worthIt.score : -100;
      if (value > score) {
        score = value;
        best = card;
      }
    }
    return { t: 'pick', card: best.id };
  }
  // An atom it must take: the lightest, which is the easiest to place again.
  const sorted = [...cards].sort((a, b) => (ELEMENTS[a.el]?.z || 99) - (ELEMENTS[b.el]?.z || 99));
  return { t: 'pick', card: sorted[0].id };
}

export const BOT_NAMES = ['דניאל', 'R2-D2', 'C-3PO', 'מרווין', 'הל'];
export const BOT_NAMES_EN = ['Daniel', 'R2-D2', 'C-3PO', 'Marvin', 'HAL'];
