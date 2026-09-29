/**
 * A fault in one room must not end everybody's game.
 *
 * This deployment has no persistent disk, so a process that dies takes every
 * match with it and cannot restore them. A failing write in the background
 * sweeps used to reject into nothing, and Node ends the process on an
 * unhandled rejection — one full disk would have cleared every table on the
 * server.
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

/** Rooms are written here, so this is the directory to make unwritable. */
const roomsDirOf = (dir) => path.join(dir, 'rooms');
const serverEntry = path.resolve(here, '../dist/index.js');

let child;
let dataDir;
let wsUrl;
let exited = null;

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bukharo-fault-'));
  child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      PORT: '0',
      DATA_DIR: dataDir,
      SWEEP_INTERVAL_MS: '300',
      DISCONNECT_GRACE_MS: '500',
      ABSENT_CHECK_INTERVAL_MS: '120',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.on('exit', (code, signal) => {
    exited = { code, signal };
  });
  child.stderr.on('data', () => {
    /* errors are expected here; the point is that they are survived */
  });
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
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (dataDir) {
    await fs.chmod(roomsDirOf(dataDir), 0o700).catch(() => undefined);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

class Client {
  constructor(name) {
    this.name = name;
    this.room = null;
    this.session = null;
    this.messages = [];
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
    });
    return this;
  }
  send(message) {
    this.ws.send(JSON.stringify(message));
  }
  close() {
    this.ws?.close();
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(20);
  }
  return false;
}

async function seatFour(prefix) {
  const names = ['Rahul', 'Maya', 'Priya', 'Sam'].map((n) => `${n}${prefix}`);
  const host = await new Client(names[0]).connect();
  host.send({ type: 'room:create', actionId: `c${prefix}`, displayName: names[0], targetScore: 2000 });
  assert.ok(await until(() => host.session), 'the room should be created');
  const code = host.session.roomCode;

  const clients = [host];
  for (const name of names.slice(1)) {
    const client = await new Client(name).connect();
    client.send({ type: 'room:join', actionId: `j${name}`, displayName: name, roomCode: code });
    assert.ok(await until(() => client.session), `${name} should join`);
    clients.push(client);
  }
  for (const client of clients) client.send({ type: 'player:ready', ready: true });
  assert.ok(await until(() => host.room?.players?.every((p) => p.ready)));
  host.send({ type: 'game:start', actionId: `s${prefix}` });
  assert.ok(await until(() => host.room?.game), 'the game should start');
  return clients;
}

describe('a server that cannot write to its disk', () => {
  it('keeps every table playing instead of dying', async () => {
    // Two tables, so we can watch one carry on while the other is disrupted.
    const tableA = await seatFour('A');
    const tableB = await seatFour('B');
    assert.equal(exited, null, 'the server should be up before we break anything');

    // The disk goes read-only underneath a running game.
    await fs.chmod(roomsDirOf(dataDir), 0o500);

    // Make the player on turn vanish, so the background backstop fires and
    // tries to save. That save now fails.
    const onTurn = tableA[0].room.game.view.currentPlayerId;
    const absent = tableA.find((c) => c.room.youId === onTurn);
    absent.close();

    // Give the backstop and the sweeper several goes at failing.
    await wait(3000);

    assert.equal(exited, null, 'a failed write must not end the process');

    // And the untouched table is still served.
    await fs.chmod(roomsDirOf(dataDir), 0o700);
    const stillThere = tableB[0];
    const before = stillThere.messages.length;
    stillThere.send({ type: 'ping' });
    assert.ok(
      await until(() => stillThere.messages.length > before, 5000),
      'the other table should still be answered',
    );

    for (const client of [...tableA, ...tableB]) client.close();
  });

  it('still answers /health while the disk is unwritable', async () => {
    const port = new URL(wsUrl.replace('ws://', 'http://')).port;
    await fs.chmod(roomsDirOf(dataDir), 0o500);
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await response.json();
    await fs.chmod(roomsDirOf(dataDir), 0o700);

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
  });
});
