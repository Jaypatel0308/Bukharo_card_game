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
    const currentId = host.room.game.view.currentPlayerId;
    const active = clients.find((c) => c.room.youId === currentId);
    active.send({ type: 'game:action', actionId: 'd1', action: { type: 'DRAW_STOCK' } });
    await active.waitForState((r) => r.game?.view.turnPhase === 'PLAYING_CARDS');
    // The baseline is read from the host's socket, so wait for that one too.
    // Reading one client's state after waiting on another's compares the
    // restored server against a moment that never existed for anybody.
    await host.waitForState((r) => r.game?.view.turnPhase === 'PLAYING_CARDS');

    const before = {
      roomCode: host.room.roomCode,
      hostHand: host.room.game.view.you.hand.map((c) => c.id),
      currentPlayerId: host.room.game.view.currentPlayerId,
      turnPhase: host.room.game.view.turnPhase,
      stockCount: host.room.game.view.stockCount,
      wildRank: host.room.game.view.wildRank,
      discard: host.room.game.view.discardPile.map((c) => c.id),
      teamNames: host.room.teamNames,
      roundNumber: host.room.game.view.roundNumber,
    };

    for (const client of clients) client.close();

    // --- restart ---
    await stopServer();
    const files = (await fs.readdir(path.join(dataDir, 'rooms'))).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1, 'the room should be on disk');

    // Check the file itself before trusting what comes back from it: if this
    // fails, the fault is in writing rather than in reading.
    const stored = JSON.parse(await fs.readFile(path.join(dataDir, 'rooms', files[0]), 'utf8'));
    assert.equal(
      stored.game.turnPhase,
      before.turnPhase,
      'the drawn card should have reached the disk before the server stopped',
    );

    await startServer();

    // --- after the restart ---
    const returning = await new Client('Rahul again').connect();
    returning.send({ type: 'session:resume', sessionToken: hostToken });
    const room = await returning.waitForState((r) => r.game != null);

    assert.equal(room.roomCode, before.roomCode);
    assert.equal(room.status, 'PLAYING');
    assert.deepEqual(room.game.view.you.hand.map((c) => c.id), before.hostHand);
    assert.equal(room.game.view.currentPlayerId, before.currentPlayerId);
    assert.equal(room.game.view.turnPhase, before.turnPhase);
    assert.equal(room.game.view.stockCount, before.stockCount);
    assert.equal(room.game.view.wildRank, before.wildRank);
    assert.deepEqual(room.game.view.discardPile.map((c) => c.id), before.discard);
    assert.equal(room.game.view.roundNumber, before.roundNumber);
    assert.deepEqual(room.teamNames, before.teamNames);

    // Everyone is shown as away until they come back.
    assert.equal(room.players.filter((p) => p.connected).length, 1);
    assert.equal(room.players.length, 4);

    // And play carries on from exactly where it stopped.
    const resumedCurrent = room.game.view.currentPlayerId;
    if (resumedCurrent === room.youId) {
      const hand = room.game.view.you.hand;
      returning.send({
        type: 'game:action',
        actionId: 'after-restart',
        action: { type: 'DISCARD', cardId: hand[0].id },
      });
      const after = await returning.waitForState((r) => r.game?.view.currentPlayerId !== resumedCurrent);
      assert.equal(after.game.view.discardPile.length, before.discard.length + 1);
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

/**
 * The stored Mindi room, or null if it is not on disk yet.
 *
 * Writes are debounced, so a room read straight after a move can still be the
 * room from before it. Tests that stop the server have to wait for the write
 * rather than assume it, or they compare a restored state against a moment
 * that was never saved.
 */
async function readStoredMindiRoom() {
  let files;
  try {
    files = (await fs.readdir(path.join(dataDir, 'rooms'))).filter((f) => f.endsWith('.json'));
  } catch {
    return null;
  }
  for (const file of files) {
    try {
      const json = JSON.parse(await fs.readFile(path.join(dataDir, 'rooms', file), 'utf8'));
      if (json.gameId === 'mindi') return json;
    } catch {
      // An earlier test leaves a deliberately corrupt file here.
    }
  }
  return null;
}

async function waitForStoredMindiRoom(check, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await readStoredMindiRoom();
    if (last && check(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `the room never reached disk in the state expected; last saw ${JSON.stringify(last?.game?.currentTrick ?? null)}`,
  );
}

describe('a Mindi hand surviving a restart (§61)', () => {
  it('brings back the hand, the tally and the face-down card — still face down', async () => {
    const names = ['Rahul', 'Maya', 'Priya', 'Sam'];
    const host = await new Client(names[0]).connect();
    host.send({ type: 'room:create', actionId: 'mc', displayName: names[0], target: 3, gameId: 'mindi' });
    await host.waitFor((m) => m.type === 'session');
    const code = host.session.roomCode;
    const tokens = { [names[0]]: host.session.sessionToken };

    const clients = [host];
    for (const name of names.slice(1)) {
      const client = await new Client(name).connect();
      client.send({ type: 'room:join', actionId: `mj-${name}`, displayName: name, roomCode: code });
      await client.waitFor((m) => m.type === 'session');
      tokens[name] = client.session.sessionToken;
      clients.push(client);
    }

    for (const client of clients) client.send({ type: 'player:ready', ready: true });
    await host.waitForState((r) => r.players.every((p) => p.ready));
    host.send({ type: 'game:start', actionId: 'ms' });
    for (const client of clients) await client.waitForState((r) => r.game != null);

    // Hide a card, so there is a secret to keep across the restart.
    const chooserId = host.room.game.view.chooserId;
    const chooser = clients.find((c) => c.room.youId === chooserId);
    chooser.send({ type: 'game:action', actionId: 'mode', action: { type: 'CHOOSE_MODE', mode: 'HIDDEN' } });
    for (const client of clients) {
      await client.waitForState((r) => r.game?.view.status === 'PLAYING');
    }

    // Lead one card, so the saved hand is mid-trick rather than freshly dealt.
    const leaderId = host.room.game.view.currentPlayerId;
    const leader = clients.find((c) => c.room.youId === leaderId);
    const led = leader.room.game.view.you.hand[0].id;
    leader.send({ type: 'game:action', actionId: 'lead', action: { type: 'PLAY_CARD', cardId: led } });
    for (const client of clients) {
      await client.waitForState((r) => r.game?.view.currentTrick.plays.length === 1);
    }

    // The lead has to be on disk before the baseline is taken: a restart can
    // only restore what was saved, and comparing against an unsaved moment is
    // what made this fail on a slower machine.
    await waitForStoredMindiRoom((room) => room.game?.currentTrick?.plays?.length === 1);

    const chooserName = chooser.room.players.find((p) => p.id === chooserId).displayName;
    const other = clients.find((c) => c.room.youId !== chooserId);
    const otherName = other.room.players.find((p) => p.id === other.room.youId).displayName;

    const before = {
      hiddenCard: chooser.room.game.view.yourHiddenCard,
      chooserHand: chooser.room.game.view.you.hand.map((c) => c.id),
      otherHand: other.room.game.view.you.hand.map((c) => c.id),
      currentPlayerId: chooser.room.game.view.currentPlayerId,
      trick: chooser.room.game.view.currentTrick.plays.map((p) => p.card.id),
      handNumber: chooser.room.game.view.handNumber,
      kotTarget: chooser.room.game.view.kotTarget,
    };
    assert.ok(before.hiddenCard, 'the chooser should be able to see their own hidden card');

    for (const client of clients) client.close();
    await stopServer();

    // The secret must be on disk — a hidden card that is not saved is a hand
    // that cannot be finished.
    const stored = await readStoredMindiRoom();
    assert.ok(stored, 'the Mindi room should be on disk');
    assert.equal(stored.game.hiddenCard.id, before.hiddenCard.id);
    assert.equal(stored.game.mode, 'HIDDEN');
    // If these differ the fault is in writing, not in restoring, and the
    // assertions after the restart would blame the wrong half.
    assert.equal(stored.game.currentPlayerId, before.currentPlayerId);
    assert.deepEqual(
      stored.game.currentTrick.plays.map((p) => p.card.id),
      before.trick,
    );

    await startServer();

    // The chooser gets their secret back.
    const backAsChooser = await new Client(`${chooserName} again`).connect();
    backAsChooser.send({ type: 'session:resume', sessionToken: tokens[chooserName] });
    const chooserRoom = await backAsChooser.waitForState((r) => r.game != null);

    assert.equal(chooserRoom.game.gameId, 'mindi');
    assert.equal(chooserRoom.game.view.yourHiddenCard.id, before.hiddenCard.id);
    assert.deepEqual(chooserRoom.game.view.you.hand.map((c) => c.id), before.chooserHand);
    assert.equal(chooserRoom.game.view.currentPlayerId, before.currentPlayerId);
    assert.deepEqual(chooserRoom.game.view.currentTrick.plays.map((p) => p.card.id), before.trick);
    assert.equal(chooserRoom.game.view.handNumber, before.handNumber);
    assert.equal(chooserRoom.game.view.kotTarget, before.kotTarget);
    assert.equal(chooserRoom.game.view.mode, 'HIDDEN');
    assert.equal(chooserRoom.game.view.hiddenRevealed, false);

    // And nobody else does. A restart is exactly the moment a redaction
    // boundary could be rebuilt wrongly.
    const backAsOther = await new Client(`${otherName} again`).connect();
    backAsOther.send({ type: 'session:resume', sessionToken: tokens[otherName] });
    const otherRoom = await backAsOther.waitForState((r) => r.game != null);

    assert.equal(otherRoom.game.view.yourHiddenCard, null, 'the hidden card leaked after a restart');
    assert.equal(otherRoom.game.view.hiddenCardWaiting, true);
    assert.deepEqual(otherRoom.game.view.you.hand.map((c) => c.id), before.otherHand);
    // Nor may anyone see another player's cards.
    assert.equal(
      JSON.stringify(otherRoom.game.view.players).includes(before.chooserHand[0]),
      false,
      'another player’s hand leaked after a restart',
    );

    backAsChooser.close();
    backAsOther.close();
  });
});

describe('Mindi replays a repeated action only once', () => {
  it('treats the same actionId twice as one play', async () => {
    const names = ['Ana', 'Bo', 'Cy', 'Dee'];
    const host = await new Client(names[0]).connect();
    host.send({ type: 'room:create', actionId: 'ic', displayName: names[0], target: 3, gameId: 'mindi' });
    await host.waitFor((m) => m.type === 'session');
    const code = host.session.roomCode;

    const clients = [host];
    for (const name of names.slice(1)) {
      const client = await new Client(name).connect();
      client.send({ type: 'room:join', actionId: `ij-${name}`, displayName: name, roomCode: code });
      await client.waitFor((m) => m.type === 'session');
      clients.push(client);
    }
    for (const client of clients) client.send({ type: 'player:ready', ready: true });
    await host.waitForState((r) => r.players.every((p) => p.ready));
    host.send({ type: 'game:start', actionId: 'is' });
    for (const client of clients) await client.waitForState((r) => r.game != null);

    const chooserId = host.room.game.view.chooserId;
    const chooser = clients.find((c) => c.room.youId === chooserId);
    chooser.send({ type: 'game:action', actionId: 'imode', action: { type: 'CHOOSE_MODE', mode: 'KATTE' } });
    for (const client of clients) await client.waitForState((r) => r.game?.view.status === 'PLAYING');

    const leaderId = host.room.game.view.currentPlayerId;
    const leader = clients.find((c) => c.room.youId === leaderId);
    const card = leader.room.game.view.you.hand[0].id;
    const handBefore = leader.room.game.view.you.hand.length;

    // The same play twice — a double tap, or a retry after a flaky socket.
    leader.send({ type: 'game:action', actionId: 'same', action: { type: 'PLAY_CARD', cardId: card } });
    await leader.waitForState((r) => r.game?.view.currentTrick.plays.length === 1);
    leader.send({ type: 'game:action', actionId: 'same', action: { type: 'PLAY_CARD', cardId: card } });

    await new Promise((resolve) => setTimeout(resolve, 300));

    const view = leader.room.game.view;
    assert.equal(view.currentTrick.plays.length, 1, 'the card was played twice');
    assert.equal(view.you.hand.length, handBefore - 1);
    assert.equal(view.currentPlayerId !== leaderId, true, 'the turn moved on exactly once');

    for (const client of clients) client.close();
  });
});
