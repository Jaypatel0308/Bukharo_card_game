/**
 * Judgement over real sockets: a whole match, the redaction boundary, and the
 * platform promise that a game without teams is seated without them.
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
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bukharo-judgement-'));
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
    return this.waitFor((m) => m.type === 'room:state' && check(m.room), timeoutMs).then((m) => m.room);
  }
  close() {
    this.ws?.close();
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function settle(clients) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const versions = clients.map((c) => c.room?.game?.view.stateVersion ?? -1);
    if (versions.every((v) => v >= 0 && v === versions[0])) return versions[0];
    await wait(5);
  }
  throw new Error('the table never agreed on a state');
}

async function seat(count, rounds) {
  const names = ['Rahul', 'Maya', 'Priya', 'Sam', 'Nina', 'Omar', 'Zara', 'Kabir', 'Ravi', 'Isha'];
  const host = await new Client(names[0]).connect();
  host.send({
    type: 'room:create',
    actionId: `c${Math.random()}`,
    displayName: names[0],
    gameId: 'judgement',
    target: rounds,
  });
  await host.waitFor((m) => m.type === 'session');
  const code = host.session.roomCode;

  const clients = [host];
  for (const name of names.slice(1, count)) {
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
  return clients;
}

/** Sends an action and waits for the state it produced to arrive. */
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

describe('Judgement is seated without teams', () => {
  it('gives nobody a team, and refuses to name one', async () => {
    const clients = await seat(3, 4);
    const room = clients[0].room;

    assert.equal(room.gameId, 'judgement');
    assert.equal(room.hasTeams, false, 'Judgement is every player for themselves');
    for (const player of room.players) {
      assert.equal(player.teamId, null, `${player.displayName} should not be in a team`);
    }

    // Three players — a count no partnership game could seat.
    assert.equal(room.players.length, 3);

    clients[0].send({ type: 'host:teamName', teamId: 'TEAM_A', name: 'Rockets' });
    const error = await clients[0].waitFor((m) => m.type === 'error', 5000);
    assert.match(error.error.message, /not played in teams/i);

    for (const client of clients) client.close();
  });
});

describe('a whole match of Judgement over the wire', () => {
  it('bids, plays, scores and finishes on the agreed round', async () => {
    const ROUNDS = 4;
    const clients = await seat(4, ROUNDS);

    let guard = 0;
    while (clients[0].room.game.view.status !== 'MATCH_END' && guard++ < 400) {
      await settle(clients);
      const view = clients[0].room.game.view;

      if (view.status === 'ROUND_END') {
        clients[0].send({ type: 'round:next', actionId: `n${guard}` });
        await clients[0].waitForState(
          (r) => r.game != null && r.game.view.roundNumber > view.roundNumber,
        );
        continue;
      }
      if (view.status === 'MATCH_END') break;

      const player = clients.find((c) => c.room.youId === view.currentPlayerId);
      const own = player.room.game.view;

      if (own.status === 'BIDDING') {
        const legal = own.yourLegalBids;
        assert.ok(legal.length > 0, 'a player on turn must have something to judge');
        await act(player, { type: 'PLACE_BID', bid: legal[legal.length - 1] });
      } else {
        const legal = own.yourLegalCardIds;
        assert.ok(legal.length > 0, 'a player on turn must have something to play');
        await act(player, { type: 'PLAY_CARD', cardId: legal[0] });
      }

      // Nobody ever holds more than was dealt this round.
      for (const client of clients) {
        const v = client.room.game?.view;
        if (v?.you) assert.ok(v.you.hand.length <= v.cardsEach, 'a hand grew');
      }
    }

    assert.ok(guard < 400, 'the match should finish inside the budget');
    await settle(clients);

    const final = clients[0].room.game.view;
    assert.equal(final.status, 'MATCH_END');
    assert.equal(final.roundNumber, ROUNDS, 'it stops on the agreed round');
    assert.equal(final.roundHistory.length, ROUNDS, 'every round was recorded');
    assert.ok(final.winnerPlayerIds.length >= 1, 'somebody won');

    // The winner really does have the highest score.
    const best = Math.max(...final.players.map((p) => p.score));
    for (const id of final.winnerPlayerIds) {
      assert.equal(final.players.find((p) => p.id === id).score, best);
    }

    // Each round's tricks add up, and no round let the bids equal the count.
    for (const round of final.roundHistory) {
      const tricks = round.lines.reduce((sum, l) => sum + l.tricksWon, 0);
      assert.equal(tricks, round.cardsEach, `round ${round.roundNumber} lost a trick`);
      const bids = round.lines.reduce((sum, l) => sum + l.bid, 0);
      assert.notEqual(bids, round.cardsEach, `round ${round.roundNumber} let the bids add up`);
    }

    for (const client of clients) client.close();
  });

  it('never shows one player another player’s cards', async () => {
    const clients = await seat(4, 2);
    await settle(clients);

    for (const viewer of clients) {
      const view = viewer.room.game.view;
      const mine = new Set((view.you?.hand ?? []).map((c) => c.id));
      const asText = JSON.stringify(view.players);
      // Nobody else's hand is in the payload at all.
      for (const other of view.players) {
        assert.equal('hand' in other, false, `${other.displayName}'s cards were sent`);
      }
      assert.ok(mine.size > 0, 'you can see your own hand');
      assert.equal(asText.includes('"rank"'), false, 'no card should ride along in the seat list');
    }

    for (const client of clients) client.close();
  });

  it('refuses a bid that would make the judgements add up', async () => {
    const clients = await seat(4, 2);
    await settle(clients);

    // Round one is a single trick. Three zeros, then the last may not judge 1.
    for (let i = 0; i < 3; i++) {
      const view = clients[0].room.game.view;
      const player = clients.find((c) => c.room.youId === view.currentPlayerId);
      await act(player, { type: 'PLACE_BID', bid: 0 });
      await settle(clients);
    }

    const view = clients[0].room.game.view;
    const last = clients.find((c) => c.room.youId === view.currentPlayerId);
    assert.deepEqual(last.room.game.view.yourLegalBids, [0], 'only nothing is left');

    const outcome = await act(last, { type: 'PLACE_BID', bid: 1 });
    assert.equal(outcome, 'error:BID_COMPLETES_COUNT');

    for (const client of clients) client.close();
  });

  it('refuses an action belonging to another game', async () => {
    const clients = await seat(3, 2);
    const outcome = await act(clients[0], { type: 'DRAW_STOCK' });
    assert.match(outcome, /^error:/, 'a Bukharo action must not work here');
    for (const client of clients) client.close();
  });
});
