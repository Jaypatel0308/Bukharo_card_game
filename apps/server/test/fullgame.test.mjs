/**
 * Plays a whole round through the public WebSocket API with four clients that
 * only ever see their own hand — the §95 definition-of-done, automated.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import WebSocket from 'ws';

import {
  DEFAULT_RULES,
  assignmentsOf,
  selectResolution,
  validateMeld,
  validateOpeningRun,
} from '../../../packages/game-engine/dist/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(here, '../dist/index.js');
// The port is chosen by the OS (PORT=0) and read back from the server's own
// startup line, so parallel runs and busy CI machines cannot collide.
let wsUrl;
let child;
let dataDir;

class Client {
  constructor(name) {
    this.name = name;
    this.room = null;
    this.session = null;
    this.errors = [];
    this.waiters = [];
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

  /** Waits for a room:state newer than the one we have now. */
  nextState(predicate, timeoutMs = 20000) {
    const from = this.messages.length;
    return new Promise((resolve, reject) => {
      const check = (message) =>
        message.type === 'room:state' && (!predicate || predicate(message.room));
      const seen = this.messages.slice(from).find(check);
      if (seen) return resolve(seen.room);
      const waiter = { predicate: check, resolve: (m) => resolve(m.room) };
      this.waiters.push(waiter);
      setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
          reject(new Error(`${this.name}: timed out waiting for state`));
        }
      }, timeoutMs).unref();
    });
  }

  close() {
    this.ws?.close();
  }
}

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bukharo-full-'));
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
  child?.kill();
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
});

/** Polls until a condition holds across clients, or gives up. */
async function waitUntil(predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}

/**
 * Every client's socket is updated independently, so the table has to be given
 * a moment to agree on whose turn it is before the next move is chosen.
 */
async function syncTable(clients) {
  return waitUntil(() => {
    const first = clients[0].room;
    if (!first?.game) return false;
    return clients.every(
      (c) =>
        c.room?.status === first.status &&
        c.room?.game?.currentPlayerId === first.game.currentPlayerId &&
        c.room?.game?.stateVersion === first.game.stateVersion,
    );
  });
}

const RANK_ORDINAL = { A: 14, K: 13, Q: 12, J: 11, 10: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 3: 3, 2: 2 };

/** Cards that are not wild this round — the only ones a clean run may use. */
function naturals(hand, wildRank) {
  return hand.filter((c) => !c.isJoker && c.rank !== wildRank);
}

/** Longest clean same-suit consecutive run of at least `minimum` cards. */
function findCleanRun(hand, wildRank, minimum) {
  for (const suit of ['clubs', 'diamonds', 'hearts', 'spades']) {
    const bySuit = new Map();
    for (const card of naturals(hand, wildRank)) {
      if (card.suit !== suit) continue;
      if (!bySuit.has(card.rank)) bySuit.set(card.rank, card);
    }
    const ordinals = [...bySuit.entries()]
      .map(([rank, card]) => ({ ordinal: RANK_ORDINAL[rank], card }))
      .sort((a, b) => a.ordinal - b.ordinal);

    let streak = [];
    for (const entry of ordinals) {
      const previous = streak[streak.length - 1];
      if (previous && entry.ordinal === previous.ordinal + 1) streak.push(entry);
      else streak = [entry];
      if (streak.length >= minimum) return streak.map((e) => e.card);
    }
  }
  return null;
}

/** Any three or more cards of one rank. */
function findSet(hand, wildRank, minimum) {
  const byRank = new Map();
  for (const card of naturals(hand, wildRank)) {
    const bucket = byRank.get(card.rank) ?? [];
    bucket.push(card);
    byRank.set(card.rank, bucket);
  }
  for (const bucket of byRank.values()) {
    if (bucket.length >= minimum) return bucket.slice(0, minimum);
  }
  return null;
}

