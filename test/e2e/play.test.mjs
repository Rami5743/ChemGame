// Plays a game the way a person does: choose a move, then pick its cards.
import { FUSION, MOLECULES } from '../../js/cards.js';
import { formulaOf, isPartOf } from '../../js/rules.js';
import { candidates, compositionOf } from '../support/bot.mjs';
import { openPlayer, connected } from '../support/player.mjs';

// This shuffle deals the first player a fusion card, a hydrogen and molecules
// that take one, so the fused placement really happens.
const SEED = 22;

const card = (scope, id) => `${scope} .cardbtn[data-id="${id}"]`;
const action = (name) => `#actions button[data-act="${name}"]`;
const readState = (page) => page.evaluate(() => window.chemgame.state());
const readCards = (page) => page.evaluate(() => window.chemgame.cards());

async function clickMove(page, move) {
  switch (move.t) {
    case 'startMolecule':
    case 'swapMolecule':
      await page.click(action(move.t === 'startMolecule' ? 'open' : 'swap'));
      await page.click(card('#hand-mols', move.molecule));
      if (move.alkaneN !== undefined) await page.fill('#alkane-n', String(move.alkaneN));
      for (const id of move.cards) await page.click(card('#hand-atoms', id));
      if (move.cards.length > 1) await page.click(action('confirm'));
      break;
    case 'placeUnit':
      // A plain atom goes down on the click itself; a fusion gathers a group
      // around the fusion card, which the bot always names first.
      for (const id of move.cards) await page.click(card('#hand-atoms', id));
      if (move.cards.length > 1) await page.click(action('confirm'));
      break;
    case 'drawAtom':
      await page.click(action('draw'));
      break;
    case 'pass':
      await page.click(action('pass'));
      break;
    case 'drawFive':
      await page.click(action(move.kind === 'atoms' ? 'fiveAtoms' : 'fiveMolecules'));
      break;
    case 'pick':
      await page.click(card('#overlay-cards', move.card));
      break;
    case 'takeBack':
      if (move.card) {
        await page.click(action('takeOne'));
        await page.click(card('#table-units', move.card));
      } else {
        await page.click(action('takeNothing'));
      }
      break;
    default:
      throw new Error('no click for ' + move.t);
  }
}

const giveUp = async (page) => {
  if (await page.isVisible(action('cancel'))) await page.click(action('cancel'));
  for (const el of await page.$$('.cardbtn.chosen')) await el.click().catch(() => {});
};

