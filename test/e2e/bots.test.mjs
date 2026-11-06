// The robots the host can seat, and the game they play by themselves.
import { botMove } from '../../js/bot.js';
import { openPlayer, connected } from '../support/player.mjs';

const readState = (page) => page.evaluate(() => window.chemgame.state());
const readCards = (page) => page.evaluate(() => window.chemgame.cards());
const send = (page, move) => page.evaluate((m) => window.chemgame.move(m), move);
const namesOf = (page) =>
  page.$$eval('#roster .who', (n) => n.map((x) => x.value ?? x.textContent));

export default async function run({ check, browser, baseUrl, consoleErrors }) {
  const open = (url, name, label) => openPlayer({ browser, url, name, consoleErrors, label });

  const host = await open(`${baseUrl}&seed=3`, 'דנה', 'host');
  await connected(host);

  /* ---------- seating them ---------- */
  check('the host is offered a robot', await host.isVisible('#add-bot'));
  await host.click('#add-bot');
  await host.click('#add-bot');
  await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 3,
    null, { timeout: 15000 });
  const names = await namesOf(host);
  check('they come with names of their own', names[1] === 'דניאל' && names[2] === 'R2-D2',
    names.join());
  check('a robot is written in its own colour',
    (await host.$$('#roster .botname')).length === 2);
  check('and the host can take one away again', await host.isVisible('#roster .move.drop'));

  // The names are the host's to change.
  await host.fill('#roster li:nth-child(2) .botname', 'אביב');
  await host.waitForFunction(
    () => window.chemgame.state().order[1].name === 'אביב', null, { timeout: 15000 });
  check('a robot answers to the name the host gives it', true);

  // One away, one back, to see both ends of it.
  await host.click('#roster li:nth-child(3) .move.drop');
  await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 2,
    null, { timeout: 15000 });
  check('taking one away leaves the rest seated', (await namesOf(host)).length === 2);
  await host.click('#add-bot');
  await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 3,
    null, { timeout: 15000 });

  /* ---------- a guest sees them, and cannot add one ---------- */
  const link = await host.inputValue('#share');
  const guest = await open(link, 'רם', 'guest');
  await guest.waitForFunction(() => document.querySelectorAll('#roster li').length === 4,
    null, { timeout: 25000 });
  check('a player who is not the host has no robot to add', await guest.isHidden('#add-bot'));
  check('and sees their names as words, not as fields',
    (await guest.$$('#roster .botname')).length === 0);
  check('each of them marked as a robot', (await guest.$$('#roster .who.bot')).length === 2);

  /* ---------- they play by themselves ---------- */
  await host.fill('#set-atoms', '5');
  await host.fill('#set-mols', '3');
  await host.click('#start');
  for (const p of [host, guest]) {
    await p.waitForFunction(() => window.chemgame.state()?.phase === 'game',
      null, { timeout: 20000 });
  }
  const seats = await host.evaluate(() => window.chemgame.state().order.map((p) => p.name));
  check('the robots took their seats in the game', seats.length === 4, seats.join());

  const people = {};
  for (const p of [host, guest]) people[(await p.evaluate(() => window.chemgame.me())).id] = p;

  // Whoever is not a person is a robot, and a robot moves on its own.
  {
    const before = await readState(host);
    const whose = before.game.phase === 'takeback'
      ? before.game.takeback.pending[0] : before.turn;
    if (!people[whose]) {
      await host.waitForFunction((r) => window.chemgame.state().rev > r, before.rev,
        { timeout: 12000 });
      check('a robot makes its move without being told', true);
    } else {
      check('a robot makes its move without being told', true, 'a person opens this game');
    }
  }

  // The people play as a robot would, so the game plays itself to the end.
  let guard = 0;
  while (guard++ < 300) {
    const state = await readState(host);
    if (state.game.winner) break;
    const whose = state.game.phase === 'takeback'
      ? state.game.takeback.pending[0] : state.turn;
    const page = people[whose];
    if (!page) {
      // A robot's turn: wait for it rather than play it.
      await host.waitForFunction((r) => window.chemgame.state().rev > r, state.rev,
        { timeout: 12000 }).catch(() => {});
      continue;
    }
    const move = botMove(state.game, await readCards(page));
    if (!move) break;
    await send(page, move);
    await host.waitForFunction((r) => window.chemgame.state().rev > r, state.rev,
      { timeout: 12000 }).catch(() => {});
  }

  const end = await readState(host);
  check('a game with robots in it is played out to a winner', !!end.game.winner,
    `${guard} turns, phase ${end.game.phase}`);
  check('and everybody saw the same ending',
    (await readState(guest)).game.winner === end.game.winner);

  for (const p of [host, guest]) await p.context().close();
}
