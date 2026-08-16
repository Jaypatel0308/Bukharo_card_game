import path from 'node:path';

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: num('PORT', 8787),
  host: process.env.HOST ?? '0.0.0.0',
  /** Active game state lives here so a restart does not destroy games (§61). */
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data')),
  /** Built web client, served by the same process in production. */
  webDir: path.resolve(process.env.WEB_DIR ?? path.join(process.cwd(), 'apps/web/dist')),

  /** §54 — how long the table waits for a disconnected player before the host may act. */
  disconnectGraceMs: num('DISCONNECT_GRACE_MS', 90_000),
  /** §65 — room expiry. */
  lobbyTtlMs: num('LOBBY_TTL_MS', 30 * 60_000),
  finishedTtlMs: num('FINISHED_TTL_MS', 24 * 60 * 60_000),
  abandonedTtlMs: num('ABANDONED_TTL_MS', 6 * 60 * 60_000),
  sweepIntervalMs: num('SWEEP_INTERVAL_MS', 60_000),

  /** §59 — how long processed action ids are remembered for deduplication. */
  actionIdTtlMs: num('ACTION_ID_TTL_MS', 5 * 60_000),
  /** Crude per-connection flood protection. */
  maxMessagesPerSecond: num('MAX_MESSAGES_PER_SECOND', 25),
  maxMessageBytes: num('MAX_MESSAGE_BYTES', 64 * 1024),
};

export type Config = typeof config;