/** Sends one action and reports whether the server accepted it. */
async function act(client, action) {
  const actionId = `${client.name}-${Date.now()}-${Math.random()}`;
  const settled = Promise.race([
    client.nextState(() => true).then(() => 'ok'),
    client
      .waitFor((m) => m.type === 'error' && m.error.actionId === actionId, 20000)
      .then(() => 'error'),
  ]).catch(() => 'timeout');
  client.send({ type: 'game:action', actionId, action });
  return settled;
}

/**
 * Plays one turn for whichever client is on turn, using only its own view.
 * The turn is resumed from whatever phase it is actually in, so a turn is never
 * abandoned half-played.
 */
async function playTurn(clients) {
  const currentId = clients[0].room.game.currentPlayerId;
  const client = clients.find((c) => c.room.youId === currentId);
  const rules = clients[0].room.rules ?? DEFAULT_RULES;

  // Draw: prefer the stock, fall back to the pile (and vice versa), because
  // either source can legitimately be unavailable.
  if (client.room.game.turnPhase === 'AWAITING_DRAW') {
    const preferPile = client.room.game.discardPile.length > 0 && Math.random() < 0.25;
    const first = preferPile ? 'TAKE_DISCARD_PILE' : 'DRAW_STOCK';
    const second = preferPile ? 'DRAW_STOCK' : 'TAKE_DISCARD_PILE';
    let drew = await act(client, { type: first });
    if (client.room.game?.turnPhase === 'AWAITING_DRAW' && client.room.status === 'PLAYING') {
      drew = await act(client, { type: second });
    }
    if (client.room.status !== 'PLAYING') return true;
    if (client.room.game.turnPhase === 'AWAITING_DRAW') return false;
    void drew;
  }

  // Meld whatever is legal, a few attempts per turn.
  for (let attempt = 0; attempt < 4; attempt++) {
    const game = client.room.game;
    if (game.turnPhase !== 'PLAYING_CARDS') break;
    const hand = game.you.hand;
    const opened = game.teams[game.you.teamId].isOpened;
    const ctx = { wildRank: game.wildRank, rules };
    let played = false;

    if (!opened) {
      const run = findCleanRun(hand, game.wildRank, rules.openingRunMinimum);
      if (run && validateOpeningRun(run, ctx).ok) {
        played = (await act(client, { type: 'CREATE_MELD', cardIds: run.map((c) => c.id) })) === 'ok';
      }
    } else {
      for (const meld of game.melds.filter((m) => m.teamId === game.you.teamId)) {
        for (const card of hand) {
          const check = validateMeld([...meld.cards.map((c) => c.card), card], ctx, meld.type);
          if (!check.ok) continue;
          const chosen = selectResolution(check.resolutions, undefined);
          played =
            (await act(client, {
              type: 'ADD_TO_MELD',
              meldId: meld.id,
              cardIds: [card.id],
              ...(chosen.ok ? {} : { wildAssignments: assignmentsOf(chosen.options[0]) }),
            })) === 'ok';
          if (played) break;
        }
        if (played) break;
      }
      if (!played) {
        const candidates = [
          findCleanRun(hand, game.wildRank, rules.normalMeldMinimum),
          findSet(hand, game.wildRank, rules.normalMeldMinimum),
        ].filter(Boolean);
        for (const combo of candidates) {
          const check = validateMeld(combo, ctx);
          if (!check.ok) continue;
          const chosen = selectResolution(check.resolutions, undefined);
          played =
            (await act(client, {
              type: 'CREATE_MELD',
              cardIds: combo.map((c) => c.id),
              ...(chosen.ok ? {} : { wildAssignments: assignmentsOf(chosen.options[0]) }),
            })) === 'ok';
          if (played) break;
        }
      }
    }
    if (!played || client.room.status !== 'PLAYING') break;
  }

  // Discard to end the turn, trying another card if the first is refused.
  if (client.room.status !== 'PLAYING') return true;
  for (const card of [...(client.room.game.you.hand ?? [])].sort(() => Math.random() - 0.5)) {
    if (client.room.status !== 'PLAYING') return true;
    if (client.room.game.currentPlayerId !== currentId) return true;
    if ((await act(client, { type: 'DISCARD', cardId: card.id })) === 'ok') return true;
  }
  return client.room.game?.currentPlayerId !== currentId;
}

