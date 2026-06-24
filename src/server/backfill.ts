import { pool } from './db/client';
import { syncOnce } from './sync';

/**
 * One-time history backfill. Because `syncOnce` fetches everything after the
 * stored cursor (and there's none on a fresh DB), this reconstructs all past
 * record sessions from your entire Last.fm history.
 *
 * Run with:  npm run sync:history
 */
async function main() {
  console.log('Backfilling Last.fm history… (this can take a while)');
  const result = await syncOnce();
  console.log(
    `Done. Ingested ${result.ingested} scrobbles ` +
      `(${result.totalScrobbles} total), detected ${result.sessions} record sessions.`,
  );
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
