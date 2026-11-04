import { MOLECULES, alkaneFormula } from '../../js/cards.js';
import { LAYOUTS, alkaneLayout, layoutFor, layoutFormula } from '../../js/layouts.js';

const same = (a, b) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] || 0) !== (b[k] || 0)) return false;
  return true;
};
const show = (f) => Object.entries(f).map(([k, v]) => k + v).join('');

export default async function run({ check }) {
  const printed = Object.entries(MOLECULES).filter(([, m]) => !m.special);

  for (const [id, m] of printed) {
    const layout = LAYOUTS[id];
    check(`${id} has a shape`, !!layout);
    if (!layout) continue;
    const got = layoutFormula(layout);
    check(`the shape of ${id} holds exactly its formula`, same(got, m.formula),
      `${show(got)} against ${show(m.formula)}`);
    check(`no two atoms of ${id} sit on the same spot`,
      new Set(layout.map((s) => `${s.x},${s.y}`)).size === layout.length);
    check(`the shape of ${id} starts at the corner`,
      Math.min(...layout.map((s) => s.x)) === 0 && Math.min(...layout.map((s) => s.y)) === 0);
  }

  for (let n = 1; n <= 8; n++) {
    const layout = alkaneLayout(n);
    check(`an alkane of ${n} carbons has the right shape`,
      same(layoutFormula(layout), alkaneFormula(n)), show(layoutFormula(layout)));
    check(`the alkane of ${n} carbons has no two atoms on one spot`,
      new Set(layout.map((s) => `${s.x},${s.y}`)).size === layout.length);
  }

  check('an undeclared alkane has no shape yet', layoutFor('alkanes') === null);
  check('a declared alkane does', layoutFor('alkanes', 3).length === 11);
  check('every molecule of the game can be laid out',
    printed.every(([id]) => layoutFor(id)) && !!layoutFor('alkanes', 2));
}
