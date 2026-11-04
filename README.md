# ChemGame

An online version of the Atoms & Molecules card game, as a static page with no
server code of its own: open it, start a game, send the link.

The printed game's own material — the rules, the card faces, the backs and the
booklet — is kept under `materials/`, as it was supplied.

## State

The room works end to end: name, host, shareable link, lobby, seat order, lock.
The game itself is not implemented yet — after the host starts, the seats are
shown with the turn marked and the board area is empty.

## Playing

1. Open the page, type a name, press **צור משחק**. You are the host.
2. Copy the link and send it to the other players.
3. Everyone who opens the link types a name and appears in the lobby, where all
   players see each other.
4. The host orders the seats with the ▲▼ buttons and presses **התחל משחק**.
   The room locks — nobody can join after that.

## Deploying

Push to `main` and enable GitHub Pages for the repository (Settings → Pages →
Deploy from a branch → `main`, folder `/`). Nothing is built; the files are
served as they are. Any static host works the same way.

## How it works

Each room has a random id, kept in the fragment of the URL, so the link is the
room. One browser — the host's — owns the seat order, the turn and, once there
are rules, the shuffled decks; it is the only one that decides anything. The
other players send actions to it and render the snapshot it publishes back.

Messages travel over a public MQTT broker reached over WebSocket, which is why
the page itself can stay passive. All topics live under `chemgame/1/<room>/`:

| topic     | direction            | contents                                |
| --------- | -------------------- | --------------------------------------- |
| `state`   | host → everyone      | retained public snapshot of the room     |
| `act`     | player → host        | `hello`, `play`, `bye`                   |
| `p/<id>`  | host → one player    | retained, that player's own cards        |

A player subscribes to `p/<its own id>` and to nothing else of that kind, which
is how a hand stays out of the other players' pages.

| file             | contents                                      |
| ---------------- | --------------------------------------------- |
| `index.html`     | the three screens: name, lobby, game          |
| `css/style.css`  | styling                                       |
| `js/net.js`      | broker connection, topics, retained messages  |
| `js/app.js`      | screens, rendering, host bookkeeping          |
| `materials/`     | the printed game: rules, card art, booklet    |

## Configuration

`?broker=wss://host:port/path` points the page at a different broker, including
a self-hosted one. Without it the page uses the public broker in `js/net.js`.

## Limitations

- **The host's tab holds the game.** If the host closes or reloads it, the room
  is gone and the players keep the last screen they saw.
- **The public broker is a shared test service.** It has no uptime guarantee and
  it rate-limits. A room that gets real use needs an account on a broker.
- **Cards will be private by convention, not by cryptography.** Anybody who
  subscribes to the room's topics on the broker can read what is sent, and the
  host's browser holds every hand.
- **The link is the only key.** Anybody holding it can take a seat until the
  host starts the game.
