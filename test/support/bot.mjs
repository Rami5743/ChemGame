// Works out what a player could legally do, from the public table and his own
// cards, with the same functions the host uses.
import { MOLECULES, FUSION } from '../../js/cards.js';
import { formulaOf, isPartOf, isComplete } from '../../js/rules.js';

export const compositionOf = (units) => {
  const comp = {};
  for (const u of units) comp[u.el] = (comp[u.el] || 0) + 1;
  return comp;
};

// Every way this hand can put one atom on the table: a card on its own, or a
// fusion card paired with one regular atom, which counts as that atom.
function placements(cards) {
  const regular = cards.atoms.filter((c) => c.el !== FUSION);
  const fusions = cards.atoms.filter((c) => c.el === FUSION);
  const out = regular.map((c) => ({ el: c.el, ids: [c.id] }));
  for (const f of fusions) {
    for (const c of regular) out.push({ el: c.el, ids: [f.id, c.id], fused: true });
  }
  return out;
}

export function candidates(state, cards) {
  const g = state.game;
  if (g.phase === 'takeback') return [{ t: 'takeBack', card: null }];
  if (g.phase === 'picking') return (cards.pick?.cards || []).map((c) => ({ t: 'pick', card: c.id }));

  const options = placements(cards);
  const out = [];

  if (g.phase === 'opening') {
    for (const m of cards.molecules) {
      const ns = MOLECULES[m.mol].special === 'alkanes' ? [1, 2, 3, 4] : [undefined];
      for (const n of ns) {
        const formula = formulaOf(m.mol, n);
        for (const o of options) {
          if (formula[o.el]) out.push({ t: 'startMolecule', molecule: m.id, cards: o.ids, alkaneN: n });
        }
      }
    }
    out.push({ t: 'drawFive', kind: 'molecules' }, { t: 'drawFive', kind: 'atoms' });
    return out;
  }

  const formula = formulaOf(g.area.molecule, g.area.alkaneN);
  const here = compositionOf(g.area.units);
  const fits = [];
  for (const o of options) {
    const next = { ...here, [o.el]: (here[o.el] || 0) + 1 };
    if (isPartOf(next, formula)) {
      fits.push({ move: { t: 'placeUnit', cards: o.ids }, score: (o.fused ? 2 : 0) + (isComplete(next, formula) ? 1 : 0) });
    }
  }
  fits.sort((x, y) => y.score - x.score);
  out.push(...fits.map((f) => f.move));

  for (const m of cards.molecules) {
    const ns = MOLECULES[m.mol].special === 'alkanes' ? [1, 2, 3] : [undefined];
    for (const n of ns) {
      const f2 = formulaOf(m.mol, n);
      if (!isPartOf(here, f2)) continue;
      for (const o of options) {
        const next = { ...here, [o.el]: (here[o.el] || 0) + 1 };
        if (isPartOf(next, f2)) out.push({ t: 'swapMolecule', molecule: m.id, cards: o.ids, alkaneN: n });
      }
    }
  }
  out.push({ t: 'drawAtom' }, { t: 'pass' });
  return out;
}
