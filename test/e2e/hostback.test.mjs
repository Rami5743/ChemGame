// The host's page is the game. A browser that puts the tab away and brings
// it back must find the game where it was.
import { candidates } from '../support/bot.mjs';
import { openPlayer, connected } from '../support/player.mjs';

const readState = (page) => page.evaluate(() => window.chemgame.state());
const readCards = (page) => page.evaluate(() => window.chemgame.cards());
const send = (page, move) => page.evaluate((m) => window.chemgame.move(m), move);

export default async function run({ check, browser, baseUrl, consoleErrors }) {
  const open = (url, name, label) => openPlayer({ browser, url, name, consoleErrors, label });

  const host = await open(`${baseUrl}&seed=8`, 'אורי', 'host');
  await connected(host);
  const link = await host.inputValue('#share');
  const guest = await open(link, 'נועה', 'guest');
  await host.click('#add-bot');
  for (const p of [host, guest]) {
    await p.waitForFunction(() => document.querySelectorAll('#roster li').length === 3,
      null, { timeout: 25000 });
  }
  await host.fill('#set-atoms', '6');
  await host.click('#start');
  for (const p of [host, guest]) {
    await p.waitForFunction(() => window.chemgame.state()?.phase === 'game',
      null, { timeout: 20000 });
  }

  const people = {};
  for (const p of [host, guest]) people[(await p.evaluate(() => window.chemgame.me())).id] = p;

  // Play a few turns, so that there is a game worth coming back to.
  const playOne = async () => {
    const state = await readState(host);
    if (state.game.winner) return false;
    const whose = state.game.phase === 'takeback'
      ? state.game.takeback.pending[0] : state.turn;
    const page = people[whose];
    if (!page) {
      await host.waitForFunction((r) => window.chemgame.state().rev > r, state.rev,
        { timeout: 12000 }).catch(() => {});
      return true;
    }
    for (const move of candidates(state, await readCards(page))) {
      if (!(await send(page, move))) {
        await host.waitForFunction((r) => window.chemgame.state().rev > r, state.rev,
          { timeout: 12000 }).catch(() => {});
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < 5; i += 1) await playOne();

  const before = await readState(host);
  check('a game is under way before the tab is put away', before.rev > 1, String(before.rev));

  /* ---------- the host's tab is reloaded ---------- */
  await host.reload();
  await host.waitForFunction(() => !!window.chemgame.state(), null, { timeout: 25000 });
  check('the host comes back into the game, with no name to type again',
    await host.isVisible('#view-game'));

  const after = await readState(host);
  check('he is the host again', after.host === before.host, `${after.host} vs ${before.host}`);
  check('it is the same game, where it was',
    after.game.area.molecule === before.game.area.molecule &&
    after.game.area.units.length === before.game.area.units.length,
    JSON.stringify({ was: before.game.area.units.length, now: after.game.area.units.length }));
  check('and the count goes on from where it stopped, under the same mark',
    after.epoch === before.epoch && after.rev >= before.rev,
    JSON.stringify({ epoch: after.epoch === before.epoch, rev: `${before.rev}->${after.rev}` }));
  check('the seats are all still there, the robot among them',
    after.order.length === 3 && after.order.some((p) => p.bot));

  // The other player never knew anything happened.
  await guest.waitForFunction((r) => window.chemgame.state().rev > r, before.rev,
    { timeout: 20000 });
  check('the other player hears from him again', true);

  /* ---------- and the game goes on ---------- */
  let moved = false;
  for (let i = 0; i < 8 && !moved; i += 1) {
    const state = await readState(host);
    if (state.game.winner) break;
    const whose = state.game.phase === 'takeback'
      ? state.game.takeback.pending[0] : state.turn;
    const page = people[whose];
    if (!page) {
      // A robot of the host's: it must have taken the game up again too.
      moved = await host.waitForFunction((r) => window.chemgame.state().rev > r, state.rev,
        { timeout: 12000 }).then(() => true).catch(() => false);
      break;
    }
    for (const move of candidates(state, await readCards(page))) {
      if (!(await send(page, move))) {
        moved = true;
        break;
      }
    }
  }
  check('a move still goes through after the host came back', moved);

  for (const p of [host, guest]) await p.context().close();
}
