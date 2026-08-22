/**
 * One server, both games, and everybody moving at once.
 *
 * Every other suite gives a game a server to itself and takes turns politely.
 * Neither is what a real evening looks like: two rooms playing different games
 * on the same process, and eight people tapping at the same moment.
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

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bukharo-conc-'));
  child = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, SWEEP_INTERVAL_MS: '600000' },
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
});

after(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
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

/** A card this player could legally put down, following suit when they must. */
function legalCard(view) {
  const hand = view.you?.hand ?? [];
  if (hand.length === 0) return null;
  const lead = view.currentTrick.leadSuit;
  if (lead) {
    const following = hand.filter((card) => card.suit === lead);
    if (following.length > 0) return following[0];
  }
  if (view.mustPlayTrumpBy === view.you.id && view.trumpSuit) {
    const trumps = hand.filter((card) => card.suit === view.trumpSuit);
    if (trumps.length > 0) return trumps[0];
  }
  return hand[0];
}

/** Seats `count` players in a new room of `gameId` and starts the match. */
async function table(gameId, count, target, prefix) {
  const names = Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
  const host = await new Client(names[0]).connect();
  host.send({
    type: 'room:create',
    actionId: `${prefix}-create`,
    displayName: names[0],
    target,
    gameId,
  });
  await host.waitFor((m) => m.type === 'session');
  const code = host.session.roomCode;

  const clients = [host];
  for (const name of names.slice(1)) {
    const client = await new Client(name).connect();
    client.send({ type: 'room:join', actionId: `${prefix}-join-${name}`, displayName: name, roomCode: code });
    await client.waitFor((m) => m.type === 'session');
    clients.push(client);
  }

  for (const client of clients) client.send({ type: 'player:ready', ready: true });
  await host.waitForState((r) => r.players.length === count && r.players.every((p) => p.ready));
  host.send({ type: 'game:start', actionId: `${prefix}-start` });
  for (const client of clients) await client.waitForState((r) => r.game != null);

  return { code, clients, host };
}

describe('two games running on one server', () => {
  it('keeps the rooms entirely apart', async () => {
    // Interleaved on purpose: both tables are set up and played at once, so a
    // shared mutable anywhere in the registry has a chance to show itself.
    const [bukharo, mindi] = await Promise.all([
      table('bukharo', 4, 2000, 'buk'),
      table('mindi', 4, 3, 'min'),
    ]);

    assert.notEqual(bukharo.code, mindi.code, 'two rooms shared a code');

    for (const client of bukharo.clients) {
      assert.equal(client.room.gameId, 'bukharo');
      assert.equal(client.room.game.gameId, 'bukharo');
      assert.equal(client.room.players.length, 4);
    }
    for (const client of mindi.clients) {
      assert.equal(client.room.gameId, 'mindi');
      assert.equal(client.room.game.gameId, 'mindi');
      assert.equal(client.room.players.length, 4);
    }

    // Each game's own shape, not a blend of the two.
    const bukharoView = bukharo.host.room.game.view;
    const mindiView = mindi.host.room.game.view;
    assert.ok('stockCount' in bukharoView, 'the Bukharo table lost its stock');
    assert.ok('trumpSuit' in mindiView, 'the Mindi table lost its trump');
    assert.equal('trumpSuit' in bukharoView, false, 'Mindi state reached the Bukharo room');
    assert.equal('stockCount' in mindiView, false, 'Bukharo state reached the Mindi room');

    // Card ids are deliberately not compared. Each engine mints its own in the
    // same `d1-7H` shape, so the two rooms overlap by design — the ids are
    // local to a game, and sharing one says nothing about state leaking.

    // A move at one table leaves the other exactly where it was.
    const mindiVersionBefore = mindiView.stateVersion;
    const onTurn = bukharo.clients.find((c) => c.room.youId === bukharoView.currentPlayerId);
    onTurn.send({ type: 'game:action', actionId: 'cross-draw', action: { type: 'DRAW_STOCK' } });
    await onTurn.waitForState((r) => r.game?.view.turnPhase === 'PLAYING_CARDS');
    await wait(150);

    assert.equal(
      mindi.host.room.game.view.stateVersion,
      mindiVersionBefore,
      'a Bukharo move disturbed the Mindi table',
    );

    // Renaming a team in one room must not rename it in the other.
    bukharo.host.send({ type: 'host:teamName', teamId: 'TEAM_A', name: 'Rockets' });
    await bukharo.host.waitForState((r) => r.teamNames.TEAM_A === 'Rockets');
    await wait(150);
    assert.equal(mindi.host.room.teamNames.TEAM_A, 'Team A', 'a team name crossed rooms');

    for (const client of [...bukharo.clients, ...mindi.clients]) client.close();
  });
});

