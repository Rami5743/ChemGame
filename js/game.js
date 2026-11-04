// Game rules. Pure functions, no network and no DOM.
// The deck is the one place to change when the real ChemGame cards exist.

const SUITS = [
  { id: 's', label: '♠', red: false },
  { id: 'h', label: '♥', red: true },
  { id: 'd', label: '♦', red: true },
  { id: 'c', label: '♣', red: false },
];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const HAND_SIZE = 2;

export function makeDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      deck.push({ id: s.id + r, rank: r, suit: s.label, red: s.red });
    }
  }
  return deck;
}

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Deals handSize cards to every id, in the given order.
export function deal(orderedIds, handSize = HAND_SIZE) {
  const deck = shuffle(makeDeck());
  if (orderedIds.length * handSize > deck.length) {
    throw new Error('not enough cards for that many players');
  }
  const hands = {};
  for (const id of orderedIds) hands[id] = deck.splice(0, handSize);
  return { hands, table: [], turn: 0, over: false };
}

function someoneHasCards(game, orderedIds) {
  return orderedIds.some((id) => (game.hands[id] || []).length > 0);
}

// Plays one card for playerId. Mutates game. Returns {ok} or {ok:false, error}.
export function play(game, orderedIds, playerId, cardId) {
  if (game.over) return { ok: false, error: 'המשחק נגמר' };
  if (orderedIds[game.turn] !== playerId) return { ok: false, error: 'לא תורך' };

  const hand = game.hands[playerId] || [];
  const i = hand.findIndex((c) => c.id === cardId);
  if (i < 0) return { ok: false, error: 'הקלף הזה אינו בידך' };

  const [card] = hand.splice(i, 1);
  game.table.push({ by: playerId, card });

  if (!someoneHasCards(game, orderedIds)) {
    game.over = true;
  } else {
    let n = game.turn;
    do {
      n = (n + 1) % orderedIds.length;
    } while ((game.hands[orderedIds[n]] || []).length === 0);
    game.turn = n;
  }
  return { ok: true };
}
