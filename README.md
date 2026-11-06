# ChemGame

An online version of the Atoms & Molecules card game: a static page with no
server code of its own. Open it, start a game, send the link to the people you
want to play with. It is played in Hebrew or in American English — the two
flags in the header switch between them at any moment, in the middle of a game
as well, without reloading anything, and each player keeps his own choice, so
the link carries no language. The same bar sits across the top of every page,
styled in `css/head.css` alone: the title, the two flags, the way to the
rules, to the sheet about the cards and to the printed game.

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
margins, each below the one before it on its own side, the colours running to
the left and right edges of the paper and a margin at the head and foot of
every page, the atoms filling the first page and the molecules opening the
next. The terms link out: the Hebrew
to Wikipedia, the English to Grokipedia, about seventy subjects either way. The
entry screen also links to the printed game at The Game Crafter.

## Playing

1. Open the page, optionally type a name, press **צור משחק**. You are the host.
2. Copy the link and send it to the other players. Whoever opens it appears in
   the lobby; anybody who did not type a name is seated as שחקן 2, שחקן 3 and
   so on, in the order they arrived.
3. The host may seat robots as well, **הוסף רובוט**, as many as he likes.
   They come named — דניאל, R2-D2, C-3PO, מרווין, הל — and he can rename any
   of them, move them in the order or take them away again. A robot plays on
   the host's page, a second or two to a move, and its name is written in a
   colour of its own wherever it stands.
4. The host orders the seats — dragging one by its handle to where it should
   go, or stepping it with the ▲▼ buttons — sets how many atom and molecule
   cards each player gets (12 and 3 by default) and presses **התחל משחק**.
   The room then locks.
5. Get rid of all your atom cards to win.

On your turn you put one atom on the table so that what is on the table is
still part of the molecule in play, or you discard that molecule and lay one of
your own with an atom of your own, so that everything already on the table fits
the new one, or you take an atom from the deck. A fusion card goes down
together with the regular atoms it is fused to, counting as the single atom of
their summed atomic number, and that group is fixed the moment it is laid. The
alkanes card asks how many carbons it stands for.

Finishing a molecule lets every player who contributed to it take back one of
the atoms he laid — his own cards are marked out on the table and a click on
one takes it; the only button is the one for letting it go — and the one who
finished it then either starts a new molecule or draws five cards of one kind
and keeps one. Nobody waits for a turn here: everybody is asked at once, and
the robots answer side by side with the people. A fused group is never
taken apart: neither the fusion card nor an atom that went into it.

The move a turn is for is already under way when the turn opens, so a card can
simply be clicked: a molecule when one has to be opened, an atom while one is
being built. The other moves are on the bar beside it, and a fusion is the one
thing that waits for a confirmation.

The table itself is shown one of two ways, and two buttons above it switch
between them. **נוסחת מבנה** stands the atoms where the card's own diagram
draws them, with the places still missing marked out. **נוסחת מולקולה** gives
each element of the formula a pile of its own, with its symbol and how many of
its atoms are down out of how many are wanted written above it. A phone has no
room for the diagram and glucose has too many atoms for it on any screen, so
those open on the piles; everything else opens on the shape. A choice of the
player's own holds for as long as that molecule is on the table.

When a game is won, the host can deal again to the same players, changing the
two sizes first.

A robot wants what a player wants, and goes about it simply: an oxygen is the
hardest card to place, so whatever lets one go down is taken first, and the
molecule in play is traded for another if that is what it takes; a fusion is
spent only when nothing else fits; a new molecule is opened when an oxygen is
held and nothing on offer takes it; and glucose, which asks for six oxygens,
only with three or more of them in hand. A card taken back is a card to be rid
of again, so it leaves what it laid where it lies — unless it is down to its
last hydrogen, the atom every molecule asks for most, in which case it takes
one back. `js/bot.js` holds all of it, and it sees no more than a player sees.

## Deploying

Push to `main` and enable GitHub Pages for the repository (Settings → Pages →
Deploy from a branch → `main`, folder `/`). Nothing is built; the files are
served as they are. Any static host works the same way.

## How it works

Each room has a random id kept in the fragment of the URL, so the link is the
room. One browser — the host's — owns the shuffled decks, the seat order, the
table and the turn, and is the only one that decides anything. Because the
game lives in that page, the page writes it down beside the room in its own
tab store at every change: a tab the browser puts away and brings back, or a
reload, picks the game up where it was — the same count under the same mark,
the robots going on with it, and the other players none the wiser. The others send
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
| `js/bot.js`        | what a robot plays, from what a player can see        |
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
a self-hosted one; several, separated by commas, are all held at once. A broker
that wants a name and a word takes them from the address itself,
`wss://name:word@host/path` — they are taken out before the address is used and
never appear on the screen. `?seed=<n>` fixes the shuffle, which makes a game
reproducible. Without them the page uses the brokers named in `js/net.js` and a
shuffle of its own.

**A network that blocks the game.** The network of an institution or a
workplace commonly closes every outbound port but 443, the one ordinary
browsing uses. Two of the brokers in the list listen on 443 for that reason;
the rest listen on 8084, 8884 and 8081, which such a network shuts. Tapping the
chip at the top of the page lists every broker and whether it answered, which
says at once whether this is what happened. The way out is `?broker=` with a
broker of one's own on 443 — the link carries it to the other players, since
the share link keeps the whole query string.

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
