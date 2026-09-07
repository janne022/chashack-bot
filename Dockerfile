# syntax=docker/dockerfile:1

# ── build stage: full workspace, dev deps, compile bot + admin UI ──────────
FROM node:24-alpine AS build
WORKDIR /app

# Exact-pinned pnpm (no corepack signature drama); pnpm itself then enforces
# the minimumReleaseAge supply-chain gate from pnpm-workspace.yaml.
RUN npm install -g pnpm@12.3.4

# Dependency layers first for cache hits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bot/package.json apps/bot/package.json
COPY apps/bot/scripts apps/bot/scripts
COPY apps/admin-ui/package.json apps/admin-ui/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ── runtime stage: bot prod deps + compiled output only ────────────────────
FROM node:24-alpine
WORKDIR /app

RUN npm install -g pnpm@12.3.4

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bot/package.json apps/bot/package.json
# postinstall guard needs its script present before install
COPY apps/bot/scripts apps/bot/scripts
RUN pnpm install --prod --frozen-lockfile --filter bot

COPY --from=build /app/apps/bot/dist apps/bot/dist
COPY --from=build /app/apps/admin-ui/dist apps/admin-ui/dist
COPY --from=build /app/apps/bot/scripts apps/bot/scripts

# SQLite lives on a volume; env defaults suit the container layout.
ENV NODE_ENV=production \
    DB_PATH=/data/chashack.db
RUN mkdir -p /data && chown node:node /data
VOLUME /data

# /app stays root-owned read-only for the process; bot runs unprivileged.
USER node
EXPOSE 8420

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.ADMIN_PORT||8420)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/bot/dist/index.js"]
