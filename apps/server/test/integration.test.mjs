/**
 * End-to-end test over real WebSockets against a real server process.
 *
 * Covers the multiplayer half of §81: private hands stay private on the wire,
 * duplicate actions are ignored, and a player can refresh and come back.
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
// The port is chosen by the OS (PORT=0) and read back from the server's own
// startup line, so parallel runs and busy CI machines cannot collide.
let wsUrl;
let child;
let dataDir;

/** A tiny promise-based client. */
class Client {
  constructor(name) {
    this.name = name;
    this.messages = [];
    this.room = null;
    this.session = null;
    this.events = [];
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
      if (message.type === 'game:event') this.events.push(message.event);
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

  waitFor(predicate, timeoutMs = 15000) {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
          reject(new Error(`${this.name}: timed out waiting for message`));
        }
      }, timeoutMs).unref();
    });
  }

  /** Waits for the next room:state that satisfies `check`. */
  waitForState(check, timeoutMs = 15000) {
    return this.waitFor((m) => m.type === 'room:state' && check(m.room), timeoutMs).then((m) => m.room);
  }

  close() {
    this.ws?.close();
  }
}

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bukharo-test-'));
  child = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, SWEEP_INTERVAL_MS: '600000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 30000);
    child.stdout.on('data', (data) => {
      const match = /listening on http:\/\/[^:]+:(\d+)/.exec(data.toString());
      if (match) {
        wsUrl = `ws://127.0.0.1:${match[1]}/ws`;
        clearTimeout(timer);
        resolve();
      }
    });
  });
});

after(async () => {
  // The server must be gone before its data directory is removed, or a
  // last-moment room write races the delete and leaves the directory behind.
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
});

/** Seats four players and returns them in seat order with the host first. */
async function seatFour() {
  const host = await new Client('host').connect();
  host.send({
    type: 'room:create',
    actionId: 'a1',
    displayName: 'Rahul',
    targetScore: 2000,
    gameId: 'bukharo',
  });
  await host.waitFor((m) => m.type === 'session');
  const code = host.session.roomCode;

  const others = [];
  for (const name of ['Maya', 'Priya', 'Sam']) {
    const client = await new Client(name).connect();
    client.send({ type: 'room:join', actionId: `join-${name}`, displayName: name, roomCode: code });
    await client.waitFor((m) => m.type === 'session');
    others.push(client);
  }
  const all = [host, ...others];
  await host.waitForState((room) => room.players.length === 4);
  return { host, others, all, code };
}

async function startMatch(all, host) {
  for (const client of all) client.send({ type: 'player:ready', ready: true });
  await host.waitForState((room) => room.players.every((p) => p.ready));
  host.send({ type: 'game:start', actionId: 'start-1' });
  await host.waitForState((room) => room.status === 'PLAYING' && room.game);
  for (const client of all) await client.waitForState((room) => room.status === 'PLAYING' && room.game);
}

