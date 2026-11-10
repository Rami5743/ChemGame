// A game dealt without the special cards: the nuclear fusion card and the
// alkanes card are simply not in it.
import { openPlayer, connected } from '../support/player.mjs';

export default async function run({ check, browser, baseUrl, consoleErrors }) {
  const open = (url, name) => openPlayer({ browser, url, name, consoleErrors, label: name });

  const host = await open(`${baseUrl}&seed=23`, 'רותם');
  await connected(host);
  const link = await host.inputValue('#share');
  const guest = await open(link, 'שחר');
  for (const p of [host, guest]) {
    await p.waitForFunction(() => document.querySelectorAll('#roster li').length === 2,
      null, { timeout: 25000 });
  }

  check('the host is offered a game without them', await host.isVisible('#set-nospecials'));
  check('a player who is not the host is not', await guest.isHidden('#set-nospecials'));

  await host.check('#set-nospecials');
  await guest.waitForFunction(() => window.chemgame.state()?.specials === false,
    null, { timeout: 20000 });
  check('the choice reaches everybody in the room', true);
  check('and the room says which cards are out',
    (await guest.textContent('#deal-note')).includes('אלקאנים'),
    await guest.textContent('#deal-note'));

  await host.fill('#set-atoms', '12');
  await host.fill('#set-mols', '4');
  await host.click('#start');
  for (const p of [host, guest]) {
    await p.waitForFunction(() => window.chemgame.state()?.phase === 'game',
      null, { timeout: 20000 });
  }

  const state = await host.evaluate(() => window.chemgame.state());
  check('the atom deck is the printed one without its three fusion cards',
    state.game.atomDeck === 69 - 24, String(state.game.atomDeck));
  check('and the molecule deck without its one alkanes card',
    state.game.molDeck === 35 - 8, String(state.game.molDeck));

  for (const p of [host, guest]) {
    const cards = await p.evaluate(() => window.chemgame.cards());
    check('no hand holds a fusion card', !cards.atoms.some((c) => c.el === 'FUSION'));
    check('and none holds the alkanes card', !cards.molecules.some((c) => c.mol === 'alkanes'));
  }

  for (const p of [host, guest]) await p.context().close();
}
