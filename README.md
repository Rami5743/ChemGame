# ChemGame

A browser card game for people in different places, with no server code of its
own. The whole thing is a static page: open it, start a game, send the link.

## Playing

1. Open the page, type a name, press **צור משחק**. You are the host.
2. Copy the link and send it to the other players.
3. Everyone who opens the link types a name and appears in the lobby, where all
   players see each other.
4. The host orders the seats with the ▲▼ buttons and presses **התחל משחק**.
   The room locks — nobody can join after that.
5. Everyone is dealt 2 cards, face down to the others. On your turn you play one
   card to the middle of the board, where all players see it. The game ends when
   the cards run out.

## Deploying

Push to `main` and enable GitHub Pages for the repository (Settings → Pages →
Deploy from a branch → `main`, folder `/`). Nothing is built; the files are
served as they are. Any static host works the same way.

## How it works

Each room has a random id, kept in the fragment of the URL, so the link is the
room. One browser — the host's — owns the shuffled deck, the seat order and the
turn, and is the only one that decides anything. The other players send actions
to it and render the snapshot it publishes back.

Messages travel over a public MQTT broker reached over WebSocket, which is why
the page itself can stay passive. All topics live under `chemgame/1/<room>/`:

| topic     | direction            | contents                                |
| --------- | -------------------- | --------------------------------------- |
| `state`   | host → everyone      | retained public snapshot of the room     |
| `act`     | player → host        | `hello`, `play`, `bye`                   |
| `p/<id>`  | host → one player    | retained, that player's own hand         |

A player's hand is published only on that player's own topic, so no honest
client ever receives another player's cards.

| file             | contents                                      |
| ---------------- | --------------------------------------------- |
| `index.html`     | the three screens: name, lobby, game          |
| `css/style.css`  | styling                                       |
| `js/net.js`      | broker connection, topics, retained messages  |
| `js/game.js`     | deck, dealing, turn order — rules only        |
| `js/app.js`      | screens, rendering, host bookkeeping          |

The deck is `makeDeck()` in `js/game.js`. It is a standard 52-card deck and it
is the one place to change for other cards.

## Configuration

`?broker=wss://host:port/path` points the page at a different broker, including
a self-hosted one. Without it the page uses the public broker in `js/net.js`.

## Limitations

- **The host's tab holds the game.** If the host closes or reloads it, the room
  is gone and the players keep the last screen they saw.
- **The public broker is a shared test service.** It has no uptime guarantee and
  it rate-limits. A room that gets real use needs an account on a broker.
- **Hands are private by convention, not by cryptography.** They are published
  on separate topics, but anybody who subscribes to the room's topics on the
  broker can read them, and the host's browser holds every hand. Encrypting
  each hand to its own player is the next step if that matters.
- **The link is the only key.** Anybody holding it can take a seat until the
  host starts the game.
- **26 players at most**, two cards each out of 52.
