// The whole game sits in the host's page, so a table of robots needs no
// network at all. Here every address is dead and the game is played anyway.
import { openPlayer } from '../support/player.mjs';
import { playToWin } from '../support/play.mjs';

const DEAD = 'ws://127.0.0.1:9198/mqtt'; // nothing listens here, ever

export default async function run({ check, browser, baseUrl, consoleErrors }) {
  const site = baseUrl.split('?')[0];
  const host = await openPlayer({
    browser,
    url: `${site}?broker=${DEAD}&seed=19`,
    name: 'לבד',
    consoleErrors,
    label: 'offline',
  });

  // Nothing to wait for: the host hears himself, so the room is on the screen
  // long before any address could have been given up on.
  await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 1,
    null, { timeout: 5000 });
  check('the host sees his own room although nothing answered', true);
  check('and is not told he is connected',
    (await host.getAttribute('#status', 'data-state')) !== 'on',
    await host.getAttribute('#status', 'data-state'));

  await host.click('#add-bot');
  await host.click('#add-bot');
  await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 3,
    null, { timeout: 5000 });
  check('robots can be seated with no server in reach', true);

  await host.fill('#set-atoms', '4');
  await host.fill('#set-mols', '2');
  await host.click('#start');
  await host.waitForFunction(() => window.chemgame.state()?.phase === 'game',
    null, { timeout: 10000 });
  await host.waitForFunction(() => window.chemgame.cards()?.atoms?.length === 4,
    null, { timeout: 10000 });
  check('the cards are dealt to the host himself', true);

  const me = await host.evaluate(() => window.chemgame.me());
  const { winner, moves } = await playToWin(host, { [me.id]: host });
  check('a game against robots is played out to a winner', !!winner, `after ${moves} moves`);
  check('and the tally is on the screen when it ends', await host.isVisible('#score'));

  // Being cut off costs company, not the game, and the page says so.
  await host.waitForSelector('#alert:not(.hidden)', { timeout: 30000 });
  const said = await host.textContent('#alert');
  check('the host is told what being cut off does and does not cost',
    said.includes('רובוטים'), said);

  await host.context().close();
}
