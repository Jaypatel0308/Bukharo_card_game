/**
 * Is anybody playing right now?
 *
 * Merging to main deploys, and this deployment has no persistent disk, so a
 * deploy ends every match in progress. That is a fine trade for a game among
 * friends — as long as nobody does it while the friends are playing.
 *
 *   node scripts/deploy-check.mjs https://example.onrender.com
 *
 * Exits 0 when the table is clear, 1 when it is not, and 0 with a warning when
 * the site cannot be reached at all. The last case is deliberate: not knowing
 * is not the same as knowing a game is running, and a spun-down free instance
 * has nobody on it by definition.
 */
const target = process.argv[2] ?? process.env.DEPLOY_URL;

if (!target) {
  console.error('usage: node scripts/deploy-check.mjs <url>');
  process.exit(2);
}

const base = target.replace(/\/$/, '');

try {
  const response = await fetch(`${base}/health`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    console.warn(`${base} answered ${response.status}; assuming nobody is playing.`);
    process.exit(0);
  }

  const health = await response.json();
  const rooms = health.activeRooms ?? 0;
  const players = health.playersConnected ?? 0;

  if (rooms === 0) {
    console.log(`No games in progress on ${base}. Safe to deploy.`);
    process.exit(0);
  }

  console.error(
    `${rooms} game${rooms === 1 ? '' : 's'} in progress with ${players} player${
      players === 1 ? '' : 's'
    } connected.`,
  );
  console.error('Deploying now would end them, and they cannot be restored.');
  process.exit(1);
} catch (error) {
  console.warn(`Could not reach ${base} (${error.message}); assuming nobody is playing.`);
  process.exit(0);
}
