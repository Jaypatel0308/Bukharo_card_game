import { defineConfig } from '@playwright/test';
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
  workers: 1,
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