describe('eight players moving at once', () => {
  it('serialises a burst of simultaneous actions without corrupting the hand', async () => {
    const { clients, host } = await table('mindi', 8, 3, 'oct');
    assert.equal(host.room.players.length, 8);

    // Everyone chooses at once, though only the chooser may.
    const chooserId = host.room.game.view.chooserId;
    await Promise.all(
      clients.map((client, i) =>
        Promise.resolve().then(() =>
          client.send({
            type: 'game:action',
            actionId: `burst-mode-${i}`,
            action: { type: 'CHOOSE_MODE', mode: 'KATTE' },
          }),
        ),
      ),
    );
    await host.waitForState((r) => r.game?.view.status === 'PLAYING');
    await wait(250);

    // Exactly one choice took effect, and the seven others were refused.
    const refusals = clients.reduce((n, c) => n + c.errors.length, 0);
    assert.equal(refusals, clients.length - 1, `expected 7 refusals, saw ${refusals}`);
    assert.equal(host.room.game.view.mode, 'KATTE');
    for (const client of clients) {
      if (client.room.youId === chooserId) continue;
      assert.ok(
        client.errors.every((e) => e.code !== 'INTERNAL'),
        'a rejected action faulted rather than being refused',
      );
    }

    // Now everybody tries to play a card at the same moment, though only one
    // of them is on turn. Actions that are legal when they are reached are
    // meant to be applied — as the turn moves, a queued play becomes that
    // player's — so what matters is not how many land but that they land in
    // strict turn order, once each, and leave the deal intact.
    const order = host.room.game.view.players.map((p) => p.id);

    for (let burst = 0; burst < 3; burst++) {
      const version = host.room.game.view.stateVersion;
      await Promise.all(
        clients.map((client, i) => {
          const card = legalCard(client.room.game.view);
          if (!card) return Promise.resolve();
          return Promise.resolve().then(() =>
            client.send({
              type: 'game:action',
              actionId: `burst-play-${burst}-${i}`,
              action: { type: 'PLAY_CARD', cardId: card.id },
            }),
          );
        }),
      );
      await host.waitForState((r) => (r.game?.view.stateVersion ?? -1) > version);
      await wait(300);
    }

    const view = host.room.game.view;

    // A burst can land exactly the last card of a trick, which clears the
    // current one and files it as the last — so read whichever holds the plays.
    const trick =
      view.currentTrick.plays.length > 0 ? view.currentTrick : (view.lastTrick ?? view.currentTrick);

    // Whatever landed, it went round the table in order and nobody played twice.
    const played = trick.plays.map((p) => p.playerId);
    assert.ok(played.length > 0, 'the burst achieved nothing at all');
    assert.equal(new Set(played).size, played.length, 'a player got two cards into one trick');
    // The rotation is measured from whoever led the trick on display: enough
    // cards can land in three bursts to finish a trick and begin the next.
    const leadAt = order.indexOf(played[0]);
    for (const [i, playerId] of played.entries()) {
      assert.equal(
        playerId,
        order[(leadAt + i) % order.length],
        `play ${i} came from the wrong seat — the turn order was not respected`,
      );
    }

    // Nothing faulted; every refusal was a refusal, not a crash.
    for (const client of clients) {
      assert.ok(
        client.errors.every((e) => e.code !== 'INTERNAL'),
        `${client.name} caused an internal error under load`,
      );
    }

    // And the deal is still whole.
    const inHands = view.players.reduce((n, p) => n + p.handCount, 0);
    const inFinishedTricks = view.tricksPlayed * order.length;
    assert.equal(
      inHands + view.currentTrick.plays.length + inFinishedTricks,
      104,
      'cards went missing during the burst',
    );

    for (const client of clients) client.close();
  });
});

describe('a game this server does not have', () => {
  it('is refused rather than quietly turned into a Bukharo room', async () => {
    const client = await new Client('curious').connect();
    client.send({
      type: 'room:create',
      actionId: 'bogus',
      displayName: 'Curious',
      target: 2000,
      gameId: 'poker',
    });

    const error = await client.waitFor((m) => m.type === 'error');
    assert.equal(error.error.code, 'UNKNOWN_GAME');
    assert.equal(error.error.actionId, 'bogus');

    // And no room was made behind the refusal.
    await wait(150);
    assert.equal(client.room, null, 'a room was created for a game that does not exist');
    client.close();
  });

  it('still defaults to Bukharo when no game is named at all', async () => {
    // An older client that predates the picker sends nothing.
    const client = await new Client('old-client').connect();
    client.send({ type: 'room:create', actionId: 'legacy', displayName: 'Old', target: 2000 });
    const state = await client.waitForState(() => true);
    assert.equal(state.gameId, 'bukharo');
    client.close();
  });
});
