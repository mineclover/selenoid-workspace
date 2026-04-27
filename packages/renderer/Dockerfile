# Force linux/amd64: chrome-headless-shell is x86_64.
# On Apple Silicon this runs via Rosetta2.
# BeginFrame CDP (flicker-free capture) requires linux/amd64 headless-shell.

# Stage 1: build custom renderer server that uses @hyperframes/engine directly
FROM --platform=linux/amd64 node:22-bookworm AS builder

WORKDIR /build

# Copy source packages (engine and core needed by esbuild path aliases)
COPY packages/hyperframes/packages/core   ./core
COPY packages/hyperframes/packages/engine ./engine
COPY packages/hyperframes/packages/producer ./producer

# Copy custom renderer source (ARG busts cache when source changes)
ARG CACHE_BUST
COPY packages/renderer/src ./renderer-src

WORKDIR /build/producer

# Remove workspace:^ deps — esbuild resolves them via path aliases.
RUN node -e " \
  const fs = require('fs'); \
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); \
  ['@hyperframes/core','@hyperframes/engine'].forEach(k => { \
    delete pkg.dependencies[k]; \
    delete (pkg.devDependencies || {})[k]; \
  }); \
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2)); \
"

ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm install && npm install @chenglou/pretext tsx

# Symlink node_modules into engine/core for esbuild resolution
RUN ln -s /build/producer/node_modules /build/engine/node_modules && \
    ln -s /build/producer/node_modules /build/core/node_modules

# Create stub for unused core export (runtime-inline)
RUN mkdir -p /build/core/src/generated && \
    printf 'export function getHyperframeRuntimeScript(): string { return ""; }\n' \
      > /build/core/src/generated/runtime-inline.ts

# Bundle the custom renderer server using esbuild (async API required for plugins)
RUN node --input-type=module << 'EOFJS'
import { build } from 'esbuild';
import { resolve } from 'path';
import { mkdirSync } from 'fs';
const scriptDir = '/build/producer';
const alias = {
  name: 'workspace-alias',
  setup(b) {
    b.onResolve({ filter: /^@hyperframes\/engine$/ }, () => ({ path: resolve(scriptDir, '../engine/src/index.ts') }));
    b.onResolve({ filter: /^@hyperframes\/core$/ },   () => ({ path: resolve(scriptDir, '../core/src/index.ts') }));
  },
};
mkdirSync('/build/renderer-dist', { recursive: true });
await build({
  bundle: true, platform: 'node', target: 'node22', format: 'esm',
  external: ['puppeteer', 'puppeteer-core', 'esbuild', 'sharp'],
  plugins: [alias],
  entryPoints: ['/build/renderer-src/server.ts'],
  outfile: '/build/renderer-dist/server.js',
});
console.log('[Build] server.js done');
EOFJS

# ────────────────────────────────────────────────────────────────────────────
# Stage 2: minimal runtime
FROM --platform=linux/amd64 node:22-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    webp \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libxshmfence1 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libxext6 \
    libxfixes3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /build/renderer-dist/server.js ./server.js

# Install runtime externals: puppeteer (browser automation), esbuild (htmlBundler)
RUN npm init -y && \
    node -e "var p=JSON.parse(require('fs').readFileSync('package.json'));p.type='module';require('fs').writeFileSync('package.json',JSON.stringify(p,null,2));" && \
    PUPPETEER_SKIP_DOWNLOAD=true npm install puppeteer puppeteer-core esbuild sharp && \
    npx puppeteer browsers install chrome-headless-shell

RUN mkdir -p /renders
VOLUME ["/renders"]

EXPOSE 9847
ENV PORT=9847
ENV RENDERS_DIR=/renders

CMD ["node", "server.js"]
