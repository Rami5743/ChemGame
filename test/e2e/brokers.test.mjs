// The case a phone runs into: the host can reach brokers the player cannot.
// They must still find each other, as long as one broker is common to both.
import { startBroker } from '../support/broker.mjs';
import { openPlayer, connected } from '../support/player.mjs';

const DEAD = 'ws://127.0.0.1:9199/mqtt'; // nothing listens here

export default async function run({ check, browser, baseUrl, consoleErrors }) {
  const site = baseUrl.split('?')[0];
  const first = baseUrl.split('broker=')[1];
  const second = await startBroker(9131);
  const open = (url, name, label) => openPlayer({ browser, url, name, consoleErrors, label });
  const pages = [];

  try {
    // The host holds both brokers.
    const host = await open(`${site}?broker=${first},${second.url}`, 'מארח', 'host');
    pages.push(host);
    await connected(host);
    const room = (await host.inputValue('#share')).split('#')[1];
    check('the host comes up on the brokers it can reach', !!room);

    // This player can reach only the second of them.
    const guest = await open(`${site}?broker=${second.url}#${room}`, 'אורח', 'guest');
    pages.push(guest);
    await connected(guest);
    for (const p of [host, guest]) {
      await p.waitForFunction(() => document.querySelectorAll('#roster li').length === 2, null, { timeout: 25000 });
    }
    check('a player on only one of the brokers still reaches the host', true);

    // And this one has a broker that never answers at the head of its list.
    const slow = await open(`${site}?broker=${DEAD},${second.url}#${room}`, 'סבלני', 'slow');
    pages.push(slow);
    await slow.waitForFunction(() => document.getElementById('status').dataset.state === 'on', null, { timeout: 30000 });
    check('a broker that never answers is passed over', true);
    for (const p of [host, guest, slow]) {
      await p.waitForFunction(() => document.querySelectorAll('#roster li').length === 3, null, { timeout: 25000 });
    }
    check('and that player joins the room all the same', true);

    // The diagnostic says what it found.
    await slow.click('#status');
    await slow.waitForSelector('#alert:not(.hidden)', { timeout: 5000 });
    const report = await slow.textContent('#alert');
    check('tapping the chip lists the brokers', report.includes('127.0.0.1:9131'), report);
    // The one that never answered is given its time first, and only then is
    // it named as such; the list keeps itself up to date while it is open.
    await slow.waitForFunction(
      () => document.getElementById('alert').textContent.includes('לא ענה'),
      null, { timeout: 20000 }).catch(() => {});
    check('the one that never answered is named as such',
      (await slow.textContent('#alert')).includes('לא ענה'), await slow.textContent('#alert'));
    await slow.click('#status');
    check('tapping it again puts the list away', await slow.isHidden('#alert'));

    // A player who can reach both brokers hears everything twice. His move
    // must still be one move.
    const twice = await open(`${site}?broker=${first},${second.url}#${room}`, 'כפול', 'twice');
    pages.push(twice);
    await connected(twice);
    for (const p of [host, guest, slow, twice]) {
      await p.waitForFunction(() => document.querySelectorAll('#roster li').length === 4, null, { timeout: 25000 });
    }
    // He goes first, so his is the move the game opens with.
    await host.click('#roster li:nth-child(4) button.move >> nth=0');
    await host.click('#roster li:nth-child(3) button.move >> nth=0');
    await host.click('#roster li:nth-child(2) button.move >> nth=0');
    await twice.waitForFunction(
      () => document.querySelector('#roster .who').textContent === 'כפול',
      null, { timeout: 15000 });

    // A game dealt across two brokers reaches everybody.
    await host.fill('#set-atoms', '4');
    await host.click('#start');
    for (const p of [host, guest, slow, twice]) {
      await p.waitForFunction(() => window.chemgame.cards()?.atoms?.length === 4, null, { timeout: 25000 });
    }
    check('the game is dealt across the brokers', true);
    const seats = await slow.$$eval('#players li', (n) => n.length);
    check('all four are seated', seats === 4, String(seats));

    const before = await host.evaluate(() => window.chemgame.state().game.molDeck);
    const said = await twice.evaluate(() =>
      window.chemgame.move({ t: 'drawFive', kind: 'molecules' }));
    check('his move is accepted', said === null, String(said));
    await host.waitForFunction(
      (n) => window.chemgame.state().game.molDeck !== n, before, { timeout: 15000 });
    const after = await host.evaluate(() => window.chemgame.state().game.molDeck);
    check('a move heard on two brokers is played once, not twice',
      after === before - 5, `${before} -> ${after}`);
  } finally {
    for (const p of pages) await p.context().close().catch(() => {});
    await second.close();
  }
}
