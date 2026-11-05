// The two ways of showing the table: the shape the card draws, and a pile
// for each element of the formula.
import { formulaOf } from '../../js/rules.js';
import { FUSION } from '../../js/cards.js';
import { openPlayer, connected } from '../support/player.mjs';

const SEED = 1; // this deal puts glucose and acetic acid in the first hand
const PHONE = { width: 412, height: 915 };

const readState = (page) => page.evaluate(() => window.chemgame.state());
const readCards = (page) => page.evaluate(() => window.chemgame.cards());
const send = (page, move) => page.evaluate((m) => window.chemgame.move(m), move);
const active = (page) =>
  page.$$eval('#table-views button.active', (n) => n.map((b) => b.dataset.view));

export default async function run({ check, browser, baseUrl, consoleErrors }) {
  const open = (url, name, label, viewport) =>
    openPlayer({ browser, url, name, consoleErrors, label, viewport });

  // --- a game whose first player opens with glucose ------------------------
  const host = await open(`${baseUrl}&seed=${SEED}`, 'דנה', 'host');
  await connected(host);
  const link = await host.inputValue('#share');
  const guest = await open(link, 'רם', 'guest', PHONE);
  for (const p of [host, guest]) {
    await p.waitForFunction(() => document.querySelectorAll('#roster li').length === 2, null, { timeout: 25000 });
  }
  await host.fill('#set-atoms', '20');
  await host.fill('#set-mols', '4');
  await host.click('#start');
  for (const p of [host, guest]) {
    await p.waitForFunction(() => window.chemgame.cards()?.atoms?.length === 20, null, { timeout: 20000 });
  }

  const pages = {};
  for (const p of [host, guest]) pages[(await p.evaluate(() => window.chemgame.me())).id] = p;
  const waitRev = (page, rev) =>
    page.waitForFunction((r) => window.chemgame.state()?.rev > r, rev, { timeout: 15000 });

  check('with nothing on the table there is nothing to choose between',
    await host.isHidden('#table-views'));

  // Open whichever of the two molecules is wanted, with one atom that fits.
  async function openWith(wanted) {
    const state = await readState(host);
    const page = pages[state.turn];
    const cards = await readCards(page);
    const card = cards.molecules.find((c) => c.mol === wanted);
    if (!card) return null;
    const formula = formulaOf(wanted, null);
    const atom = cards.atoms.find((c) => c.el !== FUSION && formula[c.el]);
    const said = await send(page, { t: 'startMolecule', molecule: card.id, cards: [atom.id] });
    if (said) return null;
    await waitRev(host, state.rev);
    return formula;
  }

  const formula = await openWith('glucose');
  check('the first hand holds glucose, as this deal was chosen for', !!formula);

  /* ---------- what each screen opens on ---------- */
  check('glucose opens on the piles, even on a wide screen',
    (await active(host)).join() === 'formula', (await active(host)).join());
  check('and on a phone as well', (await active(guest)).join() === 'formula');
  check('the table is drawn as piles', await host.isVisible('#table-units.units-formula'));

  /* ---------- what a pile says ---------- */
  const heads = await host.$$eval('#table-views ~ * .el-head, #table .el-head',
    (n) => n.map((x) => x.textContent));
  check('a pile for every element of the formula',
    heads.length === Object.keys(formula).length, heads.join(' | '));
  const first = Object.entries(formula)[0];
  check('and each says its element, what is down and what is wanted',
    heads.some((h) => h === `${first[0]} 1/${first[1]}`) ||
    heads.some((h) => h === `${first[0]} 0/${first[1]}`), heads.join(' | '));
  check('a pile with nothing in it still shows where its atoms go',
    (await host.$$('#table .el-stack .slot-empty')).length > 0);

  /* ---------- the buttons switch ---------- */
  await host.click('#table-views button[data-view="shape"]');
  check('the other button puts the shape back',
    (await active(host)).join() === 'shape' &&
    await host.isVisible('#table-units.units-grid'));
  check('the choice is the host\'s alone',
    (await active(guest)).join() === 'formula');
  await host.click('#table-views button[data-view="formula"]');
  check('and back again', await host.isVisible('#table-units.units-formula'));

  /* ---------- a pile fills as the game goes ---------- */
  {
    const before = await host.$$eval('#table .el-head', (n) => n.map((x) => x.textContent));
    const state = await readState(host);
    const page = pages[state.turn];
    const cards = await readCards(page);
    const here = {};
    for (const u of state.game.area.units) here[u.el] = (here[u.el] || 0) + 1;
    const atom = cards.atoms.find(
      (c) => c.el !== FUSION && formula[c.el] && (here[c.el] || 0) < formula[c.el]
    );
    await send(page, { t: 'placeUnit', cards: [atom.id] });
    await waitRev(host, state.rev);
    const after = await host.$$eval('#table .el-head', (n) => n.map((x) => x.textContent));
    check('a card laid down shows up in the count above its pile',
      before.join() !== after.join(), after.join(' | '));
  }

  for (const p of [host, guest]) await p.context().close();

  // --- a second game, to see what a molecule that is not glucose opens on --
  const two = await open(`${baseUrl}&seed=${SEED}`, 'איתי', 'host2');
  await connected(two);
  const link2 = await two.inputValue('#share');
  const phone = await open(link2, 'נועה', 'phone', PHONE);
  for (const p of [two, phone]) {
    await p.waitForFunction(() => document.querySelectorAll('#roster li').length === 2, null, { timeout: 25000 });
  }
  await two.fill('#set-atoms', '20');
  await two.fill('#set-mols', '4');
  await two.click('#start');
  for (const p of [two, phone]) {
    await p.waitForFunction(() => window.chemgame.cards()?.atoms?.length === 20, null, { timeout: 20000 });
  }
  const seats = {};
  for (const p of [two, phone]) seats[(await p.evaluate(() => window.chemgame.me())).id] = p;
  {
    const state = await readState(two);
    const page = seats[state.turn];
    const cards = await readCards(page);
    const card = cards.molecules.find((c) => c.mol === 'aceticAcid');
    const formula2 = formulaOf('aceticAcid', null);
    const atom = cards.atoms.find((c) => c.el !== FUSION && formula2[c.el]);
    await send(page, { t: 'startMolecule', molecule: card.id, cards: [atom.id] });
    await waitRev(two, state.rev);
  }
  check('any other molecule opens on its shape on a wide screen',
    (await active(two)).join() === 'shape', (await active(two)).join());
  check('and on the piles on a phone', (await active(phone)).join() === 'formula');
  check('which is what each of them is showing',
    await two.isVisible('#table-units.units-grid') &&
    await phone.isVisible('#table-units.units-formula'));

  for (const p of [two, phone]) await p.context().close();
}
