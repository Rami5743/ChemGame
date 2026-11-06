// What the robot does with a hand, and why.
import { botMove } from '../../js/bot.js';
import { newGame, apply, publicView, privateView, formulaOf } from '../../js/rules.js';
import { FUSION } from '../../js/cards.js';

let n = 0;
const atom = (el) => ({ id: `a${++n}`, el });
const mol = (m) => ({ id: `m${++n}`, mol: m });
const hand = (atoms = [], molecules = []) => ({ atoms, molecules });

function table({ seats = ['bot', 'b'], hands, decks = {} }) {
  const s = newGame({ seats, deal: { atoms: 0, molecules: 0 }, seed: 5 });
  s.hands = hands;
  s.atomDeck = decks.atomDeck || [];
  s.atomDiscard = decks.atomDiscard || [];
  s.molDeck = decks.molDeck || [];
  s.molDiscard = decks.molDiscard || [];
  return s;
}

const ask = (s, who = 'bot') => botMove(publicView(s), privateView(s, who), who);

export default async function run({ check }) {
  /* ---------- opening ---------- */
  {
    // Water takes an oxygen; ethane does not.
    const o = atom('O'), h = atom('H'), c = atom('C');
    const water = mol('water'), ethane = mol('ethane');
    const s = table({ hands: { bot: hand([o, h, c], [ethane, water]), b: hand([], []) } });
    const move = ask(s);
    check('it opens with the molecule that takes its oxygen',
      move.t === 'startMolecule' && move.molecule === water.id, JSON.stringify(move));
    check('and lays the oxygen itself first', move.cards[0] === o.id, JSON.stringify(move));
  }

  {
    // Glucose asks for six oxygens: not a card to open with holding one.
    const o = atom('O'), h = atom('H'), c = atom('C');
    const glucose = mol('glucose'), water = mol('water');
    const s = table({ hands: { bot: hand([o, h, c], [glucose, water]), b: hand([], []) } });
    const move = ask(s);
    check('with one oxygen it keeps away from glucose', move.molecule === water.id,
      JSON.stringify(move));
  }

  {
    // With three it is worth opening.
    const os = [atom('O'), atom('O'), atom('O')];
    const glucose = mol('glucose'), ethane = mol('ethane');
    const s = table({
      hands: { bot: hand([...os, atom('C'), atom('H')], [glucose, ethane]), b: hand([], []) },
    });
    const move = ask(s);
    check('with three oxygens it opens with glucose', move.molecule === glucose.id,
      JSON.stringify(move));
  }

  {
    // Nothing to open with: it asks for molecules.
    const s = table({
      hands: { bot: hand([atom('H')], []), b: hand([], []) },
      decks: { molDeck: [mol('water'), mol('water'), mol('water'), mol('water'), mol('water')] },
    });
    const move = ask(s);
    check('with no molecule in hand it draws five of them',
      move.t === 'drawFive' && move.kind === 'molecules', JSON.stringify(move));
  }

  /* ---------- building ---------- */
  {
    // Water is open with one hydrogen down: an oxygen fits, and goes first.
    const o = atom('O'), h1 = atom('H'), h2 = atom('H');
    const water = mol('water');
    const s = table({ hands: { bot: hand([h1, o, h2], [water]), b: hand([atom('C')], []) } });
    apply(s, 'bot', { t: 'startMolecule', molecule: water.id, cards: [h1.id] });
    s.turn = 0; // its turn again
    const move = ask(s);
    check('it lays the oxygen before the hydrogen',
      move.t === 'placeUnit' && move.cards[0] === o.id, JSON.stringify(move));
  }

  {
    // Ethane is in play, which has no room for oxygen, and the bot holds one.
    const h1 = atom('H');
    const ethane = mol('ethane'), water = mol('water');
    const o = atom('O'), h2 = atom('H');
    const s = table({
      seats: ['a', 'bot'],
      hands: { a: hand([h1], [ethane]), bot: hand([o, h2], [water]) },
    });
    apply(s, 'a', { t: 'startMolecule', molecule: ethane.id, cards: [h1.id] });
    const move = ask(s);
    check('it trades the molecule for one that takes its oxygen',
      move.t === 'swapMolecule' && move.molecule === water.id && move.cards[0] === o.id,
      JSON.stringify(move));
  }

  {
    // A fusion is spent only when nothing of its own fits.
    const f = atom(FUSION), h1 = atom('H'), h2 = atom('H'), h3 = atom('H');
    const ammonia = mol('ammonia');  // NH3
    const s = table({
      seats: ['a', 'bot'],
      hands: { a: hand([h1], [ammonia]), bot: hand([f, h2, h3, atom('O')], []) },
    });
    apply(s, 'a', { t: 'startMolecule', molecule: ammonia.id, cards: [h1.id] });
    const plain = ask(s);
    check('a hydrogen that fits is laid on its own, not fused',
      plain.t === 'placeUnit' && plain.cards.length === 1, JSON.stringify(plain));

    // Now only a fusion can make what the molecule still wants: nitrogen,
    // seven, which is a carbon and a hydrogen put together.
    const s2 = table({
      seats: ['a', 'bot'],
      hands: {
        a: hand([atom('H')], [mol('ammonia')]),
        bot: hand([atom(FUSION), atom('C'), atom('H'), atom('O')], []),
      },
    });
    const first = s2.hands.a.molecules[0];
    apply(s2, 'a', { t: 'startMolecule', molecule: first.id, cards: [s2.hands.a.atoms[0].id] });
    s2.area.units.push(
      { by: 'a', el: 'H', cards: [atom('H')] },
      { by: 'a', el: 'H', cards: [atom('H')] }
    );
    const fused = ask(s2);
    check('when only a fusion makes what is wanted, it is used',
      fused.t === 'placeUnit' && fused.cards.length > 1, JSON.stringify(fused));
  }

  /* ---------- the rest ---------- */
  {
    // With hydrogen to spare it leaves what it laid where it lies.
    const s = table({
      hands: { bot: hand([atom('H'), atom('H'), atom('H')], [mol('water')]), b: hand([], []) },
    });
    const his = atom('H');
    s.area = { molecule: mol('water'), alkaneN: null, units: [{ by: 'bot', el: 'H', cards: [his] }] };
    s.phase = 'takeback';
    s.takeback = { pending: ['bot'], finisher: 'b' };
    check('as a rule it takes nothing back',
      ask(s).card === null, JSON.stringify(ask(s)));

    // Down to its last hydrogen, it takes one back.
    const short = table({ hands: { bot: hand([atom('O')], [mol('water')]), b: hand([], []) } });
    const laid = atom('H');
    short.area = {
      molecule: mol('water'), alkaneN: null,
      units: [
        { by: 'b', el: 'H', cards: [atom('H')] },
        { by: 'bot', el: 'H', cards: [laid] },
      ],
    };
    short.phase = 'takeback';
    short.takeback = { pending: ['bot'], finisher: 'b' };
    const move = ask(short);
    check('but short of hydrogen it takes one of its own back',
      move.t === 'takeBack' && move.card === laid.id, JSON.stringify(move));
  }

  {
    const five = [mol('water'), mol('glucose'), mol('ethane'), mol('ammonia'), mol('methane')];
    const s = table({ hands: { bot: hand([atom('O'), atom('H')], []), b: hand([], []) } });
    s.phase = 'picking';
    s.pick = { kind: 'molecules', cards: five, by: 'bot' };
    const move = ask(s);
    check('of five molecules it keeps one that takes an oxygen',
      move.t === 'pick' && (move.card === five[0].id || move.card === five[3].id),
      JSON.stringify(move));
  }

  /* ---------- a whole game, robots only ---------- */
  {
    const s = newGame({ seats: ['one', 'two', 'three'], deal: { atoms: 9, molecules: 3 }, seed: 11 });
    let moves = 0;
    let stuck = '';
    while (!s.winner && moves < 600) {
      const who = s.phase === 'takeback' ? s.takeback.pending[0] : s.seats[s.turn];
      const move = botMove(publicView(s), privateView(s, who), who);
      if (!move) { stuck = `no move for ${who} in ${s.phase}`; break; }
      const r = apply(s, who, move);
      if (!r.ok) { stuck = `${JSON.stringify(move)} refused: ${r.error}`; break; }
      moves += 1;
    }
    check('three robots play a game out to a winner', !!s.winner, stuck || `${moves} moves`);
    check('and they do it in a sensible number of moves', moves < 600, String(moves));
  }
}