describe('a complete round played over the wire', () => {
  it('deals, plays, scores and deals again without losing state', async () => {
    const host = await new Client('Rahul').connect();
    host.send({ type: 'room:create', actionId: 'c1', displayName: 'Rahul', targetScore: 100000 });
    await host.waitFor((m) => m.type === 'session');
    const code = host.session.roomCode;

    const clients = [host];
    for (const name of ['Maya', 'Priya', 'Sam']) {
      const client = await new Client(name).connect();
      client.send({ type: 'room:join', actionId: `j-${name}`, displayName: name, roomCode: code });
      await client.waitFor((m) => m.type === 'session');
      clients.push(client);
    }

    for (const client of clients) client.send({ type: 'player:ready', ready: true });
    await host.waitFor((m) => m.type === 'room:state' && m.room.players.every((p) => p.ready));
    host.send({ type: 'game:start', actionId: 's1' });
    for (const client of clients) {
      await client.waitFor((m) => m.type === 'room:state' && m.room.game && m.room.status === 'PLAYING');
    }

    // Play until the round ends.
    let turns = 0;
    while (host.room.status === 'PLAYING' && turns < 250) {
      assert.ok(await syncTable(clients), 'clients should converge on the same state');
      if (host.room.status !== 'PLAYING') break;
      await playTurn(clients);
      turns++;

      // Invariant: nobody ever holds more than the table's worth of cards.
      const game = host.room.game;
      const visible =
        game.players.reduce((total, p) => total + p.handCount, 0) +
        game.stockCount +
        game.discardPile.length +
        game.bucharooCount +
        game.melds.reduce((total, m) => total + m.cards.length, 0) +
        (game.wildCard ? 1 : 0);
      assert.equal(visible, 108, `card count drifted to ${visible} on turn ${turns}`);
    }

    assert.ok(turns < 250, 'the round should finish inside the turn budget');
    assert.equal(host.room.status === 'ROUND_END' || host.room.status === 'MATCH_END', true);

    const record = host.room.game.scoreHistory.at(-1);
    assert.ok(record, 'a score record should exist');
    for (const teamId of ['TEAM_A', 'TEAM_B']) {
      const score = record.teams[teamId];
      assert.equal(
        score.roundTotal,
        score.cardPoints +
          score.cleanBucharoBonus +
          score.dirtyBucharoBonus +
          score.bucharooBonus +
          score.goingOutBonus -
          score.handPenalty,
      );
      assert.equal(host.room.game.teams[teamId].matchScore, score.matchTotalAfter);
    }

    // Every client sees the same public result.
    for (const client of clients) {
      await client.waitFor((m) => m.type === 'room:state' && m.room.game?.scoreHistory.length === 1);
      assert.equal(client.room.game.teams.TEAM_A.matchScore, host.room.game.teams.TEAM_A.matchScore);
    }

    // The host deals round two: opening state resets, match scores survive.
    if (host.room.status === 'ROUND_END') {
      host.send({ type: 'round:next', actionId: 'r2' });
      const next = await host.nextState((room) => room.game?.roundNumber === 2);
      assert.equal(next.status, 'PLAYING');
      assert.equal(next.game.teams.TEAM_A.isOpened, false);
      assert.equal(next.game.teams.TEAM_B.isOpened, false);
      assert.equal(next.game.melds.length, 0);
      assert.equal(next.game.bucharooCount, 13);
      assert.equal(next.game.you.hand.length, 13);
      assert.equal(next.game.scoreHistory.length, 1);
      assert.equal(next.game.teams.TEAM_A.matchScore, record.teams.TEAM_A.matchTotalAfter);
    }

    for (const client of clients) client.close();
  });
});
