// Where each atom of a molecule sits, so the table can be laid out the way the
// structure is drawn on the card. Coordinates are whole grid cells, x running
// left to right and y top to bottom, exactly as the diagram reads.
//
// Every layout is checked against the molecule's formula by the test run, so a
// slot that is added or moved cannot silently disagree with the chemistry.

import { MOLECULES, alkaneFormula } from './cards.js';

const at = (el, x, y) => ({ el, x, y });
const row = (el, y, from, to) => {
  const out = [];
  for (let x = from; x <= to; x++) out.push(at(el, x, y));
  return out;
};

export const LAYOUTS = {
  // H-H
  hydrogen: [at('H', 0, 0), at('H', 1, 0)],
  // O=O
  oxygen: [at('O', 0, 0), at('O', 1, 0)],
  // N≡N
  nitrogen: [at('N', 0, 0), at('N', 1, 0)],
  // O=C=O
  carbonDioxide: [at('O', 0, 0), at('C', 1, 0), at('O', 2, 0)],
  //  H   H
  //    O
  water: [at('H', 0, 0), at('H', 2, 0), at('O', 1, 1)],
  //  H
  //   N-H
  //  H
  ammonia: [at('H', 0, 0), at('N', 1, 1), at('H', 2, 1), at('H', 0, 2)],
  //  H   H
  //    C
  //  H   H
  methane: [at('H', 0, 0), at('H', 2, 0), at('C', 1, 1), at('H', 0, 2), at('H', 2, 2)],
  //  H   H
  //   N-N
  //  H   H
  hydrazine: [
    at('H', 0, 0), at('H', 3, 0),
    at('N', 1, 1), at('N', 2, 1),
    at('H', 0, 2), at('H', 3, 2),
  ],
  //      H
  //  H-O-C-H
  //      H
  methanol: [
    at('H', 2, 0),
    at('H', 0, 1), at('O', 1, 1), at('C', 2, 1), at('H', 3, 1),
    at('H', 2, 2),
  ],
  //    H
  //  H-C-H
  //  H-C-H
  //    H
  ethane: [
    at('H', 1, 0),
    at('H', 0, 1), at('C', 1, 1), at('H', 2, 1),
    at('H', 0, 2), at('C', 1, 2), at('H', 2, 2),
    at('H', 1, 3),
  ],
  //  H H
  //  H-C-C-O-H
  //  H H
  ethanol: [
    at('H', 1, 0), at('H', 2, 0),
    at('H', 0, 1), at('C', 1, 1), at('C', 2, 1), at('O', 3, 1), at('H', 4, 1),
    at('H', 1, 2), at('H', 2, 2),
  ],
  //  H H H
  //  H-C-C-C-H
  //  H H H
  propane: [
    ...row('H', 0, 1, 3),
    at('H', 0, 1), ...row('C', 1, 1, 3), at('H', 4, 1),
    ...row('H', 2, 1, 3),
  ],
  //  H H H H
  //  H-C-C-C-C-H
  //  H H H H
  butane: [
    ...row('H', 0, 1, 4),
    at('H', 0, 1), ...row('C', 1, 1, 4), at('H', 5, 1),
    ...row('H', 2, 1, 4),
  ],
  //  H O H
  //  H-C-C-C-H
  //  H   H
  acetone: [
    at('H', 1, 0), at('O', 2, 0), at('H', 3, 0),
    at('H', 0, 1), ...row('C', 1, 1, 3), at('H', 4, 1),
    at('H', 1, 2), at('H', 3, 2),
  ],
  //    H     O
  //  H-C-C
  //    H     O-H
  aceticAcid: [
    at('H', 1, 0), at('O', 3, 0),
    at('H', 0, 1), at('C', 1, 1), at('C', 2, 1),
    at('H', 1, 2), at('O', 3, 2), at('H', 4, 2),
  ],
  //      O
  //  H-N-C-N-H
  //    H   H
  urea: [
    at('O', 2, 0),
    at('H', 0, 1), at('N', 1, 1), at('C', 2, 1), at('N', 3, 1), at('H', 4, 1),
    at('H', 1, 2), at('H', 3, 2),
  ],
  //  H   H   O
  //   N-C-C
  //  H   H   O-H
  glycine: [
    at('H', 0, 0), at('H', 2, 0), at('O', 4, 0),
    at('N', 1, 1), at('C', 2, 1), at('C', 3, 1),
    at('H', 0, 2), at('H', 2, 2), at('O', 4, 2), at('H', 5, 2),
  ],
  //      H H H H
  //  O   O O O O
  //  C-C-C-C-C-C-O-H
  //  H H H H H H
  glucose: [
    ...row('H', 0, 1, 4),
    at('O', 0, 1), ...row('O', 1, 1, 4), at('H', 5, 1),
    ...row('C', 2, 0, 5), at('O', 6, 2), at('H', 7, 2),
    ...row('H', 3, 0, 5),
  ],
};

// An alkane is as long as it was declared: a chain of carbons with a hydrogen
// above and below each one, and one at either end.
export function alkaneLayout(n) {
  return [
    ...row('H', 0, 1, n),
    at('H', 0, 1), ...row('C', 1, 1, n), at('H', n + 1, 1),
    ...row('H', 2, 1, n),
  ];
}

export function layoutFor(moleculeId, alkaneN) {
  const mol = MOLECULES[moleculeId];
  if (!mol) return null;
  if (mol.special === 'alkanes') {
    return Number.isInteger(alkaneN) && alkaneN > 0 ? alkaneLayout(alkaneN) : null;
  }
  return LAYOUTS[moleculeId] || null;
}

// The counts a layout implies, for checking it against the formula.
export function layoutFormula(layout) {
  const f = {};
  for (const slot of layout) f[slot.el] = (f[slot.el] || 0) + 1;
  return f;
}

export { alkaneFormula };
