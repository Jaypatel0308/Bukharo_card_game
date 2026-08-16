# Bukharo

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
npm test          # 73 engine tests + 11 websocket tests
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
packages/game-engine   Pure, deterministic rule engine. No I/O, no framework.
packages/shared        Wire protocol shared by server and client.
apps/server            WebSocket server, rooms, sessions, persistence.
apps/web               React client, mobile-first.
```

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
npm run test:engine   # 73 deterministic rule tests, no I/O
npm run test:server   # 11 tests over real websockets against a real server
```

The engine suite covers each rule from the brief's test list plus a
random-legal-move simulation that asserts, after every single action, that all
108 cards are still accounted for exactly once and that no hidden card has
leaked into a player's view.

The server suite starts an actual server process and drives real WebSocket
clients through: room creation, the ready gate, private deals, duplicate action
ids, out-of-turn moves, refresh-and-reconnect, session-token forgery, host
migration, and a complete round played to scoring and on into round two.

Not covered: browser-level end-to-end tests. The UI has been built and typechecks
against the shared protocol, and the whole client/server contract is exercised
headlessly, but no Playwright/Cypress suite drives the actual rendered interface,
and the interface has not been played by hand on a phone. That is the main gap
before calling the MVP done.

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
is enough:

```bash
npm ci && npm run build && npm start
```

Point a persistent volume at `DATA_DIR`. For more than one server instance,
replace `FileStore` with a shared store (Redis) so rooms are visible to every
instance, and enable sticky sessions or move room state fully into that store.
