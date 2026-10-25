# syntax=docker/dockerfile:1

ARG NODE_BASE_IMAGE
FROM ${NODE_BASE_IMAGE} AS build
WORKDIR /app
RUN npm install -g pnpm@12.3.4
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bot/package.json apps/bot/package.json
COPY apps/bot/scripts apps/bot/scripts
COPY apps/admin-ui/package.json apps/admin-ui/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM ${NODE_BASE_IMAGE} AS runtime
WORKDIR /app
RUN addgroup -S -g 10001 app && adduser -S -D -H -u 10001 -G app app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bot/package.json apps/bot/package.json
COPY apps/bot/scripts apps/bot/scripts
RUN npm install -g pnpm@12.3.4 \
 && pnpm install --prod --frozen-lockfile --filter bot \
 && npm uninstall -g pnpm
COPY deploy/Caddyfile deploy/Caddyfile
COPY postgres-init/10-roles.sh postgres-init/10-roles.sh
COPY --from=build --chown=10001:10001 /app/apps/bot/dist apps/bot/dist
COPY --from=build --chown=10001:10001 /app/apps/admin-ui/dist apps/admin-ui/dist
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENV NODE_ENV=production ADMIN_PORT=8420
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
EXPOSE 8420
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.ADMIN_PORT||8420)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
