/**
 * Mindi through the room layer.
 *
 * The point is not to re-test the rules — the engine suite does that without a
 * socket in sight — but to prove the registry carries a second game with no
 * change to rooms, sessions or presence.
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
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bukharo-mindi-'));
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
  waitForState(check, timeoutMs = 20000) {
    return this.waitFor((m) => m.type === 'room:state' && check(m.room), timeoutMs).then((m) => m.room);
  }
  close() {
    this.ws?.close();
  }
}

const NAMES = ['Rahul', 'Maya', 'Priya', 'Sam', 'Nina', 'Omar', 'Zara', 'Kabir'];

async function seat(count) {
  const host = await new Client(NAMES[0]).connect();
  host.send({
    type: 'room:create',
    actionId: `c${Math.random()}`,
    displayName: NAMES[0],
    target: 3,
    gameId: 'mindi',
  });
  await host.waitForState((r) => r.players.length === 1);
  const code = host.session.roomCode;

  const all = [host];
  for (const name of NAMES.slice(1, count)) {
    const client = await new Client(name).connect();
    client.send({ type: 'room:join', actionId: `j${name}${Math.random()}`, displayName: name, roomCode: code });
    await client.waitForState((r) => r.players.length > 0);
    all.push(client);
  }
  await host.waitForState((r) => r.players.length === count);
  return { host, all, code };
}

async function start(all, host) {
  for (const client of all) client.send({ type: 'player:ready', ready: true });
  await host.waitForState((r) => r.players.every((p) => p.ready) && r.players.length === all.length);
  host.send({ type: 'game:start', actionId: `s${Math.random()}` });
  for (const client of all) await client.waitForState((r) => r.status === 'PLAYING' && r.game);
}

describe('a Mindi room', () => {
  it('seats eight and deals the right hand to each', async () => {
    const { host, all } = await seat(8);
    assert.equal(host.room.gameId, 'mindi');
    await start(all, host);

    for (const client of all) {
      assert.equal(client.room.game.gameId, 'mindi');
      assert.equal(client.room.game.view.you.hand.length, 13);
      assert.equal(client.room.game.view.players.length, 8);
    }
    for (const client of all) client.close();
  });

  it('refuses to start on a count the game cannot use', async () => {
    const { host, all } = await seat(5);
    assert.match(host.room.cannotStartReason, /1 more to play 6, or 3 more to play 8/);

    for (const client of all) client.send({ type: 'player:ready', ready: true });
    await host.waitForState((r) => r.players.every((p) => p.ready));
    host.send({ type: 'game:start', actionId: 'nope' });

    const error = await host.waitFor((m) => m.type === 'error');
    assert.equal(error.error.code, 'NOT_READY');
    assert.match(error.error.message, /Mindi needs 4, 6 or 8 players/);
    for (const client of all) client.close();
  });

  it('shows the hidden trump to the player who hid it and to nobody else', async () => {
    const { host, all } = await seat(4);
    await start(all, host);

    const chooserId = host.room.game.view.chooserId;
    const chooser = all.find((c) => c.room.youId === chooserId);
    chooser.send({ type: 'game:action', actionId: 'mode', action: { type: 'CHOOSE_MODE', mode: 'HIDDEN' } });
    await chooser.waitForState((r) => r.game?.view.status === 'PLAYING');

    const hidden = chooser.room.game.view.yourHiddenCard;
    assert.ok(hidden, 'the chooser should be told what they hid');

    // Each socket is updated separately, so every client is given a chance to
    // hear about the hidden card before being asked what it can see.
    for (const client of all) await client.waitForState((r) => r.game?.view.mode === 'HIDDEN');

    for (const client of all) {
      if (client === chooser) continue;
      assert.equal(client.room.game.view.yourHiddenCard, null);
      assert.equal(client.room.game.view.hiddenCardWaiting, true);
      assert.equal(
        JSON.stringify(client.messages).includes(`"${hidden.id}"`),
        false,
        'the hidden trump leaked',
      );
    }
    for (const client of all) client.close();
  });

  it('plays a trick, and only from the player whose turn it is', async () => {
    const { host, all } = await seat(4);
    await start(all, host);

    const chooserId = host.room.game.view.chooserId;
    const chooser = all.find((c) => c.room.youId === chooserId);
    chooser.send({ type: 'game:action', actionId: 'mode2', action: { type: 'CHOOSE_MODE', mode: 'KATTE' } });
    await chooser.waitForState((r) => r.game?.view.status === 'PLAYING');

    const leaderId = host.room.game.view.currentPlayerId;
    const leader = all.find((c) => c.room.youId === leaderId);
    const other = all.find((c) => c.room.youId !== leaderId);

    other.send({
      type: 'game:action',
      actionId: 'outofturn',
      action: { type: 'PLAY_CARD', cardId: other.room.game.view.you.hand[0].id },
    });
    const error = await other.waitFor((m) => m.type === 'error' && m.error.actionId === 'outofturn');
    assert.equal(error.error.code, 'NOT_YOUR_TURN');

    const led = leader.room.game.view.you.hand[0];
    leader.send({ type: 'game:action', actionId: 'lead', action: { type: 'PLAY_CARD', cardId: led.id } });
    const after = await leader.waitForState((r) => r.game?.view.currentTrick.plays.length === 1);

    assert.equal(after.game.view.currentTrick.plays[0].card.id, led.id);
    assert.equal(after.game.view.you.hand.length, 12);
    for (const client of all) client.close();
  });

  it('keeps every player’s hand to themselves', async () => {
    const { host, all } = await seat(6);
    await start(all, host);

    const hands = new Map();
    for (const client of all) hands.set(client.room.youId, client.room.game.view.you.hand.map((c) => c.id));

    for (const client of all) {
      const raw = JSON.stringify(client.messages);
      for (const [playerId, ids] of hands) {
        if (playerId === client.room.youId) continue;
        for (const id of ids) {
          assert.equal(raw.includes(`"${id}"`), false, `${client.name} saw ${id}`);
        }
      }
    }
    for (const client of all) client.close();
  });

  it('rejects an action that belongs to the other game', async () => {
    const { host, all } = await seat(4);
    await start(all, host);

    // Bukharo's vocabulary means nothing here, and must not reach the engine.
    host.send({ type: 'game:action', actionId: 'wrong', action: { type: 'DRAW_STOCK' } });
    const error = await host.waitFor((m) => m.type === 'error' && m.error.actionId === 'wrong');
    assert.equal(error.error.code, 'INVALID_MESSAGE');
    for (const client of all) client.close();
  });
});
