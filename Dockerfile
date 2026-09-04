# syntax=docker/dockerfile:1.7

# Installs and the build run on bun, which is what the committed lockfile
# belongs to. npm 10 (the one bundled with node 22) crashes resolving this
# dependency graph with "Cannot read properties of null (reading 'edgesOut')"
# — an arborist bug fixed in npm 12 — and its package-lock.json had drifted
# from package.json anyway. One runtime for install, build and tests means a
# green local run says the same thing as a green image build.
#
# The server itself still runs under node: dist/server is a plain node bundle
# and the runtime stage is where an unproven runtime would actually hurt.

# ---------- 1. deps ----------
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock* bun.lockb* ./
RUN bun install --frozen-lockfile

# ---------- 2. production deps (runtime image) ----------
FROM oven/bun:1-alpine AS prod-deps
WORKDIR /app
COPY package.json bun.lock* bun.lockb* ./
RUN bun install --frozen-lockfile --production

# ---------- 3. build ----------
FROM oven/bun:1-alpine AS build
WORKDIR /app
ENV NODE_ENV=production
# git so the version stamp below can name the commit that was checked out.
RUN apk add --no-cache libc6-compat git
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Environment variables needed at build time for the Vite client bundle
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

# Version stamp: semver from package.json unless APP_VERSION is passed, plus
# the git commit hash and build timestamp. The commit is what answers "is the
# running container the code I pushed?", so it is worth the git in this stage:
# a deploy platform that clones the repo gets it for free, and an explicit
# APP_COMMIT build arg still wins.
ARG APP_VERSION
ARG APP_COMMIT
ARG APP_BUILD_TIME
RUN APP_VERSION="${APP_VERSION:-$(bun -e "console.log(require('./package.json').version)")}" \
 && APP_COMMIT="${APP_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo '')}" \
 && APP_BUILD_TIME="${APP_BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}" \
 && printf 'VITE_APP_VERSION=%s\nVITE_APP_COMMIT=%s\nVITE_APP_BUILD_TIME=%s\n' \
      "$APP_VERSION" "$APP_COMMIT" "$APP_BUILD_TIME" > .env.build \
 && cat .env.build

# Build SSR + client assets targeting Node
RUN set -a && . ./.env.build && set +a \
 && APP_VERSION="$VITE_APP_VERSION" APP_COMMIT="$VITE_APP_COMMIT" APP_BUILD_TIME="$VITE_APP_BUILD_TIME" \
    bunx vite build --config vite.config.node.ts

# ---------- 4. runtime ----------
FROM node:22-alpine AS runtime

# Create user and group first
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app
# Ensure working directory is owned by the app user
RUN chown app:app /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    PUBLIC_DIR=/app/dist/client \
    SERVER_ENTRY=/app/dist/server/server.js \
    LOG_SERVICE_NAME=cash-flow

USER app

COPY --chown=app:app package.json ./
COPY --chown=app:app --from=prod-deps /app/node_modules ./node_modules

# Copy build artifacts with correct ownership
COPY --chown=app:app --from=build /app/dist ./dist
COPY --chown=app:app --from=build /app/.env.build ./.env.build
COPY --chown=app:app server/node-server.mjs ./server/node-server.mjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/" >/dev/null 2>&1 || exit 1

CMD ["node", "server/node-server.mjs"]
