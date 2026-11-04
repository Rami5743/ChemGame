// Ends a game and starts another one with the same players.
import { candidates } from '../support/bot.mjs';
import { openPlayer, connected } from '../support/player.mjs';

const SEED = 31;

const readState = (page) => page.evaluate(() => window.chemgame.state());
const readCards = (page) => page.evaluate(() => window.chemgame.cards());
const sendMove = (page, move) => page.evaluate((m) => window.chemgame.move(m), move);

export default async function run({ check, browser, baseUrl, consoleErrors }) {
  const open = (url, name) => openPlayer({ browser, url, name, consoleErrors, label: name });

  const host = await open(`${baseUrl}&seed=${SEED}`, 'עמית');
  await connected(host);
  const link = await host.inputValue('#share');
  const guest = await open(link, 'טל');
  for (const p of [host, guest]) {
    await p.waitForFunction(() => document.querySelectorAll('#roster li').length === 2, null, { timeout: 25000 });
  }
  await host.fill('#set-atoms', '3');
  await host.fill('#set-mols', '3');
  await host.click('#start');
  for (const p of [host, guest]) {
    await p.waitForFunction(() => window.chemgame.state()?.phase === 'game', null, { timeout: 20000 });
  }

  const pages = {};
  for (const p of [host, guest]) pages[(await p.evaluate(() => window.chemgame.me())).id] = p;
  const firstCards = await readCards(host);

  // --- play until somebody wins -------------------------------------------
  let moves = 0;
  while (moves < 400) {
    const state = await readState(host);
    if (state.game.winner) break;
    const actor = state.game.phase === 'takeback' ? state.game.takeback.pending[0] : state.turn;
    const page = pages[actor];
    const cards = await readCards(page);
    let acted = false;
    for (const move of candidates(state, cards)) {
      if (!(await sendMove(page, move))) {
        acted = true;
        await host.waitForFunction((r) => window.chemgame.state()?.rev > r, state.rev, { timeout: 15000 });
        break;
      }
    }
    moves += 1;
    if (!acted) break;
  }
  const ended = await readState(host);
  check('the game ends', !!ended.game.winner, `after ${moves} moves`);

  // --- what the end looks like --------------------------------------------
  check('the host is offered another game', await host.isVisible('#actions button[data-act="again"]'));
  check('a player who is not the host is not', await guest.isHidden('#actions button[data-act="again"]'));
  check('the host may change the deal before dealing again', await host.isVisible('#again-atoms'));
  check('nobody is framed as being in turn', (await host.$$('#players li.turn')).length === 0);

  // --- another game, same players, a different deal ------------------------
  const beforeRev = ended.rev;
  const seatsBefore = await host.$$eval('#players .who', (n) => n.map((x) => x.textContent));
  await host.fill('#again-atoms', '5');
  await host.fill('#again-mols', '2');
  await host.click('#actions button[data-act="again"]');
  await host.waitForFunction((r) => window.chemgame.state()?.rev > r, beforeRev, { timeout: 15000 });
  for (const p of [host, guest]) {
    await p.waitForFunction(() => window.chemgame.cards()?.atoms?.length === 5, null, { timeout: 20000 });
  }

  const again = await readState(host);
  check('the new deal is the one the host typed',
    again.deal.atoms === 5 && again.deal.molecules === 2, JSON.stringify(again.deal));
  check('both players hold five atoms and two molecules',
    (await readCards(guest)).molecules.length === 2);
  check('there is no winner any more', !again.game.winner);
  check('the table is empty', again.game.area.molecule === null && again.game.area.units.length === 0);
  check('the decks are full again',
    again.game.atomDeck === 72 - 10 && again.game.molDeck === 36 - 4,
    `${again.game.atomDeck} / ${again.game.molDeck}`);
  check('nothing was left in the discards', again.game.atomDiscard === 0 && again.game.molDiscard === 0);
  check('the seats are the same players in the same order',
    JSON.stringify(await host.$$eval('#players .who', (n) => n.map((x) => x.textContent))) ===
      JSON.stringify(seatsBefore));
  check('somebody is in turn again', (await host.$$('#players li.turn')).length === 1);

  const newCards = await readCards(host);
  const old = new Set(firstCards.atoms.map((c) => c.id));
  check('the cards were dealt afresh, not handed back',
    newCards.atoms.some((c) => !old.has(c.id)), 'identical hand');

  // --- the room is still closed -------------------------------------------
  const late = await open(link, 'חדש');
  await late.waitForSelector('#view-game:not(.hidden)', { timeout: 25000 });
  check('a newcomer still cannot take a seat', (await host.$$eval('#players li', (n) => n.length)) === 2);

  // --- and it can be played ------------------------------------------------
  {
    const state = await readState(host);
    const page = pages[state.turn];
    const cards = await readCards(page);
    let acted = false;
    for (const move of candidates(state, cards)) {
      if (!(await sendMove(page, move))) { acted = true; break; }
    }
    check('a move in the new game is accepted', acted);
  }

  for (const p of [host, guest, late]) await p.context().close();
}
