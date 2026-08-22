/**
 * Proves the deployed site actually works, rather than that the code compiles.
 *
 * CI already runs the whole suite against a server it starts itself. That says
 * nothing about the thing players connect to: a failed build, a stale bundle,
 * a missing env var and a spun-down instance all look identical from here
 * until somebody tries to play. This connects to the real URL and plays the
 * first few seconds of a game.
 *
 *   node scripts/smoke.mjs https://example.onrender.com [expected-commit]
 *
 * Given a commit it waits for that build to be the one answering, so a pass
 * cannot come from the previous deploy still serving while Render swaps over.
 */
import { WebSocket } from 'ws';

const target = process.argv[2];
const expectedCommit = process.argv[3] ?? '';

if (!target) {
  console.error('usage: node scripts/smoke.mjs <url> [expected-commit]');
  process.exit(2);
}

const base = target.replace(/\/$/, '');
const wsBase = base.replace(/^http/, 'ws');

const steps = [];
let failed = false;

async function step(name, run) {
  const started = Date.now();
  try {
    const detail = await run();
    steps.push(`  ok   ${name}${detail ? ` — ${detail}` : ''} (${Date.now() - started}ms)`);
  } catch (error) {
    failed = true;
    steps.push(`  FAIL ${name} — ${error.message} (${Date.now() - started}ms)`);
    throw error;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A free instance spins down when idle and takes the best part of a minute to
 * wake, so the first call waits rather than calling a cold start an outage.
 */
async function waitForHealth() {
  const deadline = Date.now() + 180_000;
  let last = 'no response';
  let woke = false;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(20_000) });
      const body = await response.json();
      if (response.ok && body.ok) {
        if (!expectedCommit || body.commit === expectedCommit || body.commit === 'unknown') {
          const age = body.uptime < 90 ? ' (just started)' : '';
          return `commit ${String(body.commit).slice(0, 7)}${age}${woke ? ', after a cold start' : ''}`;
        }
        last = `still serving ${String(body.commit).slice(0, 7)}, waiting for ${expectedCommit.slice(0, 7)}`;
      } else {
        last = `HTTP ${response.status}`;
      }
    } catch (error) {
      last = error.message;
      woke = true;
    }
    await sleep(5000);
  }
  throw new Error(`never became healthy: ${last}`);
}

function openSocket() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsBase}/ws`);
    const timer = setTimeout(() => reject(new Error('websocket did not open')), 30_000);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForMessage(socket, predicate, what, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`timed out waiting for ${what}`));
    }, timeoutMs);

    function onMessage(raw) {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.type === 'error') {
        clearTimeout(timer);
        socket.off('message', onMessage);
        reject(new Error(`server refused: ${message.error?.code ?? 'unknown'}`));
        return;
      }
      if (predicate(message)) {
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(message);
      }
    }

    socket.on('message', onMessage);
  });
}

/** Creates a room of the given game and checks the lobby comes back right. */
async function hostsAGame(gameId, target) {
  const socket = await openSocket();
  try {
    const session = waitForMessage(socket, (m) => m.type === 'session', 'a session');
    socket.send(
      JSON.stringify({
        type: 'room:create',
        actionId: `smoke-${gameId}-${Date.now()}`,
        displayName: 'Smoke Test',
        target,
        gameId,
      }),
    );
    const { roomCode } = await session;
    if (!roomCode) throw new Error('no room code came back');

    const state = await waitForMessage(socket, (m) => m.type === 'room:state', 'the lobby');
    if (state.room.gameId !== gameId) {
      throw new Error(`asked for ${gameId} and got ${state.room.gameId}`);
    }
    if (state.room.players.length !== 1) {
      throw new Error(`expected one player, saw ${state.room.players.length}`);
    }
    return `room ${roomCode}`;
  } finally {
    socket.close();
  }
}

console.log(`Smoke test against ${base}`);
if (expectedCommit) console.log(`Expecting commit ${expectedCommit.slice(0, 7)}`);

try {
  await step('the server answers /health', waitForHealth);

  await step('the page loads', async () => {
    const response = await fetch(base, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    if (!/<div id="root">|<script/.test(html)) throw new Error('no app markup in the response');
    return `${html.length} bytes`;
  });

  await step('the client bundle is served', async () => {
    const html = await (await fetch(base, { signal: AbortSignal.timeout(30_000) })).text();
    const match = html.match(/src="([^"]+\.js)"/);
    if (!match) throw new Error('no script tag in the page');
    const asset = new URL(match[1], base).toString();
    const response = await fetch(asset, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`bundle returned HTTP ${response.status}`);
    return match[1];
  });

  await step('a Bukharo room can be opened', () => hostsAGame('bukharo', 2000));
  await step('a Mindi room can be opened', () => hostsAGame('mindi', 3));

  await step('an unknown game is refused', async () => {
    const socket = await openSocket();
    try {
      const refused = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no refusal came back')), 20_000);
        socket.on('message', (raw) => {
          const message = JSON.parse(raw.toString());
          if (message.type === 'error') {
            clearTimeout(timer);
            resolve(message.error.code);
          }
        });
      });
      socket.send(
        JSON.stringify({
          type: 'room:create',
          actionId: 'smoke-bogus',
          displayName: 'Smoke Test',
          target: 2000,
          gameId: 'definitely-not-a-game',
        }),
      );
      return `refused with ${await refused}`;
    } finally {
      socket.close();
    }
  });
} catch {
  /* recorded in steps */
}

console.log(steps.join('\n'));
console.log(failed ? '\nSmoke test FAILED.' : '\nSmoke test passed.');
process.exit(failed ? 1 : 0);
