// Plays a whole game through three browsers. The moves are sent with the
// page's own move(), not by clicking, so this suite is about the host, the
// protocol and the state everyone ends up holding — not about the screen.
import { MOLECULES, FUSION } from '../../js/cards.js';
import { formulaOf, isPartOf, isComplete, unitElement } from '../../js/rules.js';
import { openPlayer, connected } from '../support/player.mjs';

const compositionOf = (units) => {
  const comp = {};
  for (const u of units) comp[u.el] = (comp[u.el] || 0) + 1;
  return comp;
};

// What this player could legally do, worked out from the public table and his
// own cards with the same functions the host uses.
function candidates(state, cards, meId) {
  const g = state.game;
  if (g.phase === 'takeback') return [{ t: 'takeBack', card: null }];
  if (g.phase === 'picking') return (cards.pick?.cards || []).map((c) => ({ t: 'pick', card: c.id }));

  const atoms = cards.atoms.filter((c) => c.el !== FUSION);
  const out = [];

  if (g.phase === 'opening') {
    for (const m of cards.molecules) {
      const spec = MOLECULES[m.mol];
      const ns = spec.special === 'alkanes' ? [1, 2, 3, 4] : [undefined];
      for (const n of ns) {
        const formula = formulaOf(m.mol, n);
        for (const a of atoms) {
          if (formula[a.el]) out.push({ t: 'startMolecule', molecule: m.id, cards: [a.id], alkaneN: n });
        }
      }
    }
    out.push({ t: 'drawFive', kind: 'molecules' }, { t: 'drawFive', kind: 'atoms' });
    return out;
  }

  const formula = formulaOf(g.area.molecule, g.area.alkaneN);
  const here = compositionOf(g.area.units);
  const fits = [];
  for (const a of atoms) {
    const next = { ...here, [a.el]: (here[a.el] || 0) + 1 };
    if (isPartOf(next, formula)) fits.push({ move: { t: 'placeUnit', cards: [a.id] }, done: isComplete(next, formula) });
  }
  fits.sort((x, y) => Number(y.done) - Number(x.done));
  out.push(...fits.map((f) => f.move));

  for (const m of cards.molecules) {
    const spec = MOLECULES[m.mol];
    const ns = spec.special === 'alkanes' ? [1, 2, 3] : [undefined];
    for (const n of ns) {
      const f2 = formulaOf(m.mol, n);
      if (!isPartOf(here, f2)) continue;
      for (const a of atoms) {
        const next = { ...here, [a.el]: (here[a.el] || 0) + 1 };
        if (isPartOf(next, f2)) out.push({ t: 'swapMolecule', molecule: m.id, cards: [a.id], alkaneN: n });
      }
    }
  }
  out.push({ t: 'drawAtom' }, { t: 'pass' });
  return out;
}

const readState = (page) => page.evaluate(() => window.chemgame.state());
const readCards = (page) => page.evaluate(() => window.chemgame.cards());
const sendMove = (page, move) => page.evaluate((m) => window.chemgame.move(m), move);

export default async function run({ check, browser, baseUrl, consoleErrors }) {
  const open = (url, name) => openPlayer({ browser, url, name, consoleErrors, label: name });

  const host = await open(baseUrl, 'דנה');
  await connected(host);
  const link = await host.inputValue('#share');
  const p2 = await open(link, 'רם');
  const p3 = await open(link, 'נועה');
  for (const p of [host, p2, p3]) {
    await p.waitForFunction(() => document.querySelectorAll('#roster li').length === 3, null, { timeout: 25000 });
  }

  await host.fill('#set-atoms', '5');
  await host.fill('#set-mols', '3');
  await host.click('#start');
  for (const p of [host, p2, p3]) {
    await p.waitForFunction(() => window.chemgame.state()?.phase === 'game', null, { timeout: 20000 });
    await p.waitForFunction(() => window.chemgame.cards()?.atoms?.length === 5, null, { timeout: 20000 });
  }
  check('everyone is dealt the five atoms the host asked for', true);

  const pages = {};
  for (const p of [host, p2, p3]) pages[(await p.evaluate(() => window.chemgame.me())).id] = p;

  // --- each player holds his own cards and only his own --------------------
  const hands = {};
  for (const [id, page] of Object.entries(pages)) hands[id] = await readCards(page);
  const ids = Object.keys(pages);
  const idsOf = (c) => [...c.atoms, ...c.molecules].map((x) => x.id);
  check('no two players were dealt the same card',
    new Set(ids.flatMap((id) => idsOf(hands[id]))).size === ids.length * 8);
  for (const mine of ids) {
    const body = await pages[mine].evaluate(() => document.body.innerHTML + JSON.stringify(window.chemgame.state()));
    const foreign = ids.filter((x) => x !== mine).flatMap((x) => idsOf(hands[x]));
    check('another player cards are nowhere in this page', !foreign.some((cid) => body.includes(`"${cid}"`)), mine);
  }

  // --- a player out of turn is refused -------------------------------------
  {
    const s = await readState(host);
    const idle = ids.find((id) => id !== s.turn);
    const refused = await sendMove(pages[idle], { t: 'drawAtom' });
    check('a move out of turn is refused by the host', refused === 'לא תורך', String(refused));
  }

  // --- play it out ---------------------------------------------------------
  let moves = 0;
  let stuck = '';
  let areaAlwaysLegal = true;
  let countsAlwaysMatch = true;
  let sawTakeback = false;
  let sawCompletion = false;

  while (moves < 1500) {
    const state = await readState(host);
    const g = state.game;
    if (g.winner) break;

    if (g.area.molecule) {
      const formula = formulaOf(g.area.molecule, g.area.alkaneN);
      if (!formula || !isPartOf(compositionOf(g.area.units), formula)) areaAlwaysLegal = false;
    }
    if (moves % 10 === 0) {
      for (const seat of state.order) {
        const cards = await readCards(pages[seat.id]);
        if (cards.atoms.length !== seat.atoms || cards.molecules.length !== seat.molecules) countsAlwaysMatch = false;
      }
    }

    const actor = g.phase === 'takeback' ? g.takeback.pending[0] : state.turn;
    if (g.phase === 'takeback') sawTakeback = true;
    const page = pages[actor];
    const cards = await readCards(page);
    let acted = false;
    for (const move of candidates(state, cards, actor)) {
      const error = await sendMove(page, move);
      if (!error) {
        acted = true;
        if (move.t === 'placeUnit' || move.t === 'swapMolecule') {
          const after = await readState(host);
          if (after.game.phase === 'takeback') { sawCompletion = true; sawTakeback = true; }
          if (after.game.winner) sawCompletion = true;
        }
        break;
      }
    }
    moves += 1;
    if (!acted) { stuck = `stuck in ${g.phase} after ${moves} moves`; break; }
  }

  const final = await readState(host);
  check('the game reaches a winner', !!final.game.winner, stuck || `after ${moves} moves`);
  check('the table was part of its molecule at every step', areaAlwaysLegal);
  check('the public card counts matched the real hands throughout', countsAlwaysMatch);
  check('a molecule was completed along the way', sawCompletion);
  check('the take-back was offered', sawTakeback);
  check('the winner has no atom cards left',
    final.order.find((s) => s.id === final.game.winner)?.atoms === 0);

  for (const p of [host, p2, p3]) {
    const s = await readState(p);
    check('every player ends on the same winner', s.game.winner === final.game.winner, s.game.winner);
  }
  check('no move is accepted after the win',
    (await sendMove(pages[final.turn], { t: 'drawAtom' })) !== null);

  for (const p of [host, p2, p3]) await p.context().close();
}
