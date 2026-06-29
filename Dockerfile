# Single image used for three roles (app / poller / migrate) — the command is
# chosen per-service in docker-compose.prod.yml. devDependencies are kept on
# purpose: the poller runs via `tsx` and migrations via drizzle-orm's migrator.
FROM node:22-bookworm-slim

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Build the Angular browser + SSR server bundles.
COPY . .
RUN npm run build

# The SSR server listens on $PORT (default 4000 in src/server.ts).
EXPOSE 4000
CMD ["node", "dist/albumdashboard/server/server.mjs"]
