/**
 * A whole Mindi hand, and then the next one, played over real sockets.
 *
 * The engine suite plays hands without a server; this proves the room carries
 * one — every trick, the hand ending, the tally, and dealing again.
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
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bukharo-mfull-'));
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
  close() {
    this.ws?.close();
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Everyone agrees on the state before the next decision is made. */
async function sync(clients) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const versions = clients.map((c) => c.room?.game?.view.stateVersion ?? -1);
    if (versions.every((v) => v >= 0 && v === versions[0])) return versions[0];
    await wait(5);
  }
  throw new Error('the table never agreed on a state');
}

/**
 * Sends an action and waits for the state it produced.
 *
 * The version has to move. `waitFor` searches messages already received, so
 * waiting for any `room:state` matches one from before the send and returns
 * while the action is still in flight — which is how this test first passed
 * without playing a single card.
 */
async function act(client, action) {
  const actionId = `${client.name}-${Date.now()}-${Math.random()}`;
  const before = client.room?.game?.view.stateVersion ?? -1;
  const settled = Promise.race([
    client
      .waitFor(
        (m) => m.type === 'room:state' && (m.room.game?.view.stateVersion ?? -1) > before,
        15000,
      )
      .then(() => 'ok'),
    client
      .waitFor((m) => m.type === 'error' && m.error.actionId === actionId, 4000)
      .then((m) => `error:${m.error.code}`),
  ]).catch(() => 'timeout');
  client.send({ type: 'game:action', actionId, action });
  return settled;
}

describe('a Mindi hand over the wire', () => {
  it('plays every trick, scores the hand and deals the next', async () => {
    const names = ['Rahul', 'Maya', 'Priya', 'Sam'];
    const host = await new Client(names[0]).connect();
    host.send({ type: 'room:create', actionId: 'c', displayName: names[0], target: 3, gameId: 'mindi' });
    await host.waitFor((m) => m.type === 'session');
    const code = host.session.roomCode;

    const clients = [host];
    for (const name of names.slice(1)) {
      const client = await new Client(name).connect();
      client.send({ type: 'room:join', actionId: `j${name}`, displayName: name, roomCode: code });
      await client.waitFor((m) => m.type === 'session');
      clients.push(client);
    }
    for (const client of clients) client.send({ type: 'player:ready', ready: true });
    await host.waitFor((m) => m.type === 'room:state' && m.room.players.every((p) => p.ready));
    host.send({ type: 'game:start', actionId: 's' });
    for (const client of clients) {
      await client.waitFor((m) => m.type === 'room:state' && m.room.game);
    }
    await sync(clients);

    // The chooser decides how trump is set.
    const chooserId = host.room.game.view.chooserId;
    const chooser = clients.find((c) => c.room.youId === chooserId);
    await act(chooser, { type: 'CHOOSE_MODE', mode: Math.random() < 0.5 ? 'HIDDEN' : 'KATTE' });
    await sync(clients);

    // Play the hand out, one legal card at a time.
    let plays = 0;
    while (host.room.game.view.status === 'PLAYING' && plays < 100) {
      await sync(clients);
      const view = host.room.game.view;
      if (view.status !== 'PLAYING') break;

      const player = clients.find((c) => c.room.youId === view.currentPlayerId);
      const own = player.room.game.view;
      const lead = own.currentTrick.leadSuit;
      const following = lead ? own.you.hand.filter((c) => c.suit === lead) : [];
      let legal = following.length > 0 ? following : own.you.hand;
      if (own.mustPlayTrumpBy === own.you.id && own.trumpSuit) {
        const trumps = own.you.hand.filter((c) => c.suit === own.trumpSuit);
        if (trumps.length > 0) legal = trumps;
      }

      const chosen = legal[Math.floor(Math.random() * legal.length)];
      await act(player, { type: 'PLAY_CARD', cardId: chosen.id });
      plays++;

      // Nobody's hand may ever hold more than was dealt.
      for (const client of clients) {
        if (client.room.game) {
          assert.ok(client.room.game.view.you.hand.length <= 13, 'a hand grew');
        }
      }
    }

    assert.ok(plays < 100, 'the hand should finish inside the play budget');
    await sync(clients);

    const view = host.room.game.view;
    assert.equal(view.status === 'HAND_END' || view.status === 'MATCH_END', true);
    assert.equal(view.tricksPlayed, 13, 'four players deal thirteen tricks');

    // Every Mindi found an owner, and every trick was counted.
    const result = view.handHistory.at(-1);
    assert.equal(result.mindis.TEAM_A + result.mindis.TEAM_B, 4);
    assert.equal(result.tricks.TEAM_A + result.tricks.TEAM_B, 13);
    assert.ok(result.winningTeamId);

    // A sweep is the only thing that moves a Kot.
    const kot = result.kotAfter.TEAM_A + result.kotAfter.TEAM_B;
    if (!result.sweep) assert.equal(kot, 0);

    if (view.status === 'HAND_END') {
      host.send({ type: 'round:next', actionId: 'next' });
      const next = await host.waitFor(
        (m) => m.type === 'room:state' && m.room.game?.view.handNumber === 2,
      ).then((m) => m.room);

      assert.equal(next.status, 'PLAYING');
      assert.equal(next.game.view.status, 'CHOOSING_MODE');
      assert.equal(next.game.view.trumpSuit, null);
      assert.equal(next.game.view.you.hand.length, 13);
      assert.equal(next.game.view.handHistory.length, 1, 'the record of hand one survives');
      // The losers deal, a winner chooses.
      const dealer = next.game.view.players.find((p) => p.id === next.game.view.dealerId);
      assert.notEqual(dealer.teamId, result.winningTeamId);
    }

    for (const client of clients) client.close();
  });
});
