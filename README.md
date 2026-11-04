# ChemGame

An online version of the Atoms & Molecules card game: a static page with no
server code of its own. Open it, start a game, send the link to the people you
want to play with.

Live at https://rami5743.github.io/ChemGame/

The printed game's own material is kept under `materials/` as it was supplied —
the rules in Hebrew and English, the card faces in both languages, the backs,
the booklet, the boxes and the fact sheets. The card images are built from it,
`rules.html` is the booklet set as one continuous page, and `facts.html` is
the sheet about the cards — the physics, chemistry and biology behind them —
each in the colours and the layout of the printed thing it came from. The
entry screen also links to the printed game at The Game Crafter.

## Playing

1. Open the page, optionally type a name, press **צור משחק**. You are the host.
2. Copy the link and send it to the other players. Whoever opens it appears in
   the lobby; anybody who did not type a name is seated as שחקן 2, שחקן 3 and
   so on, in the order they arrived.
3. The host orders the seats with the ▲▼ buttons, sets how many atom and
   molecule cards each player gets — 12 and 3 by default — and presses
   **התחל משחק**. The room then locks.
4. Get rid of all your atom cards to win.

On your turn you put one atom on the table so that what is on the table is
still part of the molecule in play, or you discard that molecule and lay one of
your own with an atom of your own, so that everything already on the table fits
the new one, or you take an atom from the deck. A fusion card goes down
together with the regular atoms it is fused to, counting as the single atom of
their summed atomic number, and that group is fixed the moment it is laid. The
alkanes card asks how many carbons it stands for.

Finishing a molecule lets every player who contributed to it take back one of
the atoms he laid — never a fusion card — and the one who finished it then
either starts a new molecule or draws five cards of one kind and keeps one.

When a game is won, the host can deal again to the same players, changing the
two sizes first.

## Deploying

Push to `main` and enable GitHub Pages for the repository (Settings → Pages →
Deploy from a branch → `main`, folder `/`). Nothing is built; the files are
served as they are. Any static host works the same way.

## How it works

Each room has a random id kept in the fragment of the URL, so the link is the
room. One browser — the host's — owns the shuffled decks, the seat order, the
table and the turn, and is the only one that decides anything. The others send
moves to it and render the snapshot it publishes back; a move the rules refuse
comes back to its sender alone with the reason.

Messages travel over a public MQTT broker reached over WebSocket, which is what
lets the page itself stay passive. All topics live under `chemgame/1/<room>/`:

| topic    | direction         | contents                             |
| -------- | ----------------- | ------------------------------------ |
| `state`  | host → everyone   | retained public snapshot of the room |
| `act`    | player → host     | `hello`, `move`, `bye`               |
| `p/<id>` | host → one player | retained, that player's own cards    |

A player subscribes to `p/<its own id>` and to no other, which is how a hand
stays out of the other players' pages. The host resends its snapshot every ten
seconds whether or not it changed, so the others can tell a quiet host from one
who has closed the page.

| file               | contents                                              |
| ------------------ | ----------------------------------------------------- |
| `index.html`       | the three screens: name, lobby, game                  |
| `rules.html`       | the rules, in the booklet's colours                   |
| `facts.html`       | what each card is, in the same colours                |
| `css/style.css`    | styling                                               |
| `css/rules.css`    | the rules page                                        |
| `css/facts.css`    | the sheet about the cards                             |
| `js/cards.js`      | the printed deck as a catalogue, and the art paths    |
| `js/rules.js`      | the game itself — no network, no DOM                  |
| `js/net.js`        | broker connection, topics, retained messages          |
| `js/app.js`        | screens, rendering, host bookkeeping                  |
| `assets/cards/he`  | the card images the page serves                       |
| `tools/`           | builds those images from `materials/`                 |
| `test/`            | the test run, with its own broker and static server   |

## Running the tests

```bash
npm install
```

```bash
npm test
```

The run starts its own MQTT broker and its own static server, so nothing needs
to be running first and no public broker is touched. `npm run test:unit` is the
rules alone, with no browser. `node test/run.mjs --only play` runs one suite.

After changing the card art, rebuild the images:

```bash
node tools/build-cards.mjs
```

The two pages built from the printed material have their own extractors, which
need Python with Pillow, and poppler for the second:

```bash
python3 tools/extract-booklet-art.py && python3 tools/extract-facts-art.py
```

## Configuration

`?broker=wss://host:port/path` points the page at a different broker, including
a self-hosted one. `?seed=<n>` fixes the shuffle, which makes a game
reproducible. Without them the page uses the public broker named in `js/net.js`
and a shuffle of its own.

## Limitations

- **The host's tab holds the game.** If the host closes it, the room is gone;
  the others are told so and keep the last screen they saw.
- **The public broker is a shared test service.** It has no uptime guarantee
  and it rate-limits. A room that gets real use needs an account on a broker.
- **Cards are private by convention, not by cryptography.** Anybody who
  subscribes to the room's topics on the broker can read what is sent, and the
  host's browser holds every hand.
- **The link is the only key.** Anybody holding it can take a seat until the
  host starts the game.
- **A player who disconnects on his own turn holds the table up.** He is marked
  in the seat list, and the game waits for him. The one place that does not
  wait is the take-back, where the host answers for him.
- **Hebrew only.** The English card set is in `materials/` and the art pipeline
  is ready for a second folder; the page does not offer the switch yet.
