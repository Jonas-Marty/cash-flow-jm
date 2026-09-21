# syntax=docker/dockerfile:1.7
#
# Static docs site. Blume compiles to plain HTML/CSS/JS plus a local search
# index, so there is no runtime to keep alive — nginx serves the folder.
#
# The build runs on node, not bun like the app image: blume pulls ~1000
# packages through npm and the local verification of this site was done with
# node, so the image builds the same way the build was proven. node 24 also
# satisfies write-file-atomic's engine range, which 24.14 does not.

# ---------- 1. build ----------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY blume.config.ts ./
COPY docs ./docs
COPY public ./public

RUN npx blume build

# ---------- 2. runtime ----------
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
