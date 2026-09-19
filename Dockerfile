# syntax=docker/dockerfile:1

# ── build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

# Manifests first, so a code change does not re-resolve the dependency tree.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @brancher/web build

# Drop the web toolchain; the server runs from source through tsx.
RUN pnpm install --frozen-lockfile --filter @brancher/server --prod=false

# ── run ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# git is the whole point: the status board reads real clones.
# openssh-client lets a deploy key be used instead of a token.
RUN apk add --no-cache git openssh-client tini \
    && git config --system --add safe.directory '*'

ENV NODE_ENV=production \
    BRANCHER_HOST=0.0.0.0 \
    BRANCHER_PORT=4317 \
    BRANCHER_DATA_DIR=/data \
    BRANCHER_REPOS_DIR=/repos \
    BRANCHER_WEB_DIR=/app/web/dist

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/package.json ./

RUN mkdir -p /data /repos

EXPOSE 4317
VOLUME ["/data", "/repos"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4317/api/health >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
# tsx, because the sources use extensionless imports that plain node will not resolve.
CMD ["./server/node_modules/.bin/tsx", "server/src/index.ts"]
