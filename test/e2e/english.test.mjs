// The same game in English: the words, the English card faces, and the flag
// that switches between the two.
import { FUSION } from '../../js/cards.js';
import { formulaOf, isPartOf } from '../../js/rules.js';
import { candidates, compositionOf } from '../support/bot.mjs';
import { openPlayer, connected } from '../support/player.mjs';

const SEED = 22;
const readState = (page) => page.evaluate(() => window.chemgame.state());
const readCards = (page) => page.evaluate(() => window.chemgame.cards());
const sendMove = (page, move) => page.evaluate((m) => window.chemgame.move(m), move);

export default async function run({ check, browser, baseUrl, consoleErrors }) {
  const url = `${baseUrl}&lang=en&seed=${SEED}`;

  // --- the entry screen ----------------------------------------------------
  const ctx = await browser.newContext();
  const first = await ctx.newPage();
  await first.goto(url);
  check('the entry screen is in English', (await first.textContent('#name-title')) === 'New game');
  check('so is the button', (await first.textContent('#name-go')) === 'Create a game');
  check('the page is left to right', (await first.getAttribute('html', 'dir')) === 'ltr');
  check('the English flag is the one marked', await first.isVisible('.flag[data-lang="en"].active'));
  await ctx.close();

  const open = (where, name, label) => openPlayer({ browser, url: where, name, consoleErrors, label });

  const host = await open(url, 'Dana', 'host');
  await connected(host);
  check('the lobby is in English', (await host.textContent('#view-lobby h2')) === 'Waiting room');
  check('and the start button', (await host.textContent('#start')) === 'Start the game');

  const link = await host.inputValue('#share');
  check('the link does not force a language on anyone', !link.includes('lang='), link);

  const room = link.split('#')[1];
  const guest = await open(`${baseUrl}&lang=en#${room}`, 'Ram', 'guest');
  await connected(guest);
  for (const p of [host, guest]) {
    await p.waitForFunction(() => document.querySelectorAll('#roster li').length === 2, null, { timeout: 25000 });
  }

  await host.fill('#set-atoms', '6');
  await host.click('#start');
  for (const p of [host, guest]) {
    await p.waitForFunction(() => window.chemgame.cards()?.atoms?.length === 6, null, { timeout: 20000 });
  }

  const srcs = await host.$$eval('#hand-atoms img', (n) => n.map((i) => i.getAttribute('src')));
  check('the cards are the English faces',
    srcs.length === 6 && srcs.every((s) => s.startsWith('assets/cards/en/')), srcs[0]);
  check('the headings are in English',
    (await host.textContent('#view-game h3')) === 'Order of play');

  // --- a refusal comes back in English -------------------------------------
  {
    const pages = {};
    for (const p of [host, guest]) pages[(await p.evaluate(() => window.chemgame.me())).id] = p;
    // open a molecule first, so there is something to refuse an atom against
    let guard = 0;
    while (guard++ < 12) {
      const state = await readState(host);
      if (state.game.phase === 'building') break;
      const actor = state.game.phase === 'takeback' ? state.game.takeback.pending[0] : state.turn;
      const page = pages[actor];
      const cards = await readCards(page);
      for (const m of candidates(state, cards)) {
        if (!(await sendMove(page, m))) break;
      }
      await host.waitForFunction((r) => window.chemgame.state()?.rev > r, state.rev, { timeout: 15000 });
    }
    const state = await readState(host);
    const page = pages[state.turn];
    const cards = await readCards(page);
    const formula = formulaOf(state.game.area.molecule, state.game.area.alkaneN);
    const here = compositionOf(state.game.area.units);
    const bad = cards.atoms.find(
      (c) => c.el !== FUSION && !isPartOf({ ...here, [c.el]: (here[c.el] || 0) + 1 }, formula)
    );
    if (bad) {
      const said = await sendMove(page, { t: 'placeUnit', cards: [bad.id] });
      check('a refused move is explained in English', /does not fit/.test(said), String(said));
    } else {
      check('a refused move is explained in English', true, 'no unfitting atom to try');
    }
  }

  // --- the flag switches back, in the middle of the game -------------------
  {
    const before = await readState(host);
    const hand = (await readCards(host)).atoms.map((c) => c.id).sort();

    await host.click('.flag[data-lang="he"]');
    await host.waitForFunction(() => document.documentElement.dir === 'rtl', null, { timeout: 15000 });
    check('the Hebrew flag puts the page back into Hebrew', true);
    check('and the room is still the same', (await host.evaluate(() => location.hash)).includes(room));
    check('the language is remembered in the address',
      (await host.evaluate(() => location.search)).includes('lang=he'));

    // The host carries the game. A switch that reloaded the page would end it.
    check('the game is still on the screen', await host.isVisible('#view-game'));
    const after = await readState(host);
    check('the same game, at the same point', after.rev >= before.rev && !after.game.winner);
    check('the hand did not change hands',
      (await readCards(host)).atoms.map((c) => c.id).sort().join() === hand.join());
    check('the cards turned over to the Hebrew faces',
      (await host.$$eval('#hand-atoms img', (n) => n.map((i) => i.getAttribute('src'))))
        .every((s) => s.startsWith('assets/cards/he/')));
    check('the headings turned with them',
      (await host.textContent('#view-game h3')) === 'סדר השחקנים');

    // The other player was not switched with him.
    check('the other player is still in English',
      (await guest.evaluate(() => document.documentElement.dir)) === 'ltr');
    check('and the English cards stayed his',
      (await guest.$$eval('#hand-atoms img', (n) => n.map((i) => i.getAttribute('src'))))
        .every((s) => s.startsWith('assets/cards/en/')));
  }

  for (const p of [host, guest]) await p.context().close();
}
