/**
 * A player who disappears must not freeze the table for everyone else.
 *
 * The host can skip them, but that fails in the case that matters most: when
 * the host is the one who left, nobody has the button. After the grace period
 * the server plays for them and the game carries on.
 *
 * The grace is set to a second here so the tests do not take two minutes.
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

const GRACE_MS = 1000;
let child;
let dataDir;
let wsUrl;

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bukharo-absent-'));
  child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      PORT: '0',
      DATA_DIR: dataDir,
      SWEEP_INTERVAL_MS: '600000',
      DISCONNECT_GRACE_MS: String(GRACE_MS),
      ABSENT_CHECK_INTERVAL_MS: '100',
    },
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function seatFour(gameId, target) {
  const names = ['Rahul', 'Maya', 'Priya', 'Sam'];
  const host = await new Client(names[0]).connect();
  host.send({
    type: 'room:create',
    actionId: `c-${gameId}-${Math.random()}`,
    displayName: names[0],
    ...(gameId === 'mindi' ? { gameId, target } : { targetScore: target }),
  });
  await host.waitFor((m) => m.type === 'session');
  const code = host.session.roomCode;

  const clients = [host];
  for (const name of names.slice(1)) {
    const client = await new Client(name).connect();
    client.send({ type: 'room:join', actionId: `j-${name}-${code}`, displayName: name, roomCode: code });
    await client.waitFor((m) => m.type === 'session');
    clients.push(client);
  }
  for (const client of clients) client.send({ type: 'player:ready', ready: true });
  await host.waitForState((r) => r.players.every((p) => p.ready));
  host.send({ type: 'game:start', actionId: `s-${code}` });
  for (const client of clients) await client.waitForState((r) => r.game != null);
  return clients;
}

/** Everyone still connected agrees on the state. */
async function settle(clients) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const versions = clients.map((c) => c.room?.game?.view.stateVersion ?? -1);
    if (versions.every((v) => v >= 0 && v === versions[0])) return versions[0];
    await wait(10);
  }
  throw new Error('the table never agreed');
}

describe('the table moves past a player who has gone', () => {
  it('plays for them in Bukharo, without anybody pressing anything', async () => {
    const clients = await seatFour('bukharo', 2000);
    await settle(clients);

    const onTurn = clients[0].room.game.view.currentPlayerId;
    const absent = clients.find((c) => c.room.youId === onTurn);
    const watchers = clients.filter((c) => c !== absent);

    // They vanish mid-turn.
    absent.close();
    await watchers[0].waitForState((r) => r.waitingForPlayerId === onTurn);

    // Nobody touches anything — no skip is sent.
    const moved = await watchers[0].waitForState(
      (r) => r.game != null && r.game.view.currentPlayerId !== onTurn,
      15000,
    );

    assert.notEqual(moved.game.view.currentPlayerId, onTurn, 'the turn should have moved on');
    assert.equal(moved.waitingForPlayerId, null, 'nobody should still be waited on');
    assert.equal(moved.status, 'PLAYING', 'the match carries on');

    for (const client of watchers) client.close();
  });

  it('plays for them in Mindi too', async () => {
    const clients = await seatFour('mindi', 3);
    await settle(clients);

    // Get past the trump choice so it is an ordinary turn that stalls.
    const chooserId = clients[0].room.game.view.chooserId;
    const chooser = clients.find((c) => c.room.youId === chooserId);
    chooser.send({
      type: 'game:action',
      actionId: 'mode',
      action: { type: 'CHOOSE_MODE', mode: 'KATTE' },
    });
    for (const client of clients) {
      await client.waitForState((r) => r.game?.view.status === 'PLAYING');
    }
    await settle(clients);

    const onTurn = clients[0].room.game.view.currentPlayerId;
    const absent = clients.find((c) => c.room.youId === onTurn);
    const watchers = clients.filter((c) => c !== absent);
    const trickBefore = watchers[0].room.game.view.currentTrick.plays.length;

    absent.close();
    await watchers[0].waitForState((r) => r.waitingForPlayerId === onTurn);

    const moved = await watchers[0].waitForState(
      (r) => r.game != null && r.game.view.currentPlayerId !== onTurn,
      15000,
    );

    // A card was actually played for them, not merely a turn skipped.
    const trickAfter = moved.game.view.currentTrick.plays.length;
    assert.equal(
      trickAfter === trickBefore + 1 || trickAfter === 0,
      true,
      'a card should have been played on their behalf',
    );
    assert.equal(moved.waitingForPlayerId, null);

    for (const client of watchers) client.close();
  });

  it('keeps going when the next player has gone as well', async () => {
    // The backstop starts a clock on whoever it hands the turn to, so a table
    // where two people in a row have vanished frees itself rather than
    // stalling one seat further along.
    const clients = await seatFour('bukharo', 2000);
    await settle(clients);

    const view = clients[0].room.game.view;
    const order = view.players.map((p) => p.id);
    const onTurn = view.currentPlayerId;
    const nextUp = order[(order.indexOf(onTurn) + 1) % order.length];

    const gone = clients.filter((c) => c.room.youId === onTurn || c.room.youId === nextUp);
    const watchers = clients.filter((c) => !gone.includes(c));
    assert.equal(gone.length, 2, 'two players should be leaving');
    assert.equal(watchers.length, 2);

    for (const client of gone) client.close();
    await watchers[0].waitForState((r) => r.waitingForPlayerId === onTurn);

    // The turn has to travel past both of them, with nobody pressing anything.
    const moved = await watchers[0].waitForState(
      (r) =>
        r.game != null &&
        r.game.view.currentPlayerId !== onTurn &&
        r.game.view.currentPlayerId !== nextUp,
      20000,
    );

    const stillHere = watchers.map((c) => c.room.youId);
    assert.ok(
      stillHere.includes(moved.game.view.currentPlayerId),
      'the turn should have reached somebody who is actually here',
    );
    assert.equal(moved.waitingForPlayerId, null, 'nobody is left being waited on');

    for (const client of watchers) client.close();
  });

  it('leaves a player alone if they come back inside the grace', async () => {
    const clients = await seatFour('bukharo', 2000);
    await settle(clients);

    const onTurn = clients[0].room.game.view.currentPlayerId;
    const absent = clients.find((c) => c.room.youId === onTurn);
    const token = absent.session.sessionToken;
    const watcher = clients.find((c) => c !== absent);

    absent.close();
    await watcher.waitForState((r) => r.waitingForPlayerId === onTurn);

    // Straight back, well inside the grace.
    const returning = await new Client('returning').connect();
    returning.send({ type: 'session:resume', sessionToken: token });
    await returning.waitForState((r) => r.game != null);
    await watcher.waitForState((r) => r.waitingForPlayerId === null);

    // Give the backstop several chances to fire wrongly.
    await wait(GRACE_MS * 3);

    assert.equal(
      watcher.room.game.view.currentPlayerId,
      onTurn,
      'a player who came back must keep their turn',
    );

    returning.close();
    for (const client of clients) client.close();
  });
});
