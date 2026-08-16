import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerError, ServerMessage } from '@bukharo/shared';

import { config } from './config.js';
import { RoomManager, roomView, type OpResult } from './rooms.js';

interface Connection {
  ws: WebSocket;
  roomId: string | null;
  playerId: string | null;
  /** Token bucket for flood protection. */
  tokens: number;
  lastRefill: number;
  alive: boolean;
}

const manager = await RoomManager.create();
const connections = new Map<WebSocket, Connection>();

/* ------------------------------------------------------------------ */
/* HTTP: health, invite links and the built web client                 */
/* ------------------------------------------------------------------ */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
    return;
  }

  const requested = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.resolve(config.webDir, `.${path.sep}${requested}`);
  if (filePath !== config.webDir && !filePath.startsWith(config.webDir + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let stat = await fsp.stat(filePath).catch(() => null);
  if (stat?.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    stat = await fsp.stat(filePath).catch(() => null);
  }
  if (!stat) {
    // SPA fallback so /join/BKH7Q resolves to the client (§64).
    filePath = path.join(config.webDir, 'index.html');
    stat = await fsp.stat(filePath).catch(() => null);
  }
  if (!stat) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Bukharo server is running, but the web client has not been built yet.');
    return;
  }

  const ext = path.extname(filePath);
  const immutable = requested.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  serveStatic(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end('Internal error');
  });
});

/* ------------------------------------------------------------------ */
/* WebSocket plumbing                                                  */
/* ------------------------------------------------------------------ */

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: config.maxMessageBytes });

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function sendError(ws: WebSocket, error: ServerError): void {
  send(ws, { type: 'error', error });
}

function connectionsInRoom(roomId: string): Connection[] {
  return [...connections.values()].filter((c) => c.roomId === roomId);
}

/** Each player gets their own redacted snapshot — never one shared payload. */
function broadcastRoom(roomId: string): void {
  const room = manager.getRoom(roomId);
  if (!room) return;
  for (const connection of connectionsInRoom(roomId)) {
    send(connection.ws, { type: 'room:state', room: roomView(room, connection.playerId) });
  }
}

function broadcastEvents(
  roomId: string,
  events: Array<{ type: string; privateToPlayerId?: string; payload: Record<string, unknown> }>,
): void {
  for (const event of events) {
    for (const connection of connectionsInRoom(roomId)) {
      if (event.privateToPlayerId && event.privateToPlayerId !== connection.playerId) continue;
      send(connection.ws, { type: 'game:event', event: { type: event.type, payload: event.payload } });
    }
  }
}

function attach(connection: Connection, roomId: string, playerId: string, token?: string): void {
  connection.roomId = roomId;
  connection.playerId = playerId;
  const room = manager.getRoom(roomId);
  if (token && room) {
    send(connection.ws, { type: 'session', sessionToken: token, playerId, roomCode: room.code });
  }
}

function handleResult<T>(ws: WebSocket, result: OpResult<T>, actionId?: string): T | null {
  if (result.ok) return result.value;
  sendError(ws, actionId ? { ...result.error, actionId } : result.error);
  return null;
}

function rateLimited(connection: Connection): boolean {
  const now = Date.now();
  const elapsed = (now - connection.lastRefill) / 1000;
  connection.lastRefill = now;
  connection.tokens = Math.min(
    config.maxMessagesPerSecond,
    connection.tokens + elapsed * config.maxMessagesPerSecond,
  );
  if (connection.tokens < 1) return true;
  connection.tokens -= 1;
  return false;
}

function parseMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as { type?: unknown }).type !== 'string') {
      return null;
    }
    return parsed as ClientMessage;
  } catch {
    return null;
  }
}

