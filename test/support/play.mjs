// Plays a game out to its end. The suites that care about what comes after a
// game need one played first, and they all need it played the same way.
import { candidates } from './bot.mjs';

const readState = (page) => page.evaluate(() => window.chemgame.state());
const readCards = (page) => page.evaluate(() => window.chemgame.cards());
const sendMove = (page, move) => page.evaluate((m) => window.chemgame.move(m), move);

// `pages` maps a seat to the browser page that plays it. A seat with no page
// is a robot: the host moves for it, so its turn is waited out, not played.
export async function playToWin(host, pages, limit = 400) {
  let moves = 0;
  while (moves < limit) {
    const state = await readState(host);
    if (!state || !state.game) break;
    if (state.game.winner) break;

    const actor = state.game.phase === 'takeback' ? state.game.takeback.pending[0] : state.turn;
    const page = pages[actor];
    moves += 1;
    if (!page) {
      await host.waitForFunction((r) => window.chemgame.state()?.rev > r, state.rev,
        { timeout: 15000 }).catch(() => {});
      continue;
    }

    const cards = await readCards(page);
    let acted = false;
    for (const move of candidates(state, cards)) {
      if (!(await sendMove(page, move))) {
        acted = true;
        await host.waitForFunction((r) => window.chemgame.state()?.rev > r, state.rev,
          { timeout: 15000 });
        break;
      }
    }
    if (!acted) break;
  }
  const end = await readState(host);
  return { winner: end?.game?.winner || null, moves };
}

// Who is at the table, by seat, so that playToWin knows which page to ask.
export async function seatPages(list) {
  const pages = {};
  for (const p of list) pages[(await p.evaluate(() => window.chemgame.me())).id] = p;
  return pages;
}
