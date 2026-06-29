import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

import {
  deleteRecord,
  getCurrentRecord,
  listRecords,
  setAlbumRating,
} from './server/records';
import { syncOnce } from './server/sync';
import type { SessionStatus } from './server/db/schema';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
// Behind the Caddy reverse proxy: allow our public host(s) (Angular's SSRF
// protection rejects unknown Host headers) and trust the X-Forwarded-* headers
// Caddy sets. ALLOWED_HOSTS is a comma-separated list.
const angularApp = new AngularNodeAppEngine({
  allowedHosts: (process.env['ALLOWED_HOSTS'] ?? 'localhost')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean),
  trustProxyHeaders: true,
});

app.use(express.json());

/**
 * REST API for the dashboard. These must be registered BEFORE the Angular
 * catch-all handler below, otherwise SSR would swallow them.
 */
const VALID_STATUS: readonly SessionStatus[] = ['in_progress', 'completed', 'abandoned'];

// All detected record sessions, newest first. Optional ?status= filter.
app.get('/api/records', async (req, res, next) => {
  try {
    const status = req.query['status'];
    const filter =
      typeof status === 'string' && (VALID_STATUS as readonly string[]).includes(status)
        ? (status as SessionStatus)
        : undefined;
    res.json(await listRecords(filter));
  } catch (err) {
    next(err);
  }
});

// The currently in-progress record (for the "resume" display), or null.
app.get('/api/records/current', async (_req, res, next) => {
  try {
    res.json(await getCurrentRecord());
  } catch (err) {
    next(err);
  }
});

// Soft-delete a record session (stays hidden across re-syncs).
app.delete('/api/records/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const ok = await deleteRecord(id);
    res.status(ok ? 204 : 404).end();
  } catch (err) {
    next(err);
  }
});

// Set or clear an album's 1–5 star rating. Body: { rating: 1..5 | null }.
app.put('/api/albums/:id/rating', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const raw = (req.body as { rating?: unknown })?.rating;
    const rating = raw === null || raw === 0 ? null : Number(raw);
    if (!Number.isInteger(id) || (rating !== null && (rating < 1 || rating > 5))) {
      res.status(400).json({ error: 'rating must be an integer 1–5, or null to clear' });
      return;
    }
    const ok = await setAlbumRating(id, rating);
    res.status(ok ? 204 : 404).end();
  } catch (err) {
    next(err);
  }
});

// Manually trigger a sync (handy for testing without waiting for the poller).
app.post('/api/sync', async (_req, res, next) => {
  try {
    res.json(await syncOnce());
  } catch (err) {
    next(err);
  }
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
