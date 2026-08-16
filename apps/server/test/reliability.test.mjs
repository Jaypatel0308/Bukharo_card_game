/**
 * Regression tests for the reliability audit.
 *
 * Each of these reproduces a fault that was found in the running server, so
 * they are written as the scenario that produced it rather than as a unit test
 * of the fix.
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
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bukharo-reliability-'));
  child = spawn(process.execPath, [serverEntry], {
    // A short grace period so the skip path is testable without waiting.
    env: {
      ...process.env,
      PORT: '0',
      DATA_DIR: dataDir,
      SWEEP_INTERVAL_MS: '600000',
      DISCONNECT_GRACE_MS: '150',
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

async function seatFour() {
  const host = await new Client('Rahul').connect();
  host.send({ type: 'room:create', actionId: `c${Math.random()}`, displayName: 'Rahul', targetScore: 2000 });
  await host.waitFor((m) => m.type === 'session');
  const code = host.session.roomCode;

  const others = [];
  for (const name of ['Maya', 'Priya', 'Sam']) {
    const client = await new Client(name).connect();
    client.send({ type: 'room:join', actionId: `j${name}${Math.random()}`, displayName: name, roomCode: code });
    await client.waitFor((m) => m.type === 'session');
    others.push(client);
  }
  const all = [host, ...others];
  await host.waitForState((r) => r.players.length === 4);
  return { host, others, all, code };
}

async function startMatch(all, host) {
  for (const client of all) client.send({ type: 'player:ready', ready: true });
  await host.waitForState((r) => r.players.every((p) => p.ready));
  host.send({ type: 'game:start', actionId: `s${Math.random()}` });
  for (const client of all) await client.waitForState((r) => r.status === 'PLAYING' && r.game);
  // waitForState can match a historical message, so confirm the live view too.
  for (const client of all) {
    if (!client.room?.game) await client.waitFor((m) => m.type === 'room:state' && m.room.game);
  }
}

describe('the room always has a host somebody can reach', () => {
  it('hands the role to whoever comes back, even if the host left last', async () => {
    const { host, others, all } = await seatFour();
    await startMatch(all, host);
    const hostId = host.room.youId;
    const mayaToken = others[0].session.sessionToken;

    // The others drop first, then the host: nobody is left to inherit.
    for (const client of others) client.close();
    await wait(150);
    host.close();
    await wait(200);

    const back = await new Client('Maya again').connect();
    back.send({ type: 'session:resume', sessionToken: mayaToken });
    const room = await back.waitForState((r) => r.game != null);

    const currentHost = room.players.find((p) => p.isHost);
    assert.ok(currentHost, 'somebody must hold the host role');
    assert.equal(currentHost.connected, true, 'the host must be someone actually present');
    assert.notEqual(currentHost.id, hostId, 'the departed host should not still hold it');
    assert.equal(room.hostId, currentHost.id);

    back.close();
    for (const client of all) client.close();
  });

  it('gives the role back to nobody while the room is empty', async () => {
    const { host, all } = await seatFour();
    const hostId = host.room.youId;
    host.close();
    await wait(150);
    // The remaining players are still connected, so one of them has it.
    const room = await all[1].waitForState((r) => r.players.find((p) => p.id === hostId)?.connected === false);
    assert.equal(room.players.filter((p) => p.isHost).length, 1);
    assert.equal(room.players.find((p) => p.isHost).connected, true);
    for (const client of all) client.close();
  });
});

describe('input from a client is never trusted', () => {
  it('refuses a seat that is not at the table', async () => {
    const host = await new Client('Rahul').connect();
    host.send({ type: 'room:create', actionId: 'v1', displayName: 'Rahul', targetScore: 2000 });
    await host.waitForState((r) => r.players.length === 1);
    const before = host.room.players[0].seat;

    host.send({ type: 'seat:choose', seat: 'MIDDLE_OF_THE_TABLE' });
    const error = await host.waitFor((m) => m.type === 'error');

    assert.equal(error.error.code, 'INVALID_MESSAGE');
    assert.equal(host.room.players[0].seat, before, 'the seat must not have moved');
    assert.ok(host.room.players[0].teamId, 'the player must still belong to a team');
    host.close();
  });

  it('refuses a team that does not exist', async () => {
    const host = await new Client('Rahul').connect();
    host.send({ type: 'room:create', actionId: 'v2', displayName: 'Rahul', targetScore: 2000 });
    await host.waitForState((r) => r.players.length === 1);

    host.send({ type: 'host:teamName', teamId: 'TEAM_Z', name: 'Ghosts' });
    const error = await host.waitFor((m) => m.type === 'error');
    assert.equal(error.error.code, 'INVALID_MESSAGE');
    assert.deepEqual(Object.keys(host.room.teamNames).sort(), ['TEAM_A', 'TEAM_B']);
    host.close();
  });

  it('shrugs off malformed wild assignments instead of erroring internally', async () => {
    const { host, all } = await seatFour();
    await startMatch(all, host);
    const currentId = host.room.game.currentPlayerId;
    const active = all.find((c) => c.room.youId === currentId);

    active.send({ type: 'game:action', actionId: 'w1', action: { type: 'DRAW_STOCK' } });
    await active.waitForState((r) => r.game?.turnPhase === 'PLAYING_CARDS');

    const cardIds = active.room.game.you.hand.slice(0, 3).map((c) => c.id);
    active.send({
      type: 'game:action',
      actionId: 'w2',
      action: { type: 'CREATE_MELD', cardIds, wildAssignments: 'not-an-array' },
    });
    const error = await active.waitFor((m) => m.type === 'error' && m.error.actionId === 'w2');
    assert.notEqual(error.error.code, 'INTERNAL', 'a bad field must not become a server error');

    for (const client of all) client.close();
  });
});

describe('a turn nobody is playing', () => {
  it('lets the host pass an absent player once the grace period has run', async () => {
    const { host, all } = await seatFour();
    await startMatch(all, host);

    const currentId = host.room.game.currentPlayerId;
    const absent = all.find((c) => c.room.youId === currentId);
    const present = all.filter((c) => c !== absent);

    absent.close();
    await present[0].waitForState((r) => r.waitingForPlayerId === currentId);
    await wait(250); // let the short grace period elapse

    const holder = present.find((c) => c.room.players.find((p) => p.id === c.room.youId)?.isHost);
    assert.ok(holder, 'a connected player should hold the host role');

    holder.send({ type: 'host:skipTurn' });
    const after = await holder.waitFor(
      (m) => m.type === 'room:state' && m.room.game && m.room.game.currentPlayerId !== currentId,
    ).then((m) => m.room);

    assert.notEqual(after.game.currentPlayerId, currentId);
    assert.equal(after.game.turnPhase, 'AWAITING_DRAW');
    assert.equal(after.waitingForPlayerId, null);

    for (const client of all) client.close();
  });

  it('refuses to skip a player who is present', async () => {
    const { host, all } = await seatFour();
    await startMatch(all, host);
    host.send({ type: 'host:skipTurn' });
    const error = await host.waitFor((m) => m.type === 'error');
    assert.equal(error.error.code, 'WRONG_PHASE');
    assert.match(error.error.message, /still connected/);
    for (const client of all) client.close();
  });

  it('lets the host end a match that cannot continue', async () => {
    const { host, all } = await seatFour();
    await startMatch(all, host);

    host.send({ type: 'host:endMatch' });
    const after = await host.waitForState((r) => r.status === 'ABANDONED');
    assert.equal(after.status, 'ABANDONED');

    // And the room is still usable afterwards.
    host.send({ type: 'match:restart', actionId: 'again' });
    const restarted = await host.waitForState((r) => r.status === 'PLAYING');
    assert.equal(restarted.game.roundNumber, 1);

    for (const client of all) client.close();
  });

  it('refuses to let a non-host end the match', async () => {
    const { host, others, all } = await seatFour();
    await startMatch(all, host);
    others[0].send({ type: 'host:endMatch' });
    const error = await others[0].waitFor((m) => m.type === 'error');
    assert.equal(error.error.code, 'NOT_HOST');
    assert.equal(host.room.status, 'PLAYING');
    for (const client of all) client.close();
  });
});

describe('a socket only ever occupies one room', () => {
  it('leaves no connected ghost behind in the room it left', async () => {
    const first = await new Client('Rahul').connect();
    first.send({ type: 'room:create', actionId: 'g1', displayName: 'Rahul', targetScore: 2000 });
    await first.waitFor((m) => m.type === 'session');
    const firstCode = first.session.roomCode;

    const second = await new Client('Maya').connect();
    second.send({ type: 'room:create', actionId: 'g2', displayName: 'Maya', targetScore: 2000 });
    await second.waitFor((m) => m.type === 'session');

    // The same socket now joins Maya's room, abandoning its own.
    first.send({ type: 'room:join', actionId: 'g3', displayName: 'Rahul', roomCode: second.session.roomCode });
    await first.waitForState((r) => r.roomCode === second.session.roomCode);
    await wait(200);

    // A fresh player joining the abandoned room must find it empty of people.
    const observer = await new Client('observer').connect();
    observer.send({ type: 'room:join', actionId: 'g4', displayName: 'Nina', roomCode: firstCode });
    const abandoned = await observer.waitForState((r) => r.roomCode === firstCode);
    const ghosts = abandoned.players.filter((p) => p.displayName === 'Rahul' && p.connected);
    assert.equal(ghosts.length, 0, 'the socket that left must not still look connected');

    first.close();
    second.close();
    observer.close();
  });
});
