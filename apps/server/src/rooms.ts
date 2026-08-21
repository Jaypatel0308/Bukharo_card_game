import { randomInt, randomFillSync } from 'node:crypto';

import {
  DEFAULT_RULES,
  DEFAULT_TEAM_NAMES,
  forceSkipTurn,
  SEAT_ORDER,
  applyAction,
  createMatch,
  cryptoRng,
  setTeamName,
  startNextRound,
  viewFor,
  type EngineEvent,
  type GameAction,
  type GameState,
  type Seat,
  type TeamId,
} from '@bukharo/game-engine';
import {
  DEFAULT_GAME,
  MAX_TARGET_SCORE,
  MIN_TARGET_SCORE,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  describeGame,
  teamForPosition,
  whyCannotStart,
  type GameActionPayload,
  type GameId,
  type RoomView,
  type ServerError,
  type ServerErrorCode,
} from '@bukharo/shared';

import { config } from './config.js';
import {
  FileStore,
  ROOM_SCHEMA_VERSION,
  hashToken,
  newId,
  newSessionToken,
  type Room,
  type RoomPlayer,
  type Store,
} from './store.js';

const rng = cryptoRng((array) => {
  randomFillSync(array);
  return array;
});

export type OpResult<T> = { ok: true; value: T } | { ok: false; error: ServerError };

function fail(code: ServerErrorCode, message: string, extra: Partial<ServerError> = {}): OpResult<never> {
  return { ok: false, error: { code, message, ...extra } };
}

/** Serialises all mutations of one room (§60). */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export interface JoinResult {
  room: Room;
  playerId: string;
  sessionToken: string;
}

export interface ActionResult {
  room: Room;
  events: EngineEvent[];
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly roomIdByCode = new Map<string, string>();
  /** token hash → location. Rebuilt from persisted rooms on boot. */
  private readonly sessions = new Map<string, { roomId: string; playerId: string }>();
  private readonly locks = new Map<string, Mutex>();

  constructor(private readonly store: Store) {}

  static async create(): Promise<RoomManager> {
    const store = new FileStore(config.dataDir);
    await store.init();
    const manager = new RoomManager(store);
    await manager.restore();
    return manager;
  }

  private async restore(): Promise<void> {
    const rooms = await this.store.loadAll();
    for (const room of rooms) {
      // Nobody is connected to a freshly started process, and nobody is being
      // waited on: that countdown belonged to the process that died.
      for (const player of room.players) player.connected = false;
      room.waitingForPlayerId = null;
      room.waitingSince = null;
      this.rooms.set(room.id, room);
      this.roomIdByCode.set(room.code, room.id);
      for (const player of room.players) {
        this.sessions.set(player.sessionTokenHash, { roomId: room.id, playerId: player.id });
      }
    }
  }

  private lockFor(roomId: string): Mutex {
    let mutex = this.locks.get(roomId);
    if (!mutex) {
      mutex = new Mutex();
      this.locks.set(roomId, mutex);
    }
    return mutex;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  resolveSession(token: string): { roomId: string; playerId: string } | undefined {
    return this.sessions.get(hashToken(token));
  }

  /** Every mutation goes through here so persistence and versioning stay honest. */
  private async commit(room: Room): Promise<void> {
    room.updatedAt = Date.now();
    pruneProcessedActions(room);
    await this.store.save(room);
  }

  private generateRoomCode(): string {
    for (let attempt = 0; attempt < 200; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      }
      if (!this.roomIdByCode.has(code)) return code;
    }
    throw new Error('Could not allocate a room code.');
  }

  /* ---------------------------------------------------------------- */
  /* Lobby                                                             */
  /* ---------------------------------------------------------------- */

  async createRoom(
    displayName: string,
    targetScore: number,
    gameId: GameId = DEFAULT_GAME,
  ): Promise<OpResult<JoinResult>> {
    const name = cleanName(displayName);
    if (!name) return fail('NAME_REQUIRED', 'Please enter a display name.');

    const now = Date.now();
    const token = newSessionToken();
    const player: RoomPlayer = {
      id: newId('player'),
      displayName: name,
      position: 0,
      ready: false,
      isHost: true,
      connected: true,
      joinedAt: now,
      lastSeenAt: now,
      sessionTokenHash: hashToken(token),
    };
    const room: Room = {
      id: newId('room'),
      schemaVersion: ROOM_SCHEMA_VERSION,
      gameId,
      code: this.generateRoomCode(),
      status: 'LOBBY',
      targetScore: clampTarget(targetScore),
      rules: { ...DEFAULT_RULES, targetScore: clampTarget(targetScore) },
      teamNames: { ...DEFAULT_TEAM_NAMES },
      players: [player],
      game: null,
      createdAt: now,
      updatedAt: now,
      processedActions: {},
      waitingForPlayerId: null,
      waitingSince: null,
    };

    this.rooms.set(room.id, room);
    this.roomIdByCode.set(room.code, room.id);
    this.sessions.set(player.sessionTokenHash, { roomId: room.id, playerId: player.id });
    await this.commit(room);
    return { ok: true, value: { room, playerId: player.id, sessionToken: token } };
  }

