/**
 * The promises the platform makes about every game it hosts.
 *
 * Each game has its own suite for its own rules. This one runs the same
 * battery against all three, so a guarantee cannot quietly hold for two games
 * and not the third — and so a fourth game has to satisfy it to be added.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import WebSocket from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(here, '../dist/index.js');

let child;
let dataDir;
let wsUrl;

async function startServer(extraEnv = {}) {
  child = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, SWEEP_INTERVAL_MS: '600000', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 30000);
    child.stdout.on('data', (data) => {
      const match = /listening on http:\/\/[^:]+:(\d+)/.exec(data.toString());
      if (match) {
        clearTimeout(timer);
        resolve(`ws://127.0.0.1:${match[1]}/ws`);
      }
    });
  });
}

async function stopServer() {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
}

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bukharo-allgames-'));
  await startServer();
});

after(async () => {
  await stopServer();
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
});

class Client {
  constructor(name) {
    this.name = name;
    this.messages = [];
    this.errors = [];
    this.room = null;
    this.session = null;
    this.waiters = [];
  }
  async connect() {
    this.ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      this.messages.push(message);
      if (message.type === 'room:state') this.room = message.room;
      if (message.type === 'session') this.session = message;
      if (message.type === 'error') this.errors.push(message.error);
      for (const waiter of [...this.waiters]) {
        if (waiter.predicate(message)) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    });
    return this;
  }
  send(message) {
    this.ws.send(JSON.stringify(message));
  }
  waitFor(predicate, timeoutMs = 20000) {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
          reject(new Error(`${this.name}: timed out`));
        }
      }, timeoutMs).unref();
    });
  }
  waitForState(check, timeoutMs = 20000) {
    return this.waitFor((m) => m.type === 'room:state' && check(m.room), timeoutMs).then(
      (m) => m.room,
    );
  }
  close() {
    this.ws?.close();
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The three games, and the least each one needs to be driven generically.
 *
 * `nextAction` returns a legal move for whoever is on turn, read from that
 * player's own view — the same information their table has, and nothing more.
 */
const GAMES = [
  {
    id: 'bukharo',
    players: 4,
    target: 2000,
    create: (name) => ({ displayName: name, targetScore: 2000 }),
    actorId: (view) => view.currentPlayerId,
    nextAction(view) {
      if (view.turnPhase === 'AWAITING_DRAW') return { type: 'DRAW_STOCK' };
      const hand = view.you.hand;
      return { type: 'DISCARD', cardId: hand[hand.length - 1].id };
    },
  },
  {
    id: 'mindi',
    players: 4,
    target: 3,
    create: (name) => ({ displayName: name, gameId: 'mindi', target: 3 }),
    // While trump is being settled the player who must act is the chooser,
    // who is not necessarily the one whose turn it is to play a card.
    actorId: (view) => (view.status === 'CHOOSING_MODE' ? view.chooserId : view.currentPlayerId),
    nextAction(view) {
      if (view.status === 'CHOOSING_MODE') return { type: 'CHOOSE_MODE', mode: 'KATTE' };
      const hand = view.you.hand;
      const lead = view.currentTrick.leadSuit;
      const following = lead ? hand.filter((c) => c.suit === lead) : [];
      const pick = following.length > 0 ? following[0] : hand[0];
      return { type: 'PLAY_CARD', cardId: pick.id };
    },
  },
  {
    id: 'judgement',
    players: 4,
    target: 4,
    create: (name) => ({ displayName: name, gameId: 'judgement', target: 4 }),
    actorId: (view) => view.currentPlayerId,
    nextAction(view) {
      if (view.status === 'BIDDING') return { type: 'PLACE_BID', bid: view.yourLegalBids[0] };
      return { type: 'PLAY_CARD', cardId: view.yourLegalCardIds[0] };
    },
  },
];

async function settle(clients) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const versions = clients.map((c) => c.room?.game?.view.stateVersion ?? -1);
    if (versions.every((v) => v >= 0 && v === versions[0])) return versions[0];
    await wait(5);
  }
  throw new Error('the table never agreed on a state');
}

async function seat(game) {
  const names = ['Rahul', 'Maya', 'Priya', 'Sam'];
  const host = await new Client(names[0]).connect();
  host.send({ type: 'room:create', actionId: `c${game.id}${Math.random()}`, ...game.create(names[0]) });
  await host.waitFor((m) => m.type === 'session');
  const code = host.session.roomCode;

  const clients = [host];
  for (const name of names.slice(1, game.players)) {
    const client = await new Client(name).connect();
    client.send({ type: 'room:join', actionId: `j${name}${code}`, displayName: name, roomCode: code });
    await client.waitFor((m) => m.type === 'session');
    clients.push(client);
  }
  for (const client of clients) client.send({ type: 'player:ready', ready: true });
  await host.waitForState((r) => r.players.every((p) => p.ready));
  host.send({ type: 'game:start', actionId: `s${code}` });
  for (const client of clients) await client.waitForState((r) => r.game != null);
  await settle(clients);
  return { clients, code };
}

/** Sends an action and waits for the state it produced, or the refusal. */
async function act(client, action, actionId) {
  const id = actionId ?? `${client.name}-${Date.now()}-${Math.random()}`;
  const before = client.room?.game?.view.stateVersion ?? -1;
  const settled = Promise.race([
    client
      .waitFor(
        (m) => m.type === 'room:state' && (m.room.game?.view.stateVersion ?? -1) > before,
        15000,
      )
      .then(() => 'ok'),
    client
      .waitFor((m) => m.type === 'error' && m.error.actionId === id, 4000)
      .then((m) => `error:${m.error.code}`),
  ]).catch(() => 'timeout');
  client.send({ type: 'game:action', actionId: id, action });
  return settled;
}

