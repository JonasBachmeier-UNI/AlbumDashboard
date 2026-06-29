# Deploying AlbumDashboard

The app ships as one Docker image run in three roles via
[docker-compose.prod.yml](docker-compose.prod.yml):

| service   | role                                              |
| --------- | ------------------------------------------------- |
| `db`      | Postgres 17 (internal only — no published port)   |
| `migrate` | one-shot: creates/updates tables, then exits      |
| `app`     | SSR web app + REST API, published on `APP_PORT`   |
| `poller`  | always-on Last.fm sync                            |

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
nano .env        # set a strong POSTGRES_PASSWORD + matching DATABASE_URL; pick APP_PORT
```
Make sure Docker works without sudo for the deploy user:
`sudo usermod -aG docker $USER` then re-login (otherwise the workflow's
`docker compose` calls fail).

### 3. Reverse proxy (subdomain)
Point a DNS **A record** for `albums.yourdomain.com` at the server, then route it
to `APP_PORT`. If you're not sure what proxy is running, check:
```bash
sudo ss -tlnp | grep -E ':(80|443)\b'    # nginx? caddy? traefik?
docker ps                                 # a traefik/caddy container?
```
- **nginx**: use [deploy/nginx-albums.conf.example](deploy/nginx-albums.conf.example) (instructions inside), then `certbot` for TLS.
- **Caddy**: add to the Caddyfile — TLS is automatic:
  ```
  albums.yourdomain.com {
      reverse_proxy 127.0.0.1:4101
  }
  ```
- **Traefik**: add router/service labels to the `app` service pointing at port 4000.

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