export default async function run({ check, browser, baseUrl, consoleErrors }) {
  const open = (url, name) => openPlayer({ browser, url, name, consoleErrors, label: name });

  const host = await open(`${baseUrl}&seed=${SEED}`, 'איתי');
  await connected(host);
  const link = await host.inputValue('#share');
  const guest = await open(link, 'שירה');
  for (const p of [host, guest]) {
    await p.waitForFunction(() => document.querySelectorAll('#roster li').length === 2, null, { timeout: 25000 });
  }
  await host.fill('#set-atoms', '6');
  await host.fill('#set-mols', '3');
  await host.click('#start');
  for (const p of [host, guest]) {
    await p.waitForFunction(() => document.querySelectorAll('#hand-atoms .cardbtn').length === 6, null, { timeout: 20000 });
  }

  const pages = {};
  for (const p of [host, guest]) pages[(await p.evaluate(() => window.chemgame.me())).id] = p;
  const waitRev = (rev) =>
    host.waitForFunction((r) => window.chemgame.state()?.rev > r, rev, { timeout: 15000 });

  /* ---------- the cards are pictures ---------- */
  const srcs = await host.$$eval('#hand-atoms img', (n) => n.map((i) => i.getAttribute('src')));
  check('a hand is drawn with the printed card art',
    srcs.length === 6 && srcs.every((s) => s.startsWith('assets/cards/he/atom-')), srcs[0]);
  await host.waitForFunction(
    () => [...document.querySelectorAll('#hand-atoms img')].every((i) => i.complete && i.naturalWidth > 0),
    null, { timeout: 15000 }).catch(() => {});
  const loaded = await host.$$eval('#hand-atoms img', (n) => n.every((i) => i.complete && i.naturalWidth > 0));
  check('the card pictures actually load', loaded);
  check('all four piles are shown', (await host.$$('#decks .pile')).length === 4);

  /* ---------- a move is chosen before its cards ---------- */
  {
    check('before a move is chosen, no card can be picked up',
      (await host.$$('.cardbtn.pickable')).length === 0);

    check('the button that opens a molecule is named for what it does',
      (await host.textContent(action('open'))) === 'פתח מולקולה');
    await host.click(action('open'));
    check('the screen says which card it wants',
      (await host.textContent('#turn-banner')).includes('מולקולה'));
    check('only the molecules can be picked up now',
      (await host.$$('#hand-mols .cardbtn.pickable')).length > 0 &&
      (await host.$$('#hand-atoms .cardbtn.pickable')).length === 0);
    check('the cards that are not wanted yet are faded',
      (await host.$$('#hand-atoms .cardbtn.dim')).length === 6);

    const mine = await readCards(host);
    const m = mine.molecules[0].id;
    await host.click(card('#hand-mols', m));
    check('the chosen card is marked', await host.isVisible(`${card('#hand-mols', m)}.chosen`));
    await host.click(card('#hand-mols', m));
    check('clicking it again lets it go', !(await host.isVisible(`${card('#hand-mols', m)}.chosen`)));

    await host.click(card('#hand-mols', m));
    check('the screen now asks for an atom',
      (await host.textContent('#turn-banner')).includes('אטום'));
    check('and the atoms are the ones that can be picked up',
      (await host.$$('#hand-atoms .cardbtn.pickable')).length === 6);
    check('there is nothing left to confirm', (await host.$$(action('confirm'))).length === 0);

    await host.click(action('cancel'));
    check('cancelling drops the whole move', (await host.$$('.cardbtn.chosen')).length === 0);
    check('and the buttons come back', await host.isVisible(action('open')));
  }
  check('the player who is not in turn has no buttons',
    (await guest.$$('#actions button')).length === 0);

  /* ---------- five cards, keep one ---------- */
  {
    const held = (await readCards(host)).molecules.length;
    await host.click(action('fiveMolecules'));
    await host.waitForSelector('#overlay:not(.hidden)', { timeout: 10000 });
    const five = await host.$$('#overlay-cards .cardbtn');
    check('drawing five opens the choice', five.length === 5, five.length);
    check('nobody else sees the choice', await guest.isHidden('#overlay'));
    const beforePick = (await readState(host)).rev;
    const which = (await readCards(host)).pick.cards[2].id;
    await host.click(card('#overlay-cards', which));
    await waitRev(beforePick);
    check('the choice closes once one is kept', await host.isHidden('#overlay'));
    check('the kept card joined the hand', (await readCards(host)).molecules.length === held + 1);
    check('the other four were discarded', (await readState(host)).game.molDiscard === 4);
    check('the discard pile shows its top card face up',
      (await host.$$eval('#decks .pile img', (n) => n.map((i) => i.getAttribute('src'))))
        .some((src) => src.includes('mol-')));
  }

  /* ---------- playing it out ---------- */
  let moves = 0;
  let stuck = '';
  let sawFused = false;
  let sawRefusal = false;
  let tookBack = false;
  let sawAlkaneField = false;
  let sawShape = false;
  let sawFusionPrompt = false;
  let sawOneClickPlace = false;

  while (moves < 300) {
    const state = await readState(host);
    const g = state.game;
    if (g.winner) break;

    if (g.area.molecule && !sawShape) {
      const empties = await host.$$('#table-units .slot-empty');
      if (empties.length) sawShape = true;
    }

    const actor = g.phase === 'takeback' ? g.takeback.pending[0] : state.turn;
    const page = pages[actor];
    const cards = await readCards(page);

    // Once, try a card that cannot go there, and watch it be refused.
    if (!sawRefusal && g.phase === 'building') {
      const formula = formulaOf(g.area.molecule, g.area.alkaneN);
      const here = compositionOf(g.area.units);
      const bad = cards.atoms.find(
        (c) => c.el !== FUSION && !isPartOf({ ...here, [c.el]: (here[c.el] || 0) + 1 }, formula)
      );
      if (bad) {
        const unitsBefore = (await page.$$('#table-units .unit')).length;
        check('while a molecule is being built the cards are live with no button first',
          (await page.$$('#hand-atoms .cardbtn.pickable')).length > 0);
        check('and laying is already the move under way',
          await page.isVisible(`${action('place')}.active`));
        await page.click(card('#hand-atoms', bad.id));
        await page.waitForSelector('#game-note.error', { timeout: 10000 });
        check('an atom that does not fit is refused, with a reason on screen',
          (await page.textContent('#game-note')).length > 0);
        check('the refused card changed nothing on the table',
          (await page.$$('#table-units .unit')).length === unitsBefore);
        await giveUp(page);
        sawRefusal = true;
      }
    }

    // Take a card back by clicking it, the first time that is possible.
    let move = null;
    if (g.phase === 'takeback' && !tookBack) {
      const mine = g.area.units.find((u) => u.by === actor && u.cards.some((c) => c.el !== FUSION));
      if (mine) {
        move = { t: 'takeBack', card: mine.cards.find((c) => c.el !== FUSION).id };
        tookBack = true;
      }
    }

    const tries = move ? [move] : candidates(state, cards);
    let acted = false;
    for (const m of tries) {
      // The first fusion of the game: look at what choosing the card does
      // before actually going through with it.
      if (!sawFusionPrompt && m.t === 'placeUnit' && m.cards.length > 1) {
        await page.click(card('#hand-atoms', m.cards[0]));
        check('choosing the fusion card asks for the atoms to fuse with it',
          (await page.textContent('#turn-banner')).includes('היתוך'));
        check('and the confirm waits for at least one of them',
          await page.isDisabled(action('confirm')));
        await page.click(action('cancel'));
        sawFusionPrompt = true;
      }
      if (m.t === 'startMolecule' || m.t === 'swapMolecule') {
        const molId = cards.molecules.find((c) => c.id === m.molecule)?.mol;
        if (MOLECULES[molId]?.special === 'alkanes') {
          await page.click(action(m.t === 'startMolecule' ? 'open' : 'swap'));
          await page.click(card('#hand-mols', m.molecule));
          if (await page.isVisible('#alkane-n')) sawAlkaneField = true;
          await giveUp(page);
        }
      }
      try {
        await clickMove(page, m);
      } catch {
        await giveUp(page);
        continue;
      }
      try {
        await waitRev(state.rev);
        acted = true;
      } catch {
        await giveUp(page);
        continue;
      }
      if (m.cards && m.cards.length > 1) sawFused = true;
      if (m.t === 'placeUnit' && m.cards.length === 1) sawOneClickPlace = true;
      break;
    }
    moves += 1;
    if (!acted) { stuck = `stuck in ${g.phase} after ${moves} moves`; break; }
  }

  const final = await readState(host);
  check('a game played only with clicks reaches a winner', !!final.game.winner, stuck || `${moves} moves`);
  check('a fused placement was made', sawFused);
  check('a plain atom was laid by one click, with nothing to confirm', sawOneClickPlace);
  check('the fusion asked for its atoms first', sawFusionPrompt);
  check('an illegal placement was refused on screen', sawRefusal);
  check('a card was taken back by clicking it', tookBack);
  check('the alkane declaration appears when that card is chosen', sawAlkaneField);
  check('the table showed the shape of the molecule, with the spots still missing', sawShape);

  for (const p of [host, guest]) {
    await p.waitForFunction(() => !!window.chemgame.state()?.game?.winner, null, { timeout: 15000 });
    const banner = await p.textContent('#turn-banner');
    check('both players see how it ended', banner.includes('ניצח') || banner.includes('ניצחת'), banner);
  }
  check('the winner has no atom cards left',
    final.order.find((s) => s.id === final.game.winner)?.atoms === 0);

  for (const p of [host, guest]) await p.context().close();
}
