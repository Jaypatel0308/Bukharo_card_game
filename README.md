# Bukharo

[![CI](https://github.com/Jaypatel0308/Bukharo_card_game/actions/workflows/ci.yml/badge.svg)](https://github.com/Jaypatel0308/Bukharo_card_game/actions/workflows/ci.yml)

A real-time, four-player, team-based Rummy/Canasta web app. One player creates a
private room, shares a five-character code, and four friends play from their
phones. The server enforces every rule, keeps each hand private, scores each
round automatically and survives refreshes, disconnects and restarts.

```
Open site → Create room → Share code → Friends join → Sit in teams → Start → Play → Auto-scoring → Next round
```

## Quick start

```bash
npm install
npm run build
npm test          # 214 tests: engine, server and web client
npm start         # http://localhost:8787
```

For development with hot reload, run the two halves in separate terminals:

```bash
npm run dev:server   # API + websockets on :8787
npm run dev:web      # Vite dev server on :5173, proxying /ws to the server
```

Then open <http://localhost:5173> in four browser tabs (use private windows so
each tab gets its own session token).

## Layout

```
packages/game-engine   Bukharo's rules. Pure, deterministic, no I/O.
packages/shared        Wire protocol, and the catalogue of games on offer.
apps/server            WebSocket server, rooms, sessions, persistence.
apps/web               React client, mobile-first.
```

## Hosting more than one game

The room layer knows almost nothing about the game being played. A game is
described in `packages/shared/src/games.ts` by what a *room* needs: how many
people may sit down, which counts a match may start with, and what to call each
seat. Cards, turns and scoring stay sealed inside the game's own engine, which
the room, session, presence and persistence code never reads.

Seats are positions in a ring, `0..n-1`, and a position's team is simply whether
it is even or odd — which gives alternating seating and equal sides at any even
table size. Bukharo seats exactly four; a game listing several sizes blocks the
start on the ones it cannot use, and the lobby says what is missing rather than
just refusing.

The engine is the heart of the project and is testable without a browser or a
socket. Nothing in `apps/web` decides whether a move is legal.

## Architecture

**The server is the only source of truth.** Clients send *intentions*
(`{type: 'DRAW_STOCK'}`), never outcomes. The server shuffles, deals, validates
and scores; the client renders what it is told.

**Redaction is a single choke point.** `viewFor(state, playerId)` in
`packages/game-engine/src/view.ts` is the only function permitted to turn game
state into something a client may see. It copies the viewer's own hand and
nothing else — opponents are described by card *count*, the stock by size, the
Bucharoo by size. Hidden cards never reach the browser, so they cannot be found
by inspecting network traffic. Tests assert this at every point in a simulated
game.

**Every action is idempotent.** Each carries an `actionId`; the server remembers
recently processed ids per room, so a retried or duplicated message never plays
the move twice.

**Every room is serialised.** All mutations of one room run through a per-room
mutex, and each successful move bumps `stateVersion`.

**State is persisted.** Rooms are written to `data/rooms/<id>.json` after every
change (atomically, via a temp file and rename) and reloaded at boot, so a
server restart does not destroy games in progress. `Store` is a three-method
interface — swapping in Redis or Postgres means implementing `loadAll`, `save`
and `delete`.

**Sessions are tokens, not ids.** Joining returns a 32-byte reconnect token
stored in `localStorage`; the server keeps only its SHA-256 hash. Knowing
another player's id gets you nothing.

## The rules it enforces

Two decks plus four jokers (108 uniquely identified cards — there really are two
`A♠`, and they are distinguishable). Thirteen cards each, a separate 13-card
Bucharoo, and a card from the middle of the stock that fixes the round's wild
rank. Jokers are always wild.

- **Opening.** A team must first lay a *clean* run of 4+ consecutive cards in
  one suit — no wilds. Until then that team cannot meld anything. Once either
  partner opens, both are open, and melds belong to the team.
- **Turns.** Draw one from the stock *or* take the entire discard pile (no
  qualification, any time), then meld, then discard exactly one card.
- **Bucharo.** A meld of 7+ cards: +200 clean, +100 dirty. The bonus is locked
  in when earned.
- **Bucharoo.** Emptying your original hand hands you the 13-card Bucharoo for
  +100 and you keep playing.
- **Going out.** You must finish by *discarding* your last card, never by
  melding it, for +100. Attempting to meld away your last card is refused with
  an explanation.
- **Scoring.** Melded card points + bonuses − cards left in both partners'
  hands, cumulative across rounds to a configurable target (default 2,000).

## House rules are configuration, not code

Several rules in the original brief were explicitly unconfirmed. None of them
are hard-coded; they live in `packages/game-engine/src/rules.ts`, each marked
`UNCONFIRMED` with the default this build ships. The ones most worth confirming
with experienced players:

| Rule | Default | Config key |
| --- | --- | --- |
| Clean Bucharo that later receives a wild | keeps its +200 | `lockBucharoBonusOnCompletion` |
| A wild-rank card played at face value | keeps the meld clean | `wildRankCardCanBeUsedNaturally` |
| Ace low / high / wrapping | `A-2-3` yes, `Q-K-A` yes, `K-A-2` no | `aceLowInRuns`, `aceHighInRuns`, `runsWrapAround` |
| Mid-stock reveal is a Joker | reshuffle and reveal again | `jokerWildRevealPolicy` |
| Bucharoo must be gone before anyone goes out | yes | `bucharooMustBeTakenBeforeGoingOut` |
| Team must own a Bucharo before going out | no | `requireBucharoBeforeGoingOut` |
| Two identical cards in one set | allowed | `allowDuplicateCardsInSet` |
| Wilds per meld | unlimited | `maxWildsPerMeld` |

### One rule the brief did not settle, and had to be

Once the stock is exhausted, the discard pile can never be empty — whoever takes
it must put one card back. So a round in which nobody can go out (a team that
never opens, for instance) circulates forever. The bot-driven simulation found
this immediately: rounds simply never ended.

The build therefore continues play for `lapsAfterStockExhausted` further laps of
the table (default **2**) after the stock runs dry, then scores the round where
it stands. **This is an invented safeguard, not a rule from the family game** —
it is the one place where a decision was made rather than inherited, and it is
worth confirming what really happens at the table. Setting
`stockExhaustionRule: 'END_ROUND_IMMEDIATELY'` gives the other obvious
behaviour.

## Testing

```bash
npm run lint          # ESLint: bugs, not style
npm run test:engine   # 75 deterministic rule tests, no I/O
npm run test:server   # 50 tests against a real server process
npm run test:web      # 89 client tests (Vitest, jsdom)
npm run test:e2e      # 29 browser tests (Playwright: desktop and phone)
```

The lint rules are chosen to catch what review misses rather than to argue
about formatting: there are no stylistic rules and no formatter. The one that
earns its place most is `react-hooks/exhaustive-deps` — a wrong dependency
array is a stale closure, and a stale closure in this client means cards that
do not move. Warnings fail the build alongside errors, and an
`eslint-disable` that no longer suppresses anything is itself an error, so
suppressions cannot quietly outlive their reason.

Every pull request runs both suites and a full build in GitHub Actions
(`.github/workflows/ci.yml`). Render deploys off `main`, so that check is the
last gate before a change reaches the table.

The test scripts compile with `tsc -b --force` rather than relying on
incremental state. `tsc -b` decides what to rebuild from file timestamps, and
switching branches can leave a compiled test newer than the source it came
from — which silently runs yesterday's tests against today's code.

The engine suite covers each rule from the brief's test list plus a
random-legal-move simulation that asserts, after every single action, that all
108 cards are still accounted for exactly once and that no hidden card has
leaked into a player's view.

The server suite starts an actual server process and drives real WebSocket
clients through: room creation, the ready gate, private deals, duplicate action
ids, out-of-turn moves, refresh-and-reconnect, session-token forgery, host
migration, team renaming, and a complete round played to scoring and on into
round two. It also kills the server mid-match and restarts it, to prove hands
and turn state come back off disk, and it pins down exactly which rooms the
expiry sweep may delete — that being the only code here that throws a game
away.

The client suite covers the parts of the interface that hold state: hand
ordering (a drawn card lands in its place, a hand the player arranged stays
arranged), the just-picked-up highlight, the card comparators, and the action
bar — including a regression test that its buttons keep the same identity in
every phase, since a button that changes meaning under a waiting player's
finger once turned a tap on "Open with 4+" into a card draw.

The browser suite opens four contexts against the built client and the real
server, and plays. It exists because every bug that reached a player was in the
client and invisible to the other suites — a hand that did not rearrange, a
button that changed meaning under a finger, a name box that could not be typed
into. jsdom dispatches a `change` event with a whole string; a browser sends
keystrokes, which is the difference that hid the last one.

It runs twice: once at a desktop width, once as a phone with touch instead of
a mouse. The phone pass measures rather than eyeballs — no sideways scrolling,
every control at least 44px, action rows level, a whole turn played by tapping.
Writing it turned up three things reading had not: icon buttons at 40px, sort
chips at 34px, and a second action row half again as tall as the first because
two labels wrapped.

Still not covered: an actual handset. Emulation proves the layout, not the
feel — how the cards read in sunlight, whether the fans are tappable with a
real thumb.

## What the interface deliberately does not tell you

Wild cards are not marked. There is no ring, no badge, and the screen reader
label says "6 of hearts" like any other card. Discarding a wild is a mistake a
player is entitled to make, and the next player to take the pile profits from
it — flagging them would quietly remove a decision from the game. The round's
wild rank is displayed on the table, and working out which of your cards match
it is part of playing.

The same reasoning keeps the count of wilds out of the discard pile summary.

## Theming

Every colour in the app comes from one token contract, defined per theme in
`apps/web/src/styles/themes.css` and applied by setting `data-theme` on the
document. Adding a theme means adding a block there and an entry in
`ui/theme.ts` — no component changes. A test asserts each theme defines the
complete contract, because a theme missing one token silently inherits it from
the default and shows a single colour from the wrong palette.

Two things are deliberately outside the themes. Team colours stay red and blue
everywhere, because they identify people rather than decorate the page. Card
faces stay white, because a playing card is white in every room and tinting it
only makes the pips harder to read.

## Reliability

A few properties the server holds to, each with a regression test written from
the scenario that broke it:

- **A room anyone is in always has a reachable host.** The role follows the
  people, not the seat it started in — otherwise a host who is last to leave
  takes the match with them, and the players who return can neither deal the
  next round nor end it.
- **Nothing a client sends is trusted.** Protocol types are erased at runtime,
  so every field is checked at the boundary in `validate.ts`. A seat that is
  not one of the four is refused rather than stored.
- **A turn nobody is playing can be moved past.** After the grace period the
  host may skip a disconnected player, or end the match outright. Nothing is
  drawn or discarded on their behalf.
- **A socket occupies exactly one room.** Joining another releases the first,
  so no room is held open by a player who is not there.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | HTTP + WebSocket port |
| `DATA_DIR` | `./data` | Where room snapshots are written |
| `WEB_DIR` | `apps/web/dist` | Built client to serve |
| `LOBBY_TTL_MS` | 30 min | Empty lobby expiry |
| `FINISHED_TTL_MS` | 24 h | Finished match retention |
| `MAX_MESSAGES_PER_SECOND` | 25 | Per-connection flood limit |

## Deployment

The server serves the built client itself, so a single Node process behind HTTPS
is all it takes:

```bash
npm ci --include=dev && npm run build && npm start
```

`--include=dev` matters wherever `NODE_ENV=production` is set during the build:
TypeScript and Vite are dev dependencies, and without them there is nothing to
build with.

### Render

`render.yaml` describes a free web service. In the Render dashboard choose
**New → Blueprint** and pick this repository; it needs no further configuration.

If the blueprint is ever rejected because the spec has moved on, the same thing
by hand as **New → Web Service** works just as well:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check path | `/health` |
| Environment variable | `NODE_VERSION` = `22` |

Two things to expect on the free plan: the service sleeps after about 15 minutes
without traffic, so the first visitor waits roughly a minute while it wakes; and
its disk does not survive a restart, so `data/` is effectively scratch space and
rooms do not outlive a redeploy. Neither matters for an evening's play. A paid
instance with a disk fixes both.

### Anywhere else

`Dockerfile` builds a self-contained image for hosts that take one (Fly.io,
Koyeb, Cloud Run). Point `DATA_DIR` at a persistent volume to keep games across
restarts.

### One instance only

Rooms live in the server's memory, so **do not scale past a single instance**:
a second one cannot see the first one's rooms, and players would be split across
tables that cannot find each other. Going wider means moving room state into a
shared store — implement the three-method `Store` interface against Redis and
have `RoomManager` read through it rather than its in-process map.
