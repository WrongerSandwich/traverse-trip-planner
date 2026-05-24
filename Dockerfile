# syntax=docker/dockerfile:1.7

# ── Builder: install all deps and run the SvelteKit build ──────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Production-only deps (separate stage so dev deps stay out of runtime) ──
FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Runtime: small Alpine image with just build/, node_modules/, manifests ─
FROM node:20-alpine AS runtime
WORKDIR /app

# tini: lightweight init that reaps zombies and forwards signals when running
# outside Docker Compose (k8s, plain `docker run`).  Compose users also get
# `init: true` in docker-compose.yml, but having tini in the image means the
# image is self-contained regardless of the orchestrator.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3456

COPY --from=builder  /app/build         ./build
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./

# WORKDIR creates /app as root. Atomic cache writes (.geocode-cache.json,
# .image-cache.json, .route-cache.json, .workflow-stats.json) need to
# create a `.tmp` sibling before renaming into place, which requires write
# permission on the parent directory. Without this chown the .tmp create
# fails with EACCES and the caches silently never persist across restarts.
RUN chown node:node /app

EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3456/ || exit 1

USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "build/index.js"]
