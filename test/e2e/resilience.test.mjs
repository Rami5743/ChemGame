// What happens when a browser goes away and comes back, and when the one
// browser that holds the game goes away for good.
import { candidates } from '../support/bot.mjs';
import { openPlayer, connected } from '../support/player.mjs';

const SEED = 77;

const readState = (page) => page.evaluate(() => window.chemgame.state());
const readCards = (page) => page.evaluate(() => window.chemgame.cards());
const sendMove = (page, move) => page.evaluate((m) => window.chemgame.move(m), move);
const idsOf = (cards) => [...cards.atoms, ...cards.molecules].map((c) => c.id).sort();

export default async function run({ check, browser, baseUrl, consoleErrors }) {
  const open = (url, name) => openPlayer({ browser, url, name, consoleErrors, label: name });

  const host = await open(`${baseUrl}&seed=${SEED}`, 'יואב');
  await connected(host);
  const link = await host.inputValue('#share');
  const a = await open(link, 'מאיה');
  const b = await open(link, 'גיא');
  for (const p of [host, a, b]) {
    await p.waitForFunction(() => document.querySelectorAll('#roster li').length === 3, null, { timeout: 25000 });
  }
  await host.fill('#set-atoms', '8');
  await host.click('#start');
  for (const p of [host, a, b]) {
    await p.waitForFunction(() => window.chemgame.state()?.phase === 'game', null, { timeout: 20000 });
  }

  const pages = {};
  for (const p of [host, a, b]) pages[(await p.evaluate(() => window.chemgame.me())).id] = p;

  const playOne = async () => {
    const state = await readState(host);
    if (state.game.winner) return false;
    const actor = state.game.phase === 'takeback' ? state.game.takeback.pending[0] : state.turn;
    const page = pages[actor];
    const cards = await readCards(page);
    for (const move of candidates(state, cards)) {
      if (!(await sendMove(page, move))) {
        await host.waitForFunction((r) => window.chemgame.state()?.rev > r, state.rev, { timeout: 15000 });
        return true;
      }
    }
    return false;
  };

  for (let i = 0; i < 4; i++) await playOne();

  /* ---------- a player reloads in the middle ---------- */
  {
    const before = idsOf(await readCards(a));
    const tableBefore = (await readState(a)).game.area;
    await a.reload();
    await a.waitForFunction(() => window.chemgame?.state()?.phase === 'game', null, { timeout: 25000 });
    await a.waitForFunction(() => window.chemgame.cards()?.atoms?.length > 0, null, { timeout: 20000 });
    check('a reload walks straight back in, with no name to type again',
      await a.isHidden('#view-name'));
    check('the same hand comes back', JSON.stringify(idsOf(await readCards(a))) === JSON.stringify(before));
    const after = (await readState(a)).game.area;
    check('the table is where it was', JSON.stringify(after) === JSON.stringify(tableBefore));
    check('the seat list is whole', (await a.$$('#players li')).length === 3);
  }
  check('the game goes on after the reload', await playOne());

  /* ---------- a move made while the connection is asleep ---------- */
  {
    const state = await readState(host);
    const actor = state.game.phase === 'takeback' ? state.game.takeback.pending[0] : state.turn;
    const page = pages[actor];
    if (page !== host) {
      const cards = await readCards(page);
      const [move] = candidates(state, cards);
      if (move) {
        // The page is cut off, makes its move, and is let back in. Nothing
        // told it the move was lost, so it must say it again by itself.
        await page.context().setOffline(true);
        const said = page.evaluate((m) => window.chemgame.move(m), move);
        await page.waitForTimeout(1200);
        await page.context().setOffline(false);
        const answer = await Promise.race([
          said,
          new Promise((r) => setTimeout(() => r('timed out'), 20000)),
        ]);
        check('a move made while the connection was asleep still arrives',
          answer === null, String(answer));
      }
    }
  }

  /* ---------- a player disappears ---------- */
  {
    const gone = (await b.evaluate(() => window.chemgame.me())).id;
    await b.context().close();
    // A player is given five missed heartbeats before he counts as gone.
    await host.waitForSelector('#players li.gone', { timeout: 45000 });
    const marked = await host.$$eval('#players li.gone .who', (n) => n.map((x) => x.textContent));
    check('the player who left is marked in the seat list', marked.length === 1 && marked[0].includes('גיא'), marked.join());
    check('his seat is still his', (await host.$$('#players li')).length === 3, gone);
  }

  /* ---------- the host disappears ---------- */
  {
    check('nothing is wrong while the host is there', await a.isHidden('#alert'));
    await host.context().close();
    await a.waitForSelector('#alert:not(.hidden)', { timeout: 40000 });
    const text = await a.textContent('#alert');
    check('the others are told the host is gone, in words', text.includes('המארח'), text);
    check('the game screen is still there to look at', await a.isVisible('#view-game'));
  }

  await a.context().close();
}
