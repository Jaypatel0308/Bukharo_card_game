/**
 * §65 — room expiry.
 *
 * `sweep()` is the only code in the server that deletes a game. If its
 * conditions are wrong it quietly eats a match people are still playing, so it
 * is worth pinning down exactly which rooms it takes and which it leaves.
 *
 * The TTLs are read from the environment when the config module loads, so they
 * are set here before the server modules are imported.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

process.env.LOBBY_TTL_MS = '1000';
process.env.FINISHED_TTL_MS = '5000';
process.env.ABANDONED_TTL_MS = '9000';

let RoomManager;
let MemoryStore;

before(async () => {
  ({ RoomManager } = await import('../dist/rooms.js'));
  ({ MemoryStore } = await import('../dist/store.js'));
});

/** A room whose age and state can be dictated. */
async function makeRoom(manager, { status = 'LOBBY', idleMs = 0, connected = true } = {}) {
  const result = await manager.createRoom('Rahul', 2000);
  assert.equal(result.ok, true);
  const { room, sessionToken } = result.value;
  room.status = status;
  room.updatedAt = Date.now() - idleMs;
  for (const player of room.players) player.connected = connected;
  return { room, sessionToken };
}

describe('room expiry', () => {
  it('takes a lobby everyone abandoned', async () => {
    const store = new MemoryStore();
    const manager = new RoomManager(store);
    const { room, sessionToken } = await makeRoom(manager, { idleMs: 5000, connected: false });

    const removed = await manager.sweep();

    assert.deepEqual(removed, [room.id]);
    assert.equal(manager.getRoom(room.id), undefined);
    // Its session and its code go with it.
    assert.equal(manager.resolveSession(sessionToken), undefined);
    assert.equal((await store.loadAll()).length, 0);

    const rejoin = await manager.joinRoom(room.code, 'Maya');
    assert.equal(rejoin.ok, false);
    assert.equal(rejoin.error.code, 'ROOM_NOT_FOUND');
  });

  it('leaves a lobby someone is still sitting in, however old', async () => {
    const manager = new RoomManager(new MemoryStore());
    const { room } = await makeRoom(manager, { idleMs: 60 * 60 * 1000, connected: true });

    assert.deepEqual(await manager.sweep(), []);
    assert.ok(manager.getRoom(room.id));
  });

  it('leaves a lobby that has only just gone quiet', async () => {
    const manager = new RoomManager(new MemoryStore());
    const { room } = await makeRoom(manager, { idleMs: 200, connected: false });

    assert.deepEqual(await manager.sweep(), []);
    assert.ok(manager.getRoom(room.id));
  });

  it('does not take a match in progress that people will come back to', async () => {
    const manager = new RoomManager(new MemoryStore());
    // Everyone disconnected an hour ago, but the abandoned window is longer.
    const { room } = await makeRoom(manager, { status: 'PLAYING', idleMs: 5000, connected: false });

    assert.deepEqual(await manager.sweep(), []);
    assert.ok(manager.getRoom(room.id), 'a paused game must survive a sweep');
  });

  it('takes a match in progress once nobody has come back for long enough', async () => {
    const manager = new RoomManager(new MemoryStore());
    const { room } = await makeRoom(manager, { status: 'PLAYING', idleMs: 20000, connected: false });

    assert.deepEqual(await manager.sweep(), [room.id]);
  });

  it('keeps a round-end room while its players are still connected', async () => {
    const manager = new RoomManager(new MemoryStore());
    const { room } = await makeRoom(manager, { status: 'ROUND_END', idleMs: 20000, connected: true });

    assert.deepEqual(await manager.sweep(), []);
    assert.ok(manager.getRoom(room.id));
  });

  it('takes a finished match after its retention window', async () => {
    const manager = new RoomManager(new MemoryStore());
    const fresh = await makeRoom(manager, { status: 'MATCH_END', idleMs: 1000 });
    const stale = await makeRoom(manager, { status: 'MATCH_END', idleMs: 20000 });

    const removed = await manager.sweep();
    assert.deepEqual(removed, [stale.room.id]);
    assert.ok(manager.getRoom(fresh.room.id));
  });

  it('takes an abandoned room after its window', async () => {
    const manager = new RoomManager(new MemoryStore());
    const { room } = await makeRoom(manager, { status: 'ABANDONED', idleMs: 20000 });

    assert.deepEqual(await manager.sweep(), [room.id]);
  });

  it('takes a room nobody is left in at all', async () => {
    const manager = new RoomManager(new MemoryStore());
    const { room } = await makeRoom(manager, { idleMs: 0 });
    room.players = [];

    assert.deepEqual(await manager.sweep(), [room.id]);
  });

  it('sweeps repeatedly without complaint', async () => {
    const manager = new RoomManager(new MemoryStore());
    await makeRoom(manager, { idleMs: 5000, connected: false });

    assert.equal((await manager.sweep()).length, 1);
    assert.deepEqual(await manager.sweep(), []);
    assert.deepEqual(await manager.sweep(), []);
  });

  it('only takes the rooms that are due, not their neighbours', async () => {
    const manager = new RoomManager(new MemoryStore());
    const doomed = await makeRoom(manager, { idleMs: 5000, connected: false });
    const busy = await makeRoom(manager, { idleMs: 5000, connected: true });
    const playing = await makeRoom(manager, { status: 'PLAYING', idleMs: 1000, connected: true });

    const removed = await manager.sweep();

    assert.deepEqual(removed, [doomed.room.id]);
    assert.ok(manager.getRoom(busy.room.id));
    assert.ok(manager.getRoom(playing.room.id));
  });
});
