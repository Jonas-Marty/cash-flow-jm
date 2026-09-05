# Browser + bun toolbox for debugging this app.
#
# The host has neither a browser nor bun, so anything that needs to *see* the
# app (screenshots, console output, clicking through a flow) runs in here. The
# image also carries bun, so `bun install`, `bun run dev`, lint and the test
# suite work the same way they do in the build image.
#
# Built on demand by scripts/dev/tools.sh.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

# Must match the image tag: the base image ships exactly the browser revisions
# this version of Playwright expects.
ARG PW_VERSION=1.63.0
RUN npm install -g "playwright@${PW_VERSION}"

# Install bun somewhere every uid can reach — the wrapper runs as the caller's
# uid so files written into the mounted repo stay owned by the caller.
ENV BUN_INSTALL=/usr/local
RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://bun.sh/install | bash \
 && bun --version

# ESM ignores NODE_PATH, but it does walk parent directories looking for a
# node_modules, so this makes `import "playwright"` resolve from /work — whose
# own node_modules belongs to the app and knows nothing about Playwright.
RUN ln -s /usr/lib/node_modules /node_modules

ENV NODE_PATH=/usr/lib/node_modules \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /work
