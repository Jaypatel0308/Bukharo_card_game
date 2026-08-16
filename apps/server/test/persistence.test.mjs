/**
 * §61 — a server restart must not destroy games in progress.
 *
 * This is the one path that runs on every single boot and had never been
 * tested: rooms are written to disk, the process dies, a new process reads them
 * back, and players reconnect into the seats and hands they left behind.
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

let dataDir;
let child;
let wsUrl;

/** Boots a server on an OS-assigned port against the shared data directory. */
async function startServer() {
  const proc = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, SWEEP_INTERVAL_MS: '600000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 30000);
    proc.stdout.on('data', (data) => {
      const match = /listening on http:\/\/[^:]+:(\d+)/.exec(data.toString());
      if (match) {
        clearTimeout(timer);
        resolve(`ws://127.0.0.1:${match[1]}/ws`);
      }
    });
  });
  child = proc;
  wsUrl = url;
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
}

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

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bukharo-persist-'));
  await startServer();
});

after(async () => {
  await stopServer();
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
});

describe('surviving a restart (§61)', () => {
  it('brings a match in progress back, hands and all', async () => {
    // --- before the restart ---
    const host = await new Client('Rahul').connect();
    host.send({ type: 'room:create', actionId: 'c1', displayName: 'Rahul', targetScore: 2000 });
    await host.waitFor((m) => m.type === 'session');
    const code = host.session.roomCode;
    const hostToken = host.session.sessionToken;

    const clients = [host];
    for (const name of ['Maya', 'Priya', 'Sam']) {
      const client = await new Client(name).connect();
      client.send({ type: 'room:join', actionId: `j-${name}`, displayName: name, roomCode: code });
      await client.waitFor((m) => m.type === 'session');
      clients.push(client);
    }

    host.send({ type: 'host:teamName', teamId: 'TEAM_A', name: 'Rockets' });
    await host.waitForState((r) => r.teamNames.TEAM_A === 'Rockets');

    for (const client of clients) client.send({ type: 'player:ready', ready: true });
    await host.waitForState((r) => r.players.every((p) => p.ready));
    host.send({ type: 'game:start', actionId: 's1' });
    for (const client of clients) {
      await client.waitForState((r) => r.status === 'PLAYING' && r.game);
    }

    // Play part of a turn so the saved state is mid-game, not just dealt.
    const currentId = host.room.game.currentPlayerId;
    const active = clients.find((c) => c.room.youId === currentId);
    active.send({ type: 'game:action', actionId: 'd1', action: { type: 'DRAW_STOCK' } });
    await active.waitForState((r) => r.game?.turnPhase === 'PLAYING_CARDS');

    const before = {
      roomCode: host.room.roomCode,
      hostHand: host.room.game.you.hand.map((c) => c.id),
      currentPlayerId: host.room.game.currentPlayerId,
      turnPhase: host.room.game.turnPhase,
      stockCount: host.room.game.stockCount,
      wildRank: host.room.game.wildRank,
      discard: host.room.game.discardPile.map((c) => c.id),
      teamNames: host.room.teamNames,
      roundNumber: host.room.game.roundNumber,
    };

    for (const client of clients) client.close();

    // --- restart ---
    await stopServer();
    const files = await fs.readdir(path.join(dataDir, 'rooms'));
    assert.equal(files.filter((f) => f.endsWith('.json')).length, 1, 'the room should be on disk');
    await startServer();

    // --- after the restart ---
    const returning = await new Client('Rahul again').connect();
    returning.send({ type: 'session:resume', sessionToken: hostToken });
    const room = await returning.waitForState((r) => r.game != null);

    assert.equal(room.roomCode, before.roomCode);
    assert.equal(room.status, 'PLAYING');
    assert.deepEqual(room.game.you.hand.map((c) => c.id), before.hostHand);
    assert.equal(room.game.currentPlayerId, before.currentPlayerId);
    assert.equal(room.game.turnPhase, before.turnPhase);
    assert.equal(room.game.stockCount, before.stockCount);
    assert.equal(room.game.wildRank, before.wildRank);
    assert.deepEqual(room.game.discardPile.map((c) => c.id), before.discard);
    assert.equal(room.game.roundNumber, before.roundNumber);
    assert.deepEqual(room.teamNames, before.teamNames);

    // Everyone is shown as away until they come back.
    assert.equal(room.players.filter((p) => p.connected).length, 1);
    assert.equal(room.players.length, 4);

    // And play carries on from exactly where it stopped.
    const resumedCurrent = room.game.currentPlayerId;
    if (resumedCurrent === room.youId) {
      const hand = room.game.you.hand;
      returning.send({
        type: 'game:action',
        actionId: 'after-restart',
        action: { type: 'DISCARD', cardId: hand[0].id },
      });
      const after = await returning.waitForState((r) => r.game?.currentPlayerId !== resumedCurrent);
      assert.equal(after.game.discardPile.length, before.discard.length + 1);
    }

    returning.close();
  });

  it('refuses a session token that did not survive, rather than guessing', async () => {
    const stranger = await new Client('stranger').connect();
    stranger.send({ type: 'session:resume', sessionToken: 'f'.repeat(64) });
    const error = await stranger.waitFor((m) => m.type === 'error');
    assert.equal(error.error.code, 'SESSION_INVALID');
    stranger.close();
  });

  it('starts clean when the stored room file is corrupt', async () => {
    // A hard kill can leave a half-written file; that must not stop the boot.
    await stopServer();
    await fs.writeFile(path.join(dataDir, 'rooms', 'broken.json'), '{ this is not json');
    await startServer();

    const client = await new Client('after-corruption').connect();
    client.send({ type: 'room:create', actionId: 'c2', displayName: 'Jay', targetScore: 2000 });
    const session = await client.waitFor((m) => m.type === 'session');
    assert.ok(session.roomCode, 'the server should still be able to make rooms');
    client.close();
  });
});
