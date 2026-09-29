/**
 * Deploying ends every match, so the server should say so and we should be
 * able to tell beforehand.
 *
 * There is no persistent disk on this deployment. That is an accepted trade,
 * but it puts two obligations on us: warn the players at the moment it
 * happens, and make it possible to check before pressing merge.
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
const checkScript = path.resolve(here, '../../../scripts/deploy-check.mjs');

let child;
let dataDir;
let wsUrl;
let httpUrl;

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bukharo-deploy-'));
  child = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, SWEEP_INTERVAL_MS: '600000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 30000);
    child.stdout.on('data', (data) => {
      const match = /listening on http:\/\/[^:]+:(\d+)/.exec(data.toString());
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  wsUrl = `ws://127.0.0.1:${port}/ws`;
  httpUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
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

function runCheck(url) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [checkScript, url], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (out += d));
    proc.on('exit', (code) => resolve({ code, out }));
  });
}

async function seatFour() {
  const names = ['Rahul', 'Maya', 'Priya', 'Sam'];
  const host = await new Client(names[0]).connect();
  host.send({ type: 'room:create', actionId: 'c', displayName: names[0], targetScore: 2000 });
  assert.ok(await until(() => host.session));
  const code = host.session.roomCode;

  const clients = [host];
  for (const name of names.slice(1)) {
    const client = await new Client(name).connect();
    client.send({ type: 'room:join', actionId: `j${name}`, displayName: name, roomCode: code });
    assert.ok(await until(() => client.session));
    clients.push(client);
  }
  for (const client of clients) client.send({ type: 'player:ready', ready: true });
  assert.ok(await until(() => host.room?.players?.every((p) => p.ready)));
  host.send({ type: 'game:start', actionId: 's' });
  assert.ok(await until(() => host.room?.game));
  return clients;
}

describe('deploying while people are playing', () => {
  it('is waved through when the tables are empty', async () => {
    const result = await runCheck(httpUrl);
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /Safe to deploy/);
  });

  it('is refused once a game is in progress', async () => {
    const clients = await seatFour();

    const result = await runCheck(httpUrl);
    assert.equal(result.code, 1, `expected a refusal, got: ${result.out}`);
    assert.match(result.out, /1 game in progress/);
    assert.match(result.out, /4 players connected/);

    for (const client of clients) client.close();
  });

  it('does not block on a site it cannot reach', async () => {
    // A free instance that has spun down has nobody playing on it, and not
    // knowing is not the same as knowing a game is running.
    const result = await runCheck('http://127.0.0.1:9');
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /assuming nobody is playing/);
  });

  it('tells the table before the socket goes quiet', async () => {
    const clients = await seatFour();
    const watcher = clients[0];

    child.kill('SIGTERM');

    const told = await until(
      () => watcher.messages.some((m) => m.type === 'server:closing'),
      8000,
    );
    assert.ok(told, 'players should be told the server is going down');

    const notice = watcher.messages.find((m) => m.type === 'server:closing');
    assert.equal(notice.gameLost, true, 'a match in progress cannot survive this');

    for (const client of clients) client.close();
  });
});