/**
 * Whoever the game is actually waiting on.
 *
 * Not always the player whose turn it is: Mindi settles trump with the chooser
 * before ordinary play begins, and asking the wrong one produced a move that
 * was legal after all, which is how this helper came to exist.
 */
function actor(game, clients) {
  const view = clients[0].room.game.view;
  const id = game.actorId(view);
  return clients.find((c) => c.room.youId === id);
}

for (const game of GAMES) {
  describe(`${game.id}: what the platform guarantees`, () => {
    it('never puts another player’s cards in your view', async () => {
      const { clients } = await seat(game);

      // Play a while, checking after every move rather than only at the deal.
      for (let move = 0; move < 12; move++) {
        await settle(clients);
        for (const client of clients) {
          const view = client.room.game.view;
          const mine = new Set((view.you?.hand ?? []).map((c) => c.id));

          // Whatever the shape of a seat in this game, it carries no cards.
          for (const seatView of view.players) {
            assert.equal(
              'hand' in seatView,
              false,
              `${game.id} sent ${seatView.displayName ?? seatView.id}'s hand to ${client.name}`,
            );
          }

          // And no card id belonging to somebody else appears anywhere in the
          // seat list, whatever it might be nested inside.
          const others = clients.filter((c) => c !== client);
          const seatText = JSON.stringify(view.players);
          for (const other of others) {
            for (const card of other.room.game.view.you?.hand ?? []) {
              if (mine.has(card.id)) continue;
              assert.equal(
                seatText.includes(`"${card.id}"`),
                false,
                `${game.id} leaked ${card.id} to ${client.name}`,
              );
            }
          }
        }

        const player = actor(game, clients);
        if (!player) break;
        const result = await act(player, game.nextAction(player.room.game.view));
        if (result !== 'ok') break;
      }

      for (const client of clients) client.close();
    });

    it('applies a repeated action once, however many times it arrives', async () => {
      const { clients } = await seat(game);
      const player = actor(game, clients);
      const action = game.nextAction(player.room.game.view);
      const actionId = `duplicate-${game.id}`;

      await act(player, action, actionId);
      const after = player.room.game.view.stateVersion;

      // The same action twice more: a double tap, then a retry after a flaky
      // socket. Neither may count.
      player.send({ type: 'game:action', actionId, action });
      player.send({ type: 'game:action', actionId, action });
      await wait(400);

      assert.equal(
        player.room.game.view.stateVersion,
        after,
        `${game.id} applied a repeated action more than once`,
      );

      for (const client of clients) client.close();
    });

    it('refuses an action belonging to a different game', async () => {
      const { clients } = await seat(game);
      const player = actor(game, clients);

      // Every game gets sent every other game's opening move.
      const foreign = [
        { type: 'DRAW_STOCK' },
        { type: 'CHOOSE_MODE', mode: 'KATTE' },
        { type: 'PLACE_BID', bid: 0 },
      ].filter((action) => {
        const own = game.nextAction(player.room.game.view);
        return action.type !== own.type;
      });

      for (const action of foreign) {
        const outcome = await act(player, action);
        assert.match(
          outcome,
          /^(error:|timeout)/,
          `${game.id} accepted ${action.type}, which belongs to another game`,
        );
      }

      for (const client of clients) client.close();
    });

    it('gives you your own hand back when you reconnect', async () => {
      const { clients } = await seat(game);
      const player = clients[1];
      const token = player.session.sessionToken;
      const before = (player.room.game.view.you?.hand ?? []).map((c) => c.id);
      assert.ok(before.length > 0, `${game.id} should deal ${player.name} something`);

      player.close();
      await clients[0].waitForState((r) => r.players.some((p) => !p.connected));

      const returning = await new Client(`${player.name} again`).connect();
      returning.send({ type: 'session:resume', sessionToken: token });
      const room = await returning.waitForState((r) => r.game != null);

      assert.deepEqual(
        (room.game.view.you?.hand ?? []).map((c) => c.id),
        before,
        `${game.id} did not restore the same hand`,
      );
      assert.equal(room.game.gameId, game.id);

      returning.close();
      for (const client of clients) client.close();
    });

    it('refuses a move from somebody whose turn it is not', async () => {
      const { clients } = await seat(game);
      const player = actor(game, clients);
      const other = clients.find((c) => c !== player);
      const outcome = await act(other, game.nextAction(player.room.game.view));
      assert.match(outcome, /^(error:|timeout)/, `${game.id} let the wrong player move`);
      for (const client of clients) client.close();
    });

    it('keeps the log and history bounded, so a long match cannot grow forever', async () => {
      const { clients } = await seat(game);
      for (let move = 0; move < 30; move++) {
        await settle(clients);
        const player = actor(game, clients);
        if (!player) break;
        const result = await act(player, game.nextAction(player.room.game.view));
        if (result !== 'ok') break;
      }
      const view = clients[0].room.game.view;
      assert.ok(view.log.length <= 60, `${game.id} sent ${view.log.length} log lines`);
      const history = view.roundHistory ?? view.handHistory ?? [];
      assert.ok(history.length <= 12, `${game.id} sent ${history.length} rounds of history`);
      for (const client of clients) client.close();
    });
  });
}

describe('every game is registered consistently', () => {
  it('can be created, started and played by the same protocol', async () => {
    // Not a rule check: proof that adding a game needs nothing new from the
    // room, the session, the socket or the client protocol.
    for (const game of GAMES) {
      const { clients } = await seat(game);
      assert.equal(clients[0].room.gameId, game.id);
      assert.ok(clients[0].room.game, `${game.id} produced no view`);
      assert.equal(clients[0].room.status, 'PLAYING');
      for (const client of clients) client.close();
    }
  });
});