  async joinRoom(roomCode: string, displayName: string): Promise<OpResult<JoinResult>> {
    const name = cleanName(displayName);
    if (!name) return fail('NAME_REQUIRED', 'Please enter a display name.');

    const roomId = this.roomIdByCode.get(roomCode.trim().toUpperCase());
    const room = roomId ? this.rooms.get(roomId) : undefined;
    if (!room) return fail('ROOM_NOT_FOUND', 'No room with that code. Check the code and try again.');

    return this.lockFor(room.id).run(async () => {
      if (room.status !== 'LOBBY') {
        return fail(
          'ROOM_IN_PROGRESS',
          'That match has already started. Ask the host for an invite, or rejoin from the device you were playing on.',
        );
      }
      const game = describeGame(room.gameId);
      if (room.players.length >= game.maxPlayers) {
        return fail(
          'ROOM_FULL',
          `That room is full — ${game.name} seats ${game.maxPlayers} players.`,
        );
      }

      const now = Date.now();
      const token = newSessionToken();
      const taken = new Set(room.players.map((p) => p.position));
      const position = firstFreePosition(taken, game.maxPlayers);
      const player: RoomPlayer = {
        id: newId('player'),
        displayName: uniqueName(room, name),
        position,
        ready: false,
        isHost: false,
        connected: true,
        joinedAt: now,
        lastSeenAt: now,
        sessionTokenHash: hashToken(token),
      };
      room.players.push(player);
      this.sessions.set(player.sessionTokenHash, { roomId: room.id, playerId: player.id });
      await this.commit(room);
      return { ok: true as const, value: { room, playerId: player.id, sessionToken: token } };
    });
  }

  async setReady(roomId: string, playerId: string, ready: boolean): Promise<OpResult<Room>> {
    return this.mutate(roomId, playerId, (room, player) => {
      if (room.status !== 'LOBBY') return fail('ROOM_IN_PROGRESS', 'The match has already started.');
      player.ready = ready;
      return { ok: true as const, value: room };
    });
  }

  async choosePosition(roomId: string, playerId: string, position: number): Promise<OpResult<Room>> {
    return this.mutate(roomId, playerId, (room, player) => {
      if (room.status !== 'LOBBY') return fail('ROOM_IN_PROGRESS', 'Seats are locked once the match starts.');
      if (!isSeatable(room, position)) {
        return fail('INVALID_MESSAGE', 'That is not a seat at this table.');
      }
      const occupant = room.players.find((p) => p.position === position && p.id !== player.id);
      if (occupant) return fail('SEAT_TAKEN', `${occupant.displayName} is already sitting there.`);
      player.position = position;
      return { ok: true as const, value: room };
    });
  }

  async assignPosition(
    roomId: string,
    hostId: string,
    targetPlayerId: string,
    position: number,
  ): Promise<OpResult<Room>> {
    return this.mutate(roomId, hostId, (room, host) => {
      if (!host.isHost) return fail('NOT_HOST', 'Only the host can move players.');
      if (room.status !== 'LOBBY') return fail('ROOM_IN_PROGRESS', 'Seats are locked once the match starts.');
      if (!isSeatable(room, position)) {
        return fail('INVALID_MESSAGE', 'That is not a seat at this table.');
      }
      const target = room.players.find((p) => p.id === targetPlayerId);
      if (!target) return fail('NOT_IN_ROOM', 'That player is no longer in the room.');
      // Swap rather than evict, so the table never ends up with an empty seat.
      const occupant = room.players.find((p) => p.position === position && p.id !== target.id);
      if (occupant) occupant.position = target.position;
      target.position = position;
      return { ok: true as const, value: room };
    });
  }

