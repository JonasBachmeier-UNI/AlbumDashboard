import { syncOnce } from './sync';

/**
 * Always-on poller: re-syncs with Last.fm on a fixed interval so record
 * sessions stay current even when no browser is open. Runs as its own process
 * (decoupled from the SSR server) — start with:  npm run sync
 */
const INTERVAL_MS = 30_000;

let running = false;

async function tick() {
  if (running) {
    return; // skip if a previous run is still going (slow network / backfill)
  }
  running = true;
  try {
    const result = await syncOnce();
    const stamp = new Date().toISOString();
    if (result.ingested > 0) {
      console.log(
        `[${stamp}] +${result.ingested} scrobbles, ${result.sessions} sessions`,
      );
    } else {
      console.log(`[${stamp}] no new scrobbles`);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] sync failed:`, err);
  } finally {
    running = false;
  }
}

console.log(`Poller started — syncing every ${INTERVAL_MS / 1000}s. Ctrl+C to stop.`);
void tick();
setInterval(() => void tick(), INTERVAL_MS);
