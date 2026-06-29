# Deploying AlbumDashboard

The app ships as one Docker image run in three roles via
[docker-compose.prod.yml](docker-compose.prod.yml):

| service   | role                                              |
| --------- | ------------------------------------------------- |
| `db`      | Postgres 17 (internal only — no published port)   |
| `migrate` | one-shot: creates/updates tables, then exits      |
| `app`     | SSR web app + REST API (no host port — behind Caddy) |
| `poller`  | always-on Last.fm sync                            |

A shared **Caddy** reverse proxy (in `deploy/proxy/`) owns ports 80/443 and routes
both `album.jonasbachmeier.de` (this app) and `jonasbachmeier.de` (the wedding app)
by hostname over a shared `web` Docker network, with automatic HTTPS.

`git push` to `main` triggers [.github/deploy.yml](.github/deploy.yml), which SSHes
in, pulls, rebuilds, and restarts the stack.

---

## What's already in the repo (done for you)
`Dockerfile`, `.dockerignore`, `docker-compose.prod.yml`, the prod npm scripts
(`poller`, `backfill`, `db:push`), the updated deploy workflow, and the
templates under `deploy/`.

## One-time setup

### 1. GitHub repository secrets
Actions secrets are **per-repo** — your other project's don't carry over. In this
repo: **Settings → Secrets and variables → Actions**, add:
- `SSH_HOST` — server IP/hostname
- `SSH_USER` — e.g. `bachi`
- `SSH_PRIVATE_KEY` — a key whose public half is in the server's `~/.ssh/authorized_keys`

(Reuse the same values as your other project, or promote them to **org-level**
secrets so both repos share them.)

### 2. On the server (once)
```bash
# Clone to the path the workflow expects:
git clone <this-repo-url> /home/bachi/albumtracker
cd /home/bachi/albumtracker

# Create the prod env file (gitignored) from the template, then edit it:
cp deploy/.env.prod.example .env
nano .env        # set a strong POSTGRES_PASSWORD + matching DATABASE_URL
```
Make sure Docker works without sudo for the deploy user:
`sudo usermod -aG docker $USER` then re-login (otherwise the workflow's
`docker compose` calls fail).

### 3. Shared Caddy reverse proxy (one-time, server-wide)
The wedding app currently binds 80/443 directly. We put a Caddy proxy in front of
**both** apps so each domain gets routed by hostname. DNS for both
`jonasbachmeier.de` and `album.jonasbachmeier.de` already points at the server.

```bash
# a) Shared network the proxy + both apps attach to:
docker network create web

# b) Stand up the proxy (files in this repo under deploy/proxy/):
mkdir -p /home/bachi/proxy
cp deploy/proxy/docker-compose.yml deploy/proxy/Caddyfile /home/bachi/proxy/
```

**c) Move the wedding app behind Caddy** — edit its `docker-compose.yml`:
- In the `app` service, **remove** the `- "80:4000"` and `- "443:443"` port lines
  (keep `4000:4000` only if you want direct access; not required). Its TLS/cert
  mounts can stay — they're just unused now.
- Attach it to the shared network with the alias Caddy expects:
  ```yaml
      networks:
        default: {}
        web:
          aliases: [hochzeit]
  ```
- Add at the bottom of that compose file:
  ```yaml
  networks:
    web:
      external: true
  ```
Then bring the proxy + wedding app up:
```bash
cd /home/bachi/<wedding-dir> && docker compose up -d   # now without 80/443
cd /home/bachi/proxy        && docker compose up -d     # Caddy grabs 80/443, gets certs
```
Caddy auto-provisions Let's Encrypt certs for all four hostnames. Verify:
`curl -I https://jonasbachmeier.de` and (after the album app is up)
`curl -I https://album.jonasbachmeier.de`.

> ⚠️ Brief wedding-site downtime (~1 min) during the switch, while ports move from
> the Phoenix container to Caddy and the first certs are issued.

## Deploy
```bash
git push origin main      # → GitHub Action builds & restarts the stack
```
Or manually on the server:
```bash
cd /home/bachi/albumtracker && git pull --ff-only
docker compose -f docker-compose.prod.yml up -d --build
```

## First run / operations
```bash
C="docker compose -f docker-compose.prod.yml"

$C ps                                   # status
$C logs -f app                          # web/API logs
$C logs -f poller                       # sync logs
$C run --rm app npm run backfill        # one-time: import full Last.fm history
$C exec db psql -U album -d albumdashboard -c '\dt'   # inspect the DB
```

## Notes
- **Why no published DB port:** the app reaches Postgres over the compose network
  as `db:5432`, so nothing collides with your other project or a system Postgres.
- **Schema changes:** `migrate` runs `drizzle-kit push --force`. Additive changes
  (new tables/columns) apply cleanly; a change that drops/retypes a column with
  data may need a hand-written migration — check `migrate` logs after deploy.
- **The Last.fm API key** is intentionally in `environment.prod.ts` (client-side
  now-playing). The poller/API read credentials from the server `.env`.
