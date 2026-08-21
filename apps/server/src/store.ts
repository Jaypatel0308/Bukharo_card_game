import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { GameState, RuleConfig, TeamId } from '@bukharo/game-engine';
import type { GameId, RoomStatus } from '@bukharo/shared';

/**
 * Server-side room record. This is the persisted shape — it contains hands and
 * session secrets and must never be sent to a client. Use `roomView` instead.
 */
export interface RoomPlayer {
  id: string;
  displayName: string;
  /** Place in the ring, 0-based. Teams alternate: even is A, odd is B. */
  position: number | null;
  ready: boolean;
  isHost: boolean;
  connected: boolean;
  joinedAt: number;
  lastSeenAt: number;
  /** SHA-256 of the reconnect token; the raw token only ever lives on the client (§53). */
  sessionTokenHash: string;
}

/**
 * Bumped whenever the persisted shape changes in a way older files cannot
 * satisfy. A room written by an earlier version is dropped on load rather than
 * resurrected half-formed.
 */
export const ROOM_SCHEMA_VERSION = 2;

export interface Room {
  id: string;
  schemaVersion: number;
  code: string;
  gameId: GameId;
  status: RoomStatus;
  targetScore: number;
  rules: RuleConfig;
  teamNames: Record<TeamId, string>;
  players: RoomPlayer[];
  game: GameState | null;
  createdAt: number;
  updatedAt: number;
  /** §59 — actionId → timestamp, for deduplicating retried messages. */
  processedActions: Record<string, number>;
  /** §54 — set while the table is waiting on a disconnected active player. */
  waitingForPlayerId: string | null;
  waitingSince: number | null;
}

export interface Store {
  loadAll(): Promise<Room[]>;
  save(room: Room): Promise<void>;
  delete(roomId: string): Promise<void>;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('hex')}`;
}

/**
 * JSON-file store. Deliberately simple: one file per room, written atomically
 * and coalesced so a busy game does not thrash the disk. Swapping in Redis or
 * Postgres later means implementing this same three-method interface.
 */
export class FileStore implements Store {
  private readonly dir: string;
  /** Per-room write chain, so two saves never race on the same file. */
  private readonly inFlight = new Map<string, Promise<void>>();
  private counter = 0;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'rooms');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
  }

  private fileFor(roomId: string): string {
    // Room ids are server-generated hex, but never trust them into a path.
    const safe = roomId.replace(/[^a-zA-Z0-9_-]/g, '');
    return path.join(this.dir, `${safe}.json`);
  }

  async loadAll(): Promise<Room[]> {
    await this.init();
    const files = await fs.readdir(this.dir).catch(() => [] as string[]);
    const rooms: Room[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(this.dir, file), 'utf8');
        const room = JSON.parse(raw) as Room;
        // A room from an older build cannot be trusted to have the fields this
        // one relies on, so it is left behind rather than half-restored.
        if (room.schemaVersion === ROOM_SCHEMA_VERSION) rooms.push(room);
      } catch {
        // A truncated file from a hard kill: skip it rather than refuse to boot.
      }
    }
    return rooms;
  }

  /**
   * The room object keeps mutating, so it is serialised immediately and the
   * resulting bytes are queued. Callers get a promise that settles when their
   * own snapshot has hit the disk.
   */
  async save(room: Room): Promise<void> {
    const snapshot = JSON.stringify(room);
    const roomId = room.id;
    const previous = this.inFlight.get(roomId) ?? Promise.resolve();
    const next = previous.then(() => this.writeNow(roomId, snapshot));
    this.inFlight.set(
      roomId,
      next.catch(() => undefined),
    );
    return next;
  }

  private async writeNow(roomId: string, snapshot: string): Promise<void> {
    const file = this.fileFor(roomId);
    // Cheap insurance against the data directory disappearing under us.
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.${this.counter++}.tmp`;
    try {
      await fs.writeFile(tmp, snapshot, { mode: 0o600 });
      await fs.rename(tmp, file);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async delete(roomId: string): Promise<void> {
    await fs.rm(this.fileFor(roomId), { force: true });
  }
}

/** Test/dev store with no disk I/O. */
export class MemoryStore implements Store {
  private readonly rooms = new Map<string, Room>();
  async loadAll(): Promise<Room[]> {
    return [...this.rooms.values()];
  }
  async save(room: Room): Promise<void> {
    this.rooms.set(room.id, room);
  }
  async delete(roomId: string): Promise<void> {
    this.rooms.delete(roomId);
  }
}
