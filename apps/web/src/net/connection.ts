import type { ClientMessage, ServerMessage } from '@bukharo/shared';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface ConnectionHandlers {
  onMessage(message: ServerMessage): void;
  onStatus(status: ConnectionStatus): void;
}

const STORAGE_KEY = 'bukharo.session';

export function loadSessionToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveSessionToken(token: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* private browsing — the session simply will not survive a refresh */
  }
}

export function clearSessionToken(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function socketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/**
 * A reconnecting WebSocket. Messages sent while offline are queued, and the
 * stored session token is replayed on every (re)connect so the server can put
 * the player back in their seat (§52).
 */
export class Connection {
  private ws: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private attempts = 0;
  private closedByUs = false;
  private retryTimer: number | null = null;

  constructor(private readonly handlers: ConnectionHandlers) {}

  connect(): void {
    this.closedByUs = false;
    this.handlers.onStatus(this.attempts === 0 ? 'connecting' : 'reconnecting');

    const ws = new WebSocket(socketUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.handlers.onStatus('open');
      const token = loadSessionToken();
      if (token) ws.send(JSON.stringify({ type: 'session:resume', sessionToken: token }));
      const pending = this.queue;
      this.queue = [];
      for (const message of pending) ws.send(JSON.stringify(message));
    };

    ws.onmessage = (event) => {
      try {
        this.handlers.onMessage(JSON.parse(String(event.data)) as ServerMessage);
      } catch {
        /* a malformed frame is not worth tearing the session down for */
      }
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.closedByUs) {
        this.handlers.onStatus('closed');
        return;
      }
      this.handlers.onStatus('reconnecting');
      this.attempts += 1;
      const delay = Math.min(500 * 2 ** (this.attempts - 1), 8000);
      this.retryTimer = window.setTimeout(() => this.connect(), delay);
    };

    ws.onerror = () => ws.close();
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return;
    }
    this.queue.push(message);
  }

  close(): void {
    this.closedByUs = true;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.ws?.close();
  }
}

/** §59 — every action carries an id so a retry cannot play the move twice. */
export function newActionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `a_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
