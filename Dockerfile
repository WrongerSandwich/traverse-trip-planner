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

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3456

COPY --from=builder  /app/build         ./build
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./

EXPOSE 3456
USER node
CMD ["node", "build/index.js"]
