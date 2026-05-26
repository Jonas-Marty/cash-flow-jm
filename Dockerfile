# syntax=docker/dockerfile:1.7

# ---------- 1. deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* bun.lockb* ./
RUN npm install

# ---------- 2. build ----------
FROM node:22-alpine AS build
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Environment variables needed at build time for the Vite client bundle
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

# Build SSR + client assets targeting Node
RUN npx vite build --config vite.config.ts.node

# ---------- 3. runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    PUBLIC_DIR=/app/.output/public \
    SERVER_ENTRY=/app/.output/server/index.mjs \
    LOG_SERVICE_NAME=cash-flow

COPY package.json package-lock.json* ./
RUN npm install --omit=dev \
    && npm cache clean --force

COPY --from=build /app/.output ./.output
COPY server/node-server.mjs ./server/node-server.mjs

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/" >/dev/null 2>&1 || exit 1

CMD ["node", "server/node-server.mjs"]