  async kickPlayer(roomId: string, hostId: string, targetPlayerId: string): Promise<OpResult<Room>> {
    return this.mutate(roomId, hostId, (room, host) => {
      if (!host.isHost) return fail('NOT_HOST', 'Only the host can remove players.');
      if (room.status !== 'LOBBY') {
        return fail('ROOM_IN_PROGRESS', 'Players cannot be removed once the match has started. End the match instead.');
      }
      if (targetPlayerId === hostId) return fail('NOT_IN_ROOM', 'The host cannot remove themselves.');
      const target = room.players.find((p) => p.id === targetPlayerId);
      if (!target) return fail('NOT_IN_ROOM', 'That player is no longer in the room.');
      room.players = room.players.filter((p) => p.id !== targetPlayerId);
      this.sessions.delete(target.sessionTokenHash);
      return { ok: true as const, value: room };
    });
  }

  async updateSettings(roomId: string, hostId: string, targetScore: number): Promise<OpResult<Room>> {
    return this.mutate(roomId, hostId, (room, host) => {
      if (!host.isHost) return fail('NOT_HOST', 'Only the host can change match settings.');
      if (room.status !== 'LOBBY') return fail('ROOM_IN_PROGRESS', 'Settings are locked once the match starts.');
      room.targetScore = clampTarget(targetScore);
      room.rules = { ...room.rules, targetScore: room.targetScore };
      return { ok: true as const, value: room };
    });
  }

  async renameTeam(
    roomId: string,
    hostId: string,
    teamId: TeamId,
    name: string,
  ): Promise<OpResult<Room>> {
    return this.mutate(roomId, hostId, (room, host) => {
      if (!host.isHost) return fail('NOT_HOST', 'Only the host can rename the teams.');
      const clean = cleanName(name) || DEFAULT_TEAM_NAMES[teamId];
      room.teamNames[teamId] = clean;
      // A match in progress carries its own copy, used by the game log.
      if (room.game) room.game = setTeamName(room.game, teamId, clean);
      return { ok: true as const, value: room };
    });
  }

  /* ---------------------------------------------------------------- */
  /* Match lifecycle                                                   */
  /* ---------------------------------------------------------------- */

  async startGame(roomId: string, hostId: string, actionId: string): Promise<OpResult<Room>> {
    return this.mutate(roomId, hostId, (room, host) => {
      if (alreadyProcessed(room, actionId)) return { ok: true as const, value: room };
      if (!host.isHost) return fail('NOT_HOST', 'Only the host can start the match.');
      if (room.status !== 'LOBBY') return fail('ROOM_IN_PROGRESS', 'The match has already started.');
      const blocked = whyCannotStart(describeGame(room.gameId), room.players.length);
      if (blocked) return fail('NOT_READY', blocked);

      const positions = room.players.map((p) => p.position);
      if (positions.some((p) => p === null) || new Set(positions).size !== positions.length) {
        return fail('NOT_READY', 'Every player needs their own seat before the match can start.');
      }
      const waiting = room.players.filter((p) => !p.ready);
      if (waiting.length > 0) {
        return fail('NOT_READY', `Still waiting for ${waiting.map((p) => p.displayName).join(', ')}.`);
      }

      room.game = createMatch({
        roomId: room.id,
        seats: bukharoSeating(room),
        targetScore: room.targetScore,
        rules: room.rules,
        rng,
        teamNames: room.teamNames,
      });
      stampLog(room.game);
      room.status = 'PLAYING';
      room.processedActions[actionId] = Date.now();
      return { ok: true as const, value: room };
    });
  }

  async nextRound(roomId: string, hostId: string, actionId: string): Promise<OpResult<Room>> {
    return this.mutate(roomId, hostId, (room, host) => {
      if (alreadyProcessed(room, actionId)) return { ok: true as const, value: room };
      if (!host.isHost) return fail('NOT_HOST', 'Only the host can deal the next round.');
      if (room.status !== 'ROUND_END' || !room.game) {
        return fail('WRONG_PHASE', 'The next round can only be dealt once the current round has finished.');
      }
      room.game = startNextRound(room.game, room.rules, rng);
      stampLog(room.game);
      room.status = 'PLAYING';
      room.processedActions[actionId] = Date.now();
      return { ok: true as const, value: room };
    });
  }

