# ChemGame

An online version of the Atoms & Molecules card game: a static page with no
server code of its own. Open it, start a game, send the link to the people you
want to play with. It is played in Hebrew or in English — the two flags in the
header switch between them at any moment, in the middle of a game as well,
without reloading anything, and each player keeps his own choice, so the link
carries no language.

Live at https://rami5743.github.io/ChemGame/

The printed game's own material is kept under `materials/` as it was supplied —
the rules in Hebrew and English, the card faces in both languages, the backs,
the booklet, the boxes and the fact sheets. The card images are built from it,
`rules.html` and `rules.en.html` are the booklet set as one continuous page.
The sheet about the cards — the physics, chemistry and biology behind them — is
what `facts.pdf` and `facts.en.pdf` hold, and that is what the game links to.
In Hebrew it is the supplied file itself. `tools/sheet.py` opens that file far
enough to reach the text inside it: Word wrote every run of text as its own
block with an absolute position, so a run can be recoloured, split or rewritten
and nothing else on the page moves, and a line that grew or shrank is justified
again by taking the difference out of the gaps between its words. On that,
`tools/link-facts-pdf.py` makes 49 corrections of spelling, lays a link over
every term and sets those terms in the blue the game uses for a link. Rewriting
every run without changing one of them gives the page back pixel for pixel,
which is what says the machinery is honest.

In English there is no such file, so `facts.en.html` sets the same text in the
same colours and `tools/build-facts-pdf.mjs` prints it — on paper in the
setting of the printed sheet: one justified column with the photographs in the
margins, the colours running to the edge of the paper, the atoms filling the
first page and the molecules opening the next. The terms link out: the Hebrew
to Wikipedia, the English to Grokipedia, about seventy subjects either way. The
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
the atoms he laid, and the one who finished it then either starts a new
molecule or draws five cards of one kind and keeps one. A fused group is never
taken apart: neither the fusion card nor an atom that went into it.

The move a turn is for is already under way when the turn opens, so a card can
simply be clicked: a molecule when one has to be opened, an atom while one is
being built. The other moves are on the bar beside it, and a fusion is the one
thing that waits for a confirmation.

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

Everybody, host and player alike, holds a connection to every broker it can
reach and repeats everything on all of them, so the two need only one broker in
common — the point of several, since a network that closes one port closes the
game. No broker is ever given up on: a connection that failed keeps trying, so
a phone that was out of reach walks back in without a reload. What that costs
is that the same message arrives more than once; a snapshot is told by its
revision number and a move by the mark it carries, and the second copy of
either is dropped.

| file               | contents                                              |
| ------------------ | ----------------------------------------------------- |
| `index.html`       | the three screens: name, lobby, game                  |
| `rules.html`       | the rules, in the booklet's colours, and `rules.en.html` |
| `facts.en.html`    | what each card is, printed to `facts.en.pdf`          |
| `css/style.css`    | styling                                               |
| `css/rules.css`    | the rules page                                        |
| `css/facts.css`    | the sheet about the cards                             |
| `js/cards.js`      | the printed deck as a catalogue, and the art paths    |
| `js/i18n.js`       | every word the game says, in both languages           |
| `js/rules.js`      | the game itself — no network, no DOM                  |
| `js/net.js`        | broker connection, topics, retained messages          |
| `js/app.js`        | screens, rendering, host bookkeeping                  |
| `assets/cards`     | the card images the page serves, one folder a language |
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

The Hebrew sheet is the supplied file with links laid over it; the English one
is printed from its page. After changing either, build it again:

```bash
python3 tools/link-facts-pdf.py    # facts.pdf, the supplied sheet + links
```

```bash
node tools/build-facts-pdf.mjs     # facts.en.pdf, printed from facts.en.html
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
- **A word added in one language must be added in the other.** `js/i18n.js`
  holds both; a key missing from English falls back to the Hebrew.
