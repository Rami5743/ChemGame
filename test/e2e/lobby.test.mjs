import { openPlayer, connected, rosterOf, seatsOf } from '../support/player.mjs';

export default async function run({ check, browser, baseUrl, consoleErrors }) {
  const open = (url, name, label) =>
    openPlayer({ browser, url, name, consoleErrors, label });

  // --- a host who never typed a name --------------------------------------
  const host = await open(baseUrl, '', 'host');
  await connected(host);
  const link = await host.inputValue('#share');
  check('the host gets a share link', /#[a-z0-9]{6,}$/.test(link), link);
  check('the start button is there from the first moment', await host.isVisible('#start'));
  await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 1, null, { timeout: 10000 });
  check('a host with no name is seated as שחקן 1', (await rosterOf(host))[0] === 'שחקן 1', (await rosterOf(host)).join());

  // --- two more, one nameless and one named -------------------------------
  const p2 = await open(link, '', 'p2');
  const p3 = await open(link, 'רותי', 'p3');
  for (const p of [host, p2, p3]) {
    await p.waitForFunction(() => document.querySelectorAll('#roster li').length === 3, null, { timeout: 25000 });
  }
  const names = await rosterOf(p3);
  check('default names follow the join order', JSON.stringify(names) === JSON.stringify(['שחקן 1', 'שחקן 2', 'רותי']), names.join());
  check('a typed name beats the default', names[2] === 'רותי', names[2]);

  // --- the deal sizes -----------------------------------------------------
  for (const p of [host, p2, p3]) {
    const note = await p.textContent('#deal-note');
    check('everyone sees the default deal of 12 and 3', note.includes('12') && note.includes('3'), note);
  }
  await host.fill('#set-atoms', '20');
  await p2.waitForFunction(() => document.getElementById('deal-note').textContent.includes('20'), null, { timeout: 15000 });
  check('a change by the host reaches the other players', true);

  // --- a deal the deck cannot cover ---------------------------------------
  await host.fill('#set-atoms', '30');
  await host.click('#start');
  await host.waitForSelector('#lobby-note.error', { timeout: 5000 });
  const err = await host.textContent('#lobby-note');
  check('30 atoms for 3 players is refused', err.includes('72'), err);
  check('the refused start leaves the host in the lobby', await host.isVisible('#view-lobby'));
  check('the refused start leaves the others in the lobby', await p2.isVisible('#view-lobby'));

  // --- ordering -----------------------------------------------------------
  await host.click('#roster li:nth-child(3) button.move >> nth=0');
  await p2.waitForFunction(
    () => [...document.querySelectorAll('#roster .who')].map((x) => x.textContent).join() === 'שחקן 1,רותי,שחקן 2',
    null, { timeout: 15000 });
  check('reordering by the host reaches the others', true);
  check('a joiner has no host controls', await p2.isHidden('#host-controls'));
  check('a joiner has no reorder buttons', (await p2.$$('#roster .move')).length === 0);

  // --- a deal that fits ---------------------------------------------------
  await host.fill('#set-atoms', '9');
  await host.fill('#set-mols', '2');
  await host.click('#start');
  for (const p of [host, p2, p3]) {
    await p.waitForSelector('#view-game:not(.hidden)', { timeout: 20000 });
    await p.waitForFunction(() => document.querySelectorAll('#players li').length === 3, null, { timeout: 20000 });
  }
  check('everyone moves to the game screen', true);
  const seats = await seatsOf(host);
  check('seats keep the host ordering', seats[0].includes('שחקן 1') && seats[1].includes('רותי'), seats.join(' | '));
  for (const p of [host, p2, p3]) {
    const framed = await p.$$eval('#players li.turn .who', (n) => n.map((x) => x.textContent));
    check('one seat is framed, the same one for everyone', framed.length === 1 && framed[0].includes('שחקן 1'), framed.join());
  }

  // --- the room is locked -------------------------------------------------
  const late = await open(link, 'יוסי', 'late');
  await late.waitForSelector('#view-game:not(.hidden)', { timeout: 25000 });
  check('a latecomer is told the room is locked', (await late.textContent('#turn-banner')).includes('נעול'));
  check('a latecomer does not take a seat', (await host.$$eval('#players li', (n) => n.length)) === 3);

  for (const p of [host, p2, p3, late]) await p.context().close();
}