  async restartMatch(roomId: string, hostId: string, actionId: string): Promise<OpResult<Room>> {
    return this.mutate(roomId, hostId, (room, host) => {
      if (alreadyProcessed(room, actionId)) return { ok: true as const, value: room };
      if (!host.isHost) return fail('NOT_HOST', 'Only the host can start a new match.');
      if (room.status !== 'MATCH_END' && room.status !== 'ABANDONED') {
        return fail('WRONG_PHASE', 'Finish the current match first.');
      }
      room.game = createMatch({
        roomId: room.id,
        seats: bukharoSeating(room),
        targetScore: room.targetScore,
        rules: room.rules,
        rng,
        teamNames: room.teamNames,
      });
      stampLog(room.game);
      room.status = 'PLAYING';
      room.processedActions[actionId] = Date.now();
      return { ok: true as const, value: room };
    });
  }

  /**
   * §54 — moves the table past a player who has gone. Only the host, only when
   * that player is genuinely disconnected, and only after the grace period, so
   * this cannot be used to rush somebody with a flaky connection.
   */
  async skipAbsentPlayer(roomId: string, hostId: string): Promise<OpResult<Room>> {
    return this.mutate(roomId, hostId, (room, host) => {
      if (!host.isHost) return fail('NOT_HOST', 'Only the host can skip a player.');
      if (room.status !== 'PLAYING' || !room.game) {
        return fail('WRONG_PHASE', 'There is no turn to skip right now.');
      }
      const current = room.players.find((p) => p.id === room.game!.currentPlayerId);
      if (!current) return fail('NOT_IN_ROOM', 'That player is no longer in the room.');
      if (current.connected) {
        return fail('WRONG_PHASE', `${current.displayName} is still connected — it is their turn to play.`);
      }
      const waitingFor = Date.now() - (room.waitingSince ?? Date.now());
      if (waitingFor < config.disconnectGraceMs) {
        const seconds = Math.ceil((config.disconnectGraceMs - waitingFor) / 1000);
        return fail(
          'WRONG_PHASE',
          `Give ${current.displayName} a moment to reconnect — you can skip them in ${seconds}s.`,
        );
      }

      room.game = forceSkipTurn(room.game, 'disconnected');
      stampLog(room.game);
      room.waitingForPlayerId = null;
      room.waitingSince = null;
      return { ok: true as const, value: room };
    });
  }

  async endMatch(roomId: string, hostId: string): Promise<OpResult<Room>> {
    return this.mutate(roomId, hostId, (room, host) => {
      if (!host.isHost) return fail('NOT_HOST', 'Only the host can end the match.');
      room.status = 'ABANDONED';
      room.waitingForPlayerId = null;
      room.waitingSince = null;
      return { ok: true as const, value: room };
    });
  }

  /* ---------------------------------------------------------------- */
  /* Gameplay                                                          */
  /* ---------------------------------------------------------------- */

  async gameAction(
    roomId: string,
    playerId: string,
    actionId: string,
    payload: GameActionPayload,
  ): Promise<OpResult<ActionResult>> {
    return this.mutate(roomId, playerId, (room) => {
      if (!room.game || room.status !== 'PLAYING') {
        return fail('GAME_NOT_PLAYING', 'The round is not in progress.');
      }
      // §59 — a retried message must not play the move twice.
      if (alreadyProcessed(room, actionId)) {
        return { ok: true as const, value: { room, events: [] as EngineEvent[] } };
      }

      const action = toGameAction(payload, playerId);
      if (!action) return fail('INVALID_MESSAGE', 'That action was not understood.');

      const result = applyAction(room.game, action, room.rules);
      if (!result.ok) {
        return fail(result.code, result.message, result.options ? { options: result.options } : {});
      }

      room.game = result.state;
      stampLog(room.game);
      room.processedActions[actionId] = Date.now();
      if (room.game.status === 'ROUND_END') room.status = 'ROUND_END';
      else if (room.game.status === 'MATCH_END') room.status = 'MATCH_END';

      return { ok: true as const, value: { room, events: result.events } };
    });
  }

  /* ---------------------------------------------------------------- */
  /* Presence                                                          */
  /* ---------------------------------------------------------------- */

  async markConnected(roomId: string, playerId: string): Promise<Room | undefined> {
    const result = await this.mutate(roomId, playerId, (room, player) => {
      player.connected = true;
      player.lastSeenAt = Date.now();
      if (room.waitingForPlayerId === playerId) {
        room.waitingForPlayerId = null;
        room.waitingSince = null;
      }
      ensureReachableHost(room);
      return { ok: true as const, value: room };
    });
    return result.ok ? result.value : undefined;
  }