describe('rooms over websockets', () => {
  it('creates a room with a readable code and seats four players', async () => {
    const { host, all, code } = await seatFour();
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
    assert.equal(code.includes('0'), false);
    assert.equal(code.includes('O'), false);

    const room = host.room;
    assert.equal(room.players.length, 4);
    assert.equal(room.players.filter((p) => p.teamId === 'TEAM_A').length, 2);
    assert.equal(room.players.filter((p) => p.teamId === 'TEAM_B').length, 2);
    assert.equal(room.players.find((p) => p.isHost).displayName, 'Rahul');
    for (const client of all) client.close();
  });

  it('lets only the host rename a team, and shows it to everyone', async () => {
    const { host, others, all } = await seatFour();
    assert.equal(host.room.teamNames.TEAM_A, 'Team A');

    host.send({ type: 'host:teamName', teamId: 'TEAM_A', name: 'The Sharks' });
    for (const client of all) {
      const room = await client.waitForState((r) => r.teamNames.TEAM_A === 'The Sharks');
      assert.equal(room.teamNames.TEAM_B, 'Team B');
    }

    others[0].send({ type: 'host:teamName', teamId: 'TEAM_B', name: 'Sneaky' });
    const error = await others[0].waitFor((m) => m.type === 'error');
    assert.equal(error.error.code, 'NOT_HOST');
    assert.equal(host.room.teamNames.TEAM_B, 'Team B');

    // An empty name falls back rather than leaving a nameless team.
    host.send({ type: 'host:teamName', teamId: 'TEAM_A', name: '   ' });
    await host.waitForState((r) => r.teamNames.TEAM_A === 'Team A');

    for (const client of all) client.close();
  });

  it('carries team names into the game log', async () => {
    const { host, all } = await seatFour();
    host.send({ type: 'host:teamName', teamId: 'TEAM_A', name: 'Rockets' });
    await host.waitForState((r) => r.teamNames.TEAM_A === 'Rockets');
    await startMatch(all, host);
    assert.equal(host.room.game.teams.TEAM_A.name, 'Rockets');
    for (const client of all) client.close();
  });

  it('turns away a fifth player, naming the game that is full', async () => {
    const { host, all, code } = await seatFour();

    const late = await new Client('Nina').connect();
    late.send({ type: 'room:join', actionId: 'late', displayName: 'Nina', roomCode: code });
    const error = await late.waitFor((m) => m.type === 'error');

    assert.equal(error.error.code, 'ROOM_FULL');
    assert.match(error.error.message, /Bukharo seats 4/);
    assert.equal(host.room.players.length, 4);

    late.close();
    for (const client of all) client.close();
  });

  it('seats players in order and alternates the teams', async () => {
    const { host, all } = await seatFour();
    const seated = [...host.room.players].sort((a, b) => a.position - b.position);

    assert.deepEqual(seated.map((p) => p.position), [0, 1, 2, 3]);
    assert.deepEqual(seated.map((p) => p.teamId), ['TEAM_A', 'TEAM_B', 'TEAM_A', 'TEAM_B']);
    assert.deepEqual(seated.map((p) => p.seatLabel), ['North', 'East', 'South', 'West']);

    for (const client of all) client.close();
  });

  it('tells the host exactly what a short table needs', async () => {
    const host = await new Client('Rahul').connect();
    host.send({
      type: 'room:create',
      actionId: 'short',
      displayName: 'Rahul',
      targetScore: 2000,
      gameId: 'bukharo',
    });
    const room = await host.waitForState((r) => r.players.length === 1);

    assert.equal(room.gameId, 'bukharo');
    assert.match(room.cannotStartReason, /needs 4 players\. You have 1 — 3 more to go/);

    host.send({ type: 'game:start', actionId: 'nope' });
    const error = await host.waitFor((m) => m.type === 'error');
    assert.equal(error.error.code, 'NOT_READY');
    host.close();
  });

  it('refuses to start until everyone is ready', async () => {
    const { host, all } = await seatFour();
    host.send({ type: 'game:start', actionId: 'early-start' });
    const error = await host.waitFor((m) => m.type === 'error');
    assert.equal(error.error.code, 'NOT_READY');
    assert.match(error.error.message, /waiting for/i);
    for (const client of all) client.close();
  });

  it('deals private hands that never appear in another player’s payload', async () => {
    const { host, all } = await seatFour();
    await startMatch(all, host);

    const hands = new Map();
    for (const client of all) {
      const me = client.room.game.you;
      assert.equal(me.hand.length, 13);
      hands.set(client.room.youId, me.hand.map((c) => c.id));
    }

    // Nothing a client received may name another player's card.
    for (const client of all) {
      const raw = JSON.stringify(client.messages);
      for (const [playerId, cardIds] of hands) {
        if (playerId === client.room.youId) continue;
        const own = new Set(hands.get(client.room.youId));
        for (const cardId of cardIds) {
          if (own.has(cardId)) continue; // impossible, ids are unique
          assert.equal(raw.includes(`"${cardId}"`), false, `${client.name} saw ${cardId}`);
        }
      }
      // Opponents are described by count only.
      for (const opponent of client.room.game.players) {
        assert.equal('hand' in opponent, false);
        assert.equal(opponent.handCount, 13);
      }
    }
    for (const client of all) client.close();
  });

  it('ignores a duplicated action id (§59)', async () => {
    const { host, all } = await seatFour();
    await startMatch(all, host);

    const currentId = host.room.game.currentPlayerId;
    const active = all.find((c) => c.room.youId === currentId);
    const stockBefore = active.room.game.stockCount;

    active.send({ type: 'game:action', actionId: 'dup-1', action: { type: 'DRAW_STOCK' } });
    await active.waitForState((room) => room.game?.you?.hand.length === 14);
    active.send({ type: 'game:action', actionId: 'dup-1', action: { type: 'DRAW_STOCK' } });
    // Messages on one connection are processed in order, so a pong proves the
    // server has finished with the duplicate. Waiting a fixed number of
    // milliseconds would only prove the test was patient enough.
    active.send({ type: 'ping' });
    await active.waitFor((m) => m.type === 'pong');

    assert.equal(active.room.game.you.hand.length, 14);
    assert.equal(active.room.game.stockCount, stockBefore - 1);
    for (const client of all) client.close();
  });

  it('rejects a move from the player who is not on turn', async () => {
    const { host, all } = await seatFour();
    await startMatch(all, host);
    const currentId = host.room.game.currentPlayerId;
    const idle = all.find((c) => c.room.youId !== currentId);
    idle.send({ type: 'game:action', actionId: 'bad-1', action: { type: 'DRAW_STOCK' } });
    const error = await idle.waitFor((m) => m.type === 'error');
    assert.equal(error.error.code, 'NOT_YOUR_TURN');
    for (const client of all) client.close();
  });

  it('restores the seat and hand after a refresh (§52)', async () => {
    const { host, all } = await seatFour();
    await startMatch(all, host);

    const victim = all[1];
    const token = victim.session.sessionToken;
    const handBefore = victim.room.game.you.hand.map((c) => c.id);
    const playerId = victim.room.youId;
    victim.close();

    await host.waitForState((room) => room.players.some((p) => p.id === playerId && !p.connected));

    const returning = await new Client('returning').connect();
    returning.send({ type: 'session:resume', sessionToken: token });
    const room = await returning.waitForState((r) => r.game != null);

    assert.equal(room.youId, playerId);
    assert.deepEqual(room.game.you.hand.map((c) => c.id), handBefore);
    await host.waitForState((r) => r.players.some((p) => p.id === playerId && p.connected));

    returning.close();
    for (const client of all) client.close();
  });

  it('refuses a stolen player id and an unknown token (§53)', async () => {
    const { host, all } = await seatFour();
    const targetId = host.room.players[1].id;

    const attacker = await new Client('attacker').connect();
    attacker.send({ type: 'session:resume', sessionToken: targetId });
    const error = await attacker.waitFor((m) => m.type === 'error');
    assert.equal(error.error.code, 'SESSION_INVALID');
    assert.equal(attacker.room, null);

    attacker.close();
    for (const client of all) client.close();
  });

  it('hands the host role to another player when the host drops (§55)', async () => {
    const { host, others, all } = await seatFour();
    const hostId = host.room.youId;
    host.close();
    const room = await others[0].waitForState((r) => r.players.find((p) => p.id === hostId)?.connected === false);
    const newHost = room.players.find((p) => p.isHost);
    assert.notEqual(newHost.id, hostId);
    assert.equal(newHost.connected, true);
    for (const client of all) client.close();
  });

  it('plays a full turn and passes the turn on', async () => {
    const { host, all } = await seatFour();
    await startMatch(all, host);

    const currentId = host.room.game.currentPlayerId;
    const active = all.find((c) => c.room.youId === currentId);
    active.send({ type: 'game:action', actionId: 'turn-draw', action: { type: 'DRAW_STOCK' } });
    await active.waitForState((room) => room.game?.turnPhase === 'PLAYING_CARDS');

    // The drawn card arrives privately, and only for the drawer.
    await active.waitFor((m) => m.type === 'game:event' && m.event.type === 'CARD_DRAWN');
    const drew = active.events.find((e) => e.type === 'CARD_DRAWN');
    assert.ok(drew.payload.card.id, 'drawer should be told which card they drew');

    const spectator = all.find((c) => c.room.youId !== currentId);
    await spectator.waitFor((m) => m.type === 'game:event' && m.event.type === 'PLAYER_DREW_CARD');
    assert.equal(spectator.events.some((e) => e.type === 'CARD_DRAWN'), false);
    const publicDraw = spectator.events.find((e) => e.type === 'PLAYER_DREW_CARD');
    assert.equal('card' in publicDraw.payload, false, 'the table must not learn the card');

    const discardId = active.room.game.you.hand[0].id;
    active.send({ type: 'game:action', actionId: 'turn-discard', action: { type: 'DISCARD', cardId: discardId } });
    const after = await active.waitForState((room) => room.game?.currentPlayerId != null && room.game.currentPlayerId !== currentId);
    assert.equal(after.game.turnPhase, 'AWAITING_DRAW');
    assert.equal(after.game.discardPile.at(-1).id, discardId);
    for (const client of all) client.close();
  });

  it('reports an illegal meld with a reason the player can act on (§75)', async () => {
    const { host, all } = await seatFour();
    await startMatch(all, host);

    const currentId = host.room.game.currentPlayerId;
    const active = all.find((c) => c.room.youId === currentId);
    active.send({ type: 'game:action', actionId: 'meld-draw', action: { type: 'DRAW_STOCK' } });
    await active.waitForState((room) => room.game?.turnPhase === 'PLAYING_CARDS');

    const cardIds = active.room.game.you.hand.slice(0, 3).map((c) => c.id);
    active.send({ type: 'game:action', actionId: 'meld-bad', action: { type: 'CREATE_MELD', cardIds } });
    const error = await active.waitFor((m) => m.type === 'error' && m.error.actionId === 'meld-bad');
    assert.ok(error.error.message.length > 20, 'error should explain itself');
    assert.notEqual(error.error.message, 'Invalid move');
    for (const client of all) client.close();
  });
});
