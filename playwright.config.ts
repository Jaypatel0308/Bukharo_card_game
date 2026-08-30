import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.E2E_PORT ?? 4321);
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * End-to-end tests in a real browser.
 *
 * These exist because every bug that reached a player was in the client and
 * invisible to the other suites: a hand that did not rearrange, a button that
 * changed meaning under a finger, a name box that could not be typed into.
 * jsdom cannot see any of that, so this drives the built client against the
 * real server, four browser contexts at a time.
 */
export default defineConfig({
  testDir: './e2e',
  // Four players in one browser is enough concurrency; running whole files in
  // parallel against one server invites flakiness rather than finding bugs.
  /**
   * Two workers, not one.
   *
   * Every test opens four browser contexts, and a single worker ran all ~50
   * of them through one long-lived browser. Roughly one run in four then
   * stalled — a different test each time, for minutes rather than the 60s
   * test timeout, which places the hang in setup or teardown rather than in
   * the test itself. Split across two workers it has not stalled once, and
   * the suite is a third faster.
   *
   * Parallelism is safe here: every test creates its own room with its own
   * code, and the server keeps rooms apart.
   */
  workers: 2,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list']] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      // A small modern Android: narrower than most phones in use, so anything
      // that fits here fits the rest. Touch rather than mouse, which is how
      // the game is actually played.
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'node apps/server/dist/index.js',
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      DATA_DIR: path.join(os.tmpdir(), `bukharo-e2e-${process.pid}`),
      WEB_DIR: path.resolve('apps/web/dist'),
      SWEEP_INTERVAL_MS: '600000',
    },
  },
});