  async markDisconnected(roomId: string, playerId: string): Promise<Room | undefined> {
    const result = await this.mutate(roomId, playerId, (room, player) => {
      player.connected = false;
      player.lastSeenAt = Date.now();

      // §54 — pause the table when the active player drops.
      if (room.status === 'PLAYING' && room.game?.currentPlayerId === playerId) {
        room.waitingForPlayerId = playerId;
        room.waitingSince = Date.now();
      }
      // §55 — host duties move to the longest-standing connected member. If
      // nobody is left to take them, they stay put and are reassigned by
      // ensureReachableHost as soon as anyone comes back.
      ensureReachableHost(room);
      return { ok: true as const, value: room };
    });
    return result.ok ? result.value : undefined;
  }

  async leaveRoom(roomId: string, playerId: string): Promise<Room | undefined> {
    const result = await this.mutate(roomId, playerId, (room, player) => {
      if (room.status === 'LOBBY') {
        room.players = room.players.filter((p) => p.id !== playerId);
        this.sessions.delete(player.sessionTokenHash);
        if (player.isHost && room.players.length > 0) {
          const heir = [...room.players].sort((a, b) => a.joinedAt - b.joinedAt)[0]!;
          heir.isHost = true;
        }
      } else {
        // Mid-match the seat stays reserved so the player can come back (§52).
        player.connected = false;
        player.lastSeenAt = Date.now();
      }
      return { ok: true as const, value: room };
    });
    return result.ok ? result.value : undefined;
  }

  /* ---------------------------------------------------------------- */
  /* Housekeeping                                                      */
  /* ---------------------------------------------------------------- */

  /** §65 — drop rooms nobody is coming back to. Returns removed room ids. */
  async sweep(now = Date.now()): Promise<string[]> {
    const removed: string[] = [];
    for (const room of [...this.rooms.values()]) {
      const idle = now - room.updatedAt;
      const everyoneGone = room.players.every((p) => !p.connected);
      const expired =
        (room.status === 'LOBBY' && everyoneGone && idle > config.lobbyTtlMs) ||
        (room.status === 'MATCH_END' && idle > config.finishedTtlMs) ||
        (room.status === 'ABANDONED' && idle > config.abandonedTtlMs) ||
        ((room.status === 'PLAYING' || room.status === 'ROUND_END') &&
          everyoneGone &&
          idle > config.abandonedTtlMs) ||
        room.players.length === 0;

      if (!expired) continue;
      this.rooms.delete(room.id);
      this.roomIdByCode.delete(room.code);
      this.locks.delete(room.id);
      for (const player of room.players) this.sessions.delete(player.sessionTokenHash);
      await this.store.delete(room.id);
      removed.push(room.id);
    }
    return removed;
  }

