// What the host may do once a game is over: the room comes back, seats are
// added and taken away, newcomers walk in, the next game may be a different
// game, and the wins are counted across all of them.
import { openPlayer, connected } from '../support/player.mjs';
import { playToWin, seatPages } from '../support/play.mjs';

const SEED = 41;
const roster = (page, n) =>
  page.waitForFunction((want) => document.querySelectorAll('#roster li').length === want,
    n, { timeout: 25000 });

export default async function run({ check, browser, baseUrl, consoleErrors }) {
  const open = (url, name) => openPlayer({ browser, url, name, consoleErrors, label: name });

  const host = await open(`${baseUrl}&seed=${SEED}`, 'נועה');
  await connected(host);
  const link = await host.inputValue('#share');
  const guest = await open(link, 'איתי');
  await host.click('#add-bot');
  for (const p of [host, guest]) await roster(p, 3);

  await host.fill('#set-atoms', '3');
  await host.fill('#set-mols', '3');
  await host.click('#start');
  for (const p of [host, guest]) {
    await p.waitForFunction(() => window.chemgame.state()?.phase === 'game',
      null, { timeout: 20000 });
  }

  /* ---------- the first game, and the tally it leaves ---------- */

  const pages = await seatPages([host, guest]);
  const first = await playToWin(host, pages);
  check('the game ends', !!first.winner, `after ${first.moves} moves`);

  for (const p of [host, guest]) {
    await p.waitForFunction(() => document.getElementById('score').children.length > 0,
      null, { timeout: 15000 });
  }
  check('everybody sees the tally when the game ends', await guest.isVisible('#score'));
  const won = await host.evaluate(() => window.chemgame.state().order.map((p) => p.wins || 0));
  check('one game played is one win counted',
    won.reduce((a, b) => a + b, 0) === 1, won.join());
  check('and it is the winner who holds it',
    await host.evaluate(() => {
      const s = window.chemgame.state();
      return s.order.find((p) => p.id === s.game.winner).wins === 1;
    }));

  /* ---------- the room comes back ---------- */

  check('the host is offered the room again',
    await host.isVisible('#actions button[data-act="room"]'));
  check('a player who is not the host is not',
    await guest.isHidden('#actions button[data-act="room"]'));

  await host.click('#actions button[data-act="room"]');
  for (const p of [host, guest]) {
    await p.waitForSelector('#view-lobby:not(.hidden)', { timeout: 20000 });
  }
  check('everybody is back in the waiting room', true);
  check('the next game is named as such',
    (await host.textContent('#start')) === 'התחל משחק נוסף',
    await host.textContent('#start'));

  /* ---------- seats change hands ---------- */

  const late = await open(link, 'שירה');
  for (const p of [host, guest, late]) await roster(p, 4);
  check('somebody who was not in the first game may take a seat', true);

  await host.click('#add-bot');
  for (const p of [host, guest, late]) await roster(p, 5);
  check('a robot may be added between games', true);

  await host.click('#roster li:nth-child(5) .move.drop');
  for (const p of [host, guest, late]) await roster(p, 4);
  check('and taken away again', true);

  await host.click('#roster li:nth-child(4) .move.drop');
  for (const p of [host, guest]) await roster(p, 3);
  check('a player may be taken out of the room', true);
  await late.waitForSelector('#lobby-fresh:not(.hidden)', { timeout: 20000 });
  check('and is told so, with a game of his own to open instead',
    (await late.textContent('#lobby-note')).includes('הוציא'),
    await late.textContent('#lobby-note'));
  await late.waitForTimeout(6000);
  check('a seat taken out does not walk back in',
    (await host.evaluate(() => window.chemgame.state().order.length)) === 3);

  /* ---------- and the next game may be a different game ---------- */

  await host.check('#set-nospecials');
  await host.click('#start');
  for (const p of [host, guest]) {
    await p.waitForFunction(() => window.chemgame.state()?.phase === 'game',
      null, { timeout: 20000 });
  }
  check('the second game is dealt without the special cards',
    (await host.evaluate(() => window.chemgame.state().specials)) === false);
  check('the tally stayed through it all',
    (await host.evaluate(() =>
      window.chemgame.state().order.reduce((a, p) => a + (p.wins || 0), 0))) === 1);

  const second = await playToWin(host, pages);
  check('the second game ends too', !!second.winner, `after ${second.moves} moves`);
  check('and two games played are two wins counted',
    (await host.evaluate(() =>
      window.chemgame.state().order.reduce((a, p) => a + (p.wins || 0), 0))) === 2);

  for (const p of [host, guest, late]) await p.context().close();
}