async function handleMessage(connection: Connection, message: ClientMessage): Promise<void> {
  const { ws } = connection;

  switch (message.type) {
    case 'ping':
      send(ws, { type: 'pong' });
      return;

    case 'room:create': {
      const result = await manager.createRoom(message.displayName, message.targetScore);
      const value = handleResult(ws, result, message.actionId);
      if (!value) return;
      attach(connection, value.room.id, value.playerId, value.sessionToken);
      broadcastRoom(value.room.id);
      return;
    }

    case 'room:join': {
      const result = await manager.joinRoom(message.roomCode, message.displayName);
      const value = handleResult(ws, result, message.actionId);
      if (!value) return;
      attach(connection, value.room.id, value.playerId, value.sessionToken);
      broadcastRoom(value.room.id);
      return;
    }

    case 'session:resume': {
      // §53 — the token alone identifies the seat; a player id is never enough.
      const session = manager.resolveSession(message.sessionToken ?? '');
      if (!session) {
        sendError(ws, { code: 'SESSION_INVALID', message: 'That session has expired. Join the room again.' });
        return;
      }
      // Close any older socket for the same seat so a refresh does not leave ghosts.
      for (const other of connectionsInRoom(session.roomId)) {
        if (other.playerId === session.playerId && other.ws !== ws) other.ws.close(4000, 'replaced');
      }
      attach(connection, session.roomId, session.playerId);
      await manager.markConnected(session.roomId, session.playerId);
      const room = manager.getRoom(session.roomId);
      if (room) {
        send(ws, { type: 'session', sessionToken: message.sessionToken, playerId: session.playerId, roomCode: room.code });
      }
      broadcastRoom(session.roomId);
      return;
    }

    default:
      break;
  }

  // Everything below needs a seat in a room.
  const { roomId, playerId } = connection;
  if (!roomId || !playerId) {
    sendError(ws, { code: 'NOT_IN_ROOM', message: 'Join a room first.' });
    return;
  }

  switch (message.type) {
    case 'player:ready': {
      const result = await manager.setReady(roomId, playerId, Boolean(message.ready));
      if (handleResult(ws, result)) broadcastRoom(roomId);
      return;
    }
    case 'seat:choose': {
      const result = await manager.chooseSeat(roomId, playerId, message.seat);
      if (handleResult(ws, result)) broadcastRoom(roomId);
      return;
    }
    case 'host:assignSeat': {
      const result = await manager.assignSeat(roomId, playerId, message.playerId, message.seat);
      if (handleResult(ws, result)) broadcastRoom(roomId);
      return;
    }
    case 'host:kick': {
      const target = message.playerId;
      const result = await manager.kickPlayer(roomId, playerId, target);
      if (!handleResult(ws, result)) return;
      for (const other of connectionsInRoom(roomId)) {
        if (other.playerId === target) {
          send(other.ws, { type: 'left' });
          other.roomId = null;
          other.playerId = null;
        }
      }
      broadcastRoom(roomId);
      return;
    }
    case 'host:settings': {
      const result = await manager.updateSettings(roomId, playerId, message.targetScore);
      if (handleResult(ws, result)) broadcastRoom(roomId);
      return;
    }
    case 'game:start': {
      const result = await manager.startGame(roomId, playerId, message.actionId);
      if (handleResult(ws, result, message.actionId)) broadcastRoom(roomId);
      return;
    }
    case 'game:action': {
      const result = await manager.gameAction(roomId, playerId, message.actionId, message.action);
      const value = handleResult(ws, result, message.actionId);
      if (!value) return;
      broadcastRoom(roomId);
      broadcastEvents(roomId, value.events);
      return;
    }
    case 'round:next': {
      const result = await manager.nextRound(roomId, playerId, message.actionId);
      if (handleResult(ws, result, message.actionId)) broadcastRoom(roomId);
      return;
    }
    case 'match:restart': {
      const result = await manager.restartMatch(roomId, playerId, message.actionId);
      if (handleResult(ws, result, message.actionId)) broadcastRoom(roomId);
      return;
    }
    case 'room:leave': {
      await manager.leaveRoom(roomId, playerId);
      send(ws, { type: 'left' });
      connection.roomId = null;
      connection.playerId = null;
      broadcastRoom(roomId);
      return;
    }
    default:
      sendError(ws, { code: 'INVALID_MESSAGE', message: 'Unknown message type.' });
  }
}

wss.on('connection', (ws) => {
  const connection: Connection = {
    ws,
    roomId: null,
    playerId: null,
    tokens: config.maxMessagesPerSecond,
    lastRefill: Date.now(),
    alive: true,
  };
  connections.set(ws, connection);

  ws.on('pong', () => {
    connection.alive = true;
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    if (rateLimited(connection)) {
      sendError(ws, { code: 'RATE_LIMITED', message: 'Slow down a moment.' });
      return;
    }
    const message = parseMessage(data.toString());
    if (!message) {
      sendError(ws, { code: 'INVALID_MESSAGE', message: 'That message could not be read.' });
      return;
    }
    handleMessage(connection, message).catch((error: unknown) => {
      console.error('[bukharo] message failed', message.type, error);
      sendError(ws, { code: 'INTERNAL', message: 'Something went wrong handling that action.' });
    });
  });

  ws.on('close', () => {
    connections.delete(ws);
    const { roomId, playerId } = connection;
    if (!roomId || !playerId) return;
    // Only mark away when no other socket holds the seat (refresh races).
    const stillHere = connectionsInRoom(roomId).some((c) => c.playerId === playerId);
    if (stillHere) return;
    void manager.markDisconnected(roomId, playerId).then(() => broadcastRoom(roomId));
  });
});

/** Drops sockets that stopped answering, so presence stays accurate. */
const heartbeat = setInterval(() => {
  for (const connection of connections.values()) {
    if (!connection.alive) {
      connection.ws.terminate();
      continue;
    }
    connection.alive = false;
    connection.ws.ping();
  }
}, 30_000);

const sweeper = setInterval(() => {
  void manager.sweep().then((removed) => {
    for (const roomId of removed) {
      for (const connection of connectionsInRoom(roomId)) {
        send(connection.ws, { type: 'left' });
        connection.roomId = null;
        connection.playerId = null;
      }
    }
  });
}, config.sweepIntervalMs);

server.listen(config.port, config.host, () => {
  // Report the port actually bound, not the one requested: PORT=0 asks the OS
  // for any free port, which is how the tests avoid fighting over a fixed one.
  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : config.port;
  console.log(`[bukharo] listening on http://${config.host}:${boundPort}`);
  console.log(`[bukharo] game state directory: ${config.dataDir}`);
});

function shutdown(): void {
  clearInterval(heartbeat);
  clearInterval(sweeper);
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