  private async mutate<T>(
    roomId: string,
    playerId: string,
    fn: (room: Room, player: RoomPlayer) => OpResult<T>,
  ): Promise<OpResult<T>> {
    if (!this.rooms.has(roomId)) return fail('ROOM_NOT_FOUND', 'That room no longer exists.');
    return this.lockFor(roomId).run(async () => {
      // Re-read inside the lock: the sweep may have taken the room while this
      // action was queued behind another.
      const room = this.rooms.get(roomId);
      if (!room) return fail('ROOM_NOT_FOUND', 'That room no longer exists.');
      const player = room.players.find((p) => p.id === playerId);
      if (!player) return fail('NOT_IN_ROOM', 'You are not seated in this room.');
      const result = fn(room, player);
      if (result.ok) await this.commit(room);
      return result;
    });
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Guarantees that if anybody is in the room, one of them can act as host.
 *
 * Without this a room is bricked when the host is the last to leave: the flag
 * stays with the departed player, and the people who come back can neither
 * deal the next round nor end the match.
 */
function ensureReachableHost(room: Room): void {
  const connected = room.players.filter((p) => p.connected);
  if (connected.length === 0) return;
  if (connected.some((p) => p.isHost)) return;

  const heir = [...connected].sort((a, b) => a.joinedAt - b.joinedAt)[0]!;
  for (const player of room.players) player.isHost = player.id === heir.id;
}

/** The lowest place nobody has taken. */
function firstFreePosition(taken: Set<number | null>, maxPlayers: number): number | null {
  for (let position = 0; position < maxPlayers; position++) {
    if (!taken.has(position)) return position;
  }
  return null;
}

function isSeatable(room: Room, position: number): boolean {
  return (
    Number.isInteger(position) && position >= 0 && position < describeGame(room.gameId).maxPlayers
  );
}

/**
 * Bukharo's engine speaks in compass seats. The room speaks in positions, so
 * they are translated here — the one place that knows both — keeping the
 * engine's own vocabulary out of the room layer.
 */
function bukharoSeating(room: Room): Array<{ id: string; displayName: string; seat: Seat }> {
  return [...room.players]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((player, index) => ({
      id: player.id,
      displayName: player.displayName,
      seat: SEAT_ORDER[index]!,
    }));
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 20);
}

/** Two Sams at one table is confusing; the second becomes "Sam (2)". */
function uniqueName(room: Room, name: string): string {
  const taken = new Set(room.players.map((p) => p.displayName.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; n < 10; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return name;
}

function clampTarget(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RULES.targetScore;
  return Math.min(MAX_TARGET_SCORE, Math.max(MIN_TARGET_SCORE, Math.round(value)));
}

function alreadyProcessed(room: Room, actionId: string): boolean {
  if (!actionId) return false;
  return room.processedActions[actionId] !== undefined;
}

function pruneProcessedActions(room: Room): void {
  const cutoff = Date.now() - config.actionIdTtlMs;
  for (const [id, at] of Object.entries(room.processedActions)) {
    if (at < cutoff) delete room.processedActions[id];
  }
}

/** The engine is clock-free; wall-clock stamps are applied here. */
function stampLog(game: GameState): void {
  const now = Date.now();
  for (let i = game.log.length - 1; i >= 0; i--) {
    const entry = game.log[i]!;
    if (entry.timestamp > 1e12) break;
    entry.timestamp = now;
  }
}

function toGameAction(payload: GameActionPayload, playerId: string): GameAction | null {
  switch (payload.type) {
    case 'DRAW_STOCK':
      return { type: 'DRAW_STOCK', playerId };
    case 'TAKE_DISCARD_PILE':
      return { type: 'TAKE_DISCARD_PILE', playerId };
    case 'CREATE_MELD':
      if (!Array.isArray(payload.cardIds)) return null;
      return {
        type: 'CREATE_MELD',
        playerId,
        cardIds: payload.cardIds.filter((id) => typeof id === 'string').slice(0, 30),
        ...(payload.meldType ? { meldType: payload.meldType } : {}),
        ...(payload.wildAssignments ? { wildAssignments: payload.wildAssignments } : {}),
      };
    case 'ADD_TO_MELD':
      if (!Array.isArray(payload.cardIds) || typeof payload.meldId !== 'string') return null;
      return {
        type: 'ADD_TO_MELD',
        playerId,
        meldId: payload.meldId,
        cardIds: payload.cardIds.filter((id) => typeof id === 'string').slice(0, 30),
        ...(payload.wildAssignments ? { wildAssignments: payload.wildAssignments } : {}),
      };
    case 'DISCARD':
      if (typeof payload.cardId !== 'string') return null;
      return { type: 'DISCARD', playerId, cardId: payload.cardId };
    default:
      return null;
  }
}

/**
 * §57 — the only function that turns a Room into something a client may see.
 * Session hashes and every other player's hand stay behind.
 */
export function roomView(room: Room, viewerId: string | null): RoomView {
  return {
    roomId: room.id,
    roomCode: room.code,
    gameId: room.gameId,
    status: room.status,
    targetScore: room.targetScore,
    hostId: room.players.find((p) => p.isHost)?.id ?? null,
    teamNames: { ...DEFAULT_TEAM_NAMES, ...room.teamNames },
    players: room.players.map((player) => ({
      id: player.id,
      displayName: player.displayName,
      position: player.position,
      seatLabel:
        player.position === null
          ? null
          : describeGame(room.gameId).seatLabel(player.position, room.players.length),
      teamId: player.position === null ? null : teamForPosition(player.position),
      connected: player.connected,
      ready: player.ready,
      isHost: player.isHost,
    })),
    game: room.game ? viewFor(room.game, viewerId) : null,
    rules: room.rules,
    youId: viewerId,
    cannotStartReason:
      room.status === 'LOBBY'
        ? whyCannotStart(describeGame(room.gameId), room.players.length)
        : null,
    waitingForPlayerId: room.waitingForPlayerId,
    waitingSince: room.waitingSince,
    disconnectGraceMs: config.disconnectGraceMs,
    createdAt: room.createdAt,
  };
}
