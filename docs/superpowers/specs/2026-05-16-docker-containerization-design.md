# Docker containerization — design spec

**Ticket:** [#126 — Explore the possibility of containerizing with docker for easier setup/teardown](https://github.com/WrongerSandwich/traverse/issues/126)
**Status:** Approved design; implementation plan pending.
**Date:** 2026-05-16

## Goal

Make Traverse self-host-able with `docker compose up -d` instead of installing Node + PM2 on the host. Keep the existing PM2 path as a co-equal option so current deployments don't have to migrate.

The issue title — *"easier setup/teardown"* — drives every scope decision. If a feature doesn't move setup or teardown closer to a single command, it's out of scope for this spec.

## Non-goals

- Replacing or deprecating the PM2 deployment path.
- Containerizing the dev loop (`npm run dev`). HMR through Docker bind mounts adds polling/perf footguns that don't pay off at this project's scale.
- Publishing prebuilt images to a registry (GHCR, Docker Hub).
- Multi-arch (arm64) build manifests.
- Auto-update mechanisms (Watchtower etc.).
- Schema or runtime behavior changes — the container is a packaging layer, not a refactor.

Each of these is a clean follow-up ticket if anyone asks for it.

## Architecture

### Image

- **Builder stage:** `node:20-bookworm-slim`. Runs `npm ci` then `npm run build`.
- **Production-deps stage:** separate, also `node:20-bookworm-slim`. Runs `npm ci --omit=dev` so the runtime layer doesn't carry `vitest`, `svelte-check`, etc.
- **Runtime stage:** `node:20-alpine`. Copies `build/`, `package.json`, `package-lock.json`, and the production-only `node_modules/`.
- **Entrypoint:** `CMD ["node", "build/index.js"]`. No PM2 inside the container — Compose's `restart: unless-stopped` is the supervisor. `pm2-runtime` is rejected: it adds weight and swallows crash signals from Docker's restart loop.
- **User:** runs as the existing `node` user (uid 1000) baked into `node:20-alpine`. Compose lets the deployer override with `user: "${UID:-1000}:${GID:-1000}"` so writes to bind-mounted files end up host-owned, not root-owned, on Linux servers where the host user isn't uid 1000.
- **Image size target:** ≤200 MB.
- **`.dockerignore`** must exclude `node_modules/`, `build/`, `.svelte-kit/`, `.env`, `home.md`, `settings.json`, `.geocode-cache.json`, `.image-cache.json`, `.route-cache.json`, `.workflow-stats.json`, `ideas/`, `planning/`, `completed/`, `archived/`, `.claude/`, `.git/`, `tests/`, `docs/`, `*.log`, `/tmp/`. The build context stays small and no user data is ever baked into an image layer.

### Healthcheck

```
test: ["CMD", "wget", "-qO-", "http://localhost:3456/"]
interval: 30s
timeout: 5s
retries: 3
start_period: 20s
```

`wget` is present in `node:20-alpine` via busybox. Hits the SvelteKit root, which returns 200 once the server is listening. The 20s `start_period` covers initial server boot but deliberately does *not* wait for the full ~35s Nominatim warmup mentioned in `DEPLOY.md` — that warmup affects fresh map markers only; the app serves 200s well before it completes. Waiting longer would just delay restart-loop detection on real crashes.

## Data persistence — bind mounts

Bind mounts against the host repo, not named Docker volumes. Rationale: trip markdown is the user's primary data. The whole CLAUDE.md workflow assumes "managed via Claude Code" — i.e. the user is editing these files on disk with whatever tooling. Named volumes hide them under `/var/lib/docker/volumes/` and break that contract.

**Read/write mounts:**

| Host path                  | Container path             | Purpose                                                          |
| -------------------------- | -------------------------- | ---------------------------------------------------------------- |
| `./ideas`                  | `/app/ideas`               | Idea-stage trips                                                 |
| `./planning`               | `/app/planning`            | Planning folders; mutated by Research, brochure prep, chat edits |
| `./completed`              | `/app/completed`           | Finalized trips + retro notes                                    |
| `./archived`               | `/app/archived`            | Archive; scanned by seed-avoidance                               |
| `./settings.json`          | `/app/settings.json`       | Written by `/settings` page                                      |
| `./.geocode-cache.json`    | `/app/.geocode-cache.json` | Runtime cache (disk-backed, survives restarts)                   |
| `./.image-cache.json`      | `/app/.image-cache.json`   | Runtime cache                                                    |
| `./.route-cache.json`      | `/app/.route-cache.json`   | Runtime cache                                                    |
| `./.workflow-stats.json`   | `/app/.workflow-stats.json`| Rolling p50 telemetry for `_promise` estimates                   |

**Read-only mount:**

| Host path  | Container path | Purpose                       |
| ---------- | -------------- | ----------------------------- |
| `./home.md`| `/app/home.md` | User preferences (host-edited)|

**Not mounted** (lives only inside the image): `node_modules/`, `build/`, `src/`, `tests/`, `static/`, repo docs.

**Env loading.** `.env` is *not* bind-mounted. Compose's `env_file: .env` already injects every variable into the container's process environment, which is how the app reads keys today (`process.env` + `dotenv`). Bind-mounting `.env` on top would be redundant and would require a container restart on every edit anyway.

**Bootstrap requirement.** Docker creates a *directory* if a bind-mount target file is missing on the host. The deploy steps must `touch` the five JSON files (`settings.json`, `.geocode-cache.json`, `.image-cache.json`, `.route-cache.json`, `.workflow-stats.json`) before the first `docker compose up`, otherwise the container fails to start. Documented in DEPLOY.md (see below); not handled by an entrypoint script (one less moving part).

## `docker-compose.yml`

Single file at repo root. No prod/override split.

```yaml
services:
  traverse:
    build: .
    image: traverse:local
    container_name: traverse
    restart: unless-stopped
    ports:
      - "3456:3456"
    user: "${UID:-1000}:${GID:-1000}"
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: 3456
    env_file:
      - .env
    volumes:
      - ./ideas:/app/ideas
      - ./planning:/app/planning
      - ./completed:/app/completed
      - ./archived:/app/archived
      - ./home.md:/app/home.md:ro
      - ./settings.json:/app/settings.json
      - ./.geocode-cache.json:/app/.geocode-cache.json
      - ./.image-cache.json:/app/.image-cache.json
      - ./.route-cache.json:/app/.route-cache.json
      - ./.workflow-stats.json:/app/.workflow-stats.json
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3456/"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
```

- `${UID:-1000}` / `${GID:-1000}` — default works on most Linux desktops and on macOS Docker Desktop. Linux servers where the host user isn't uid 1000 should set these in shell env or `.env`.
- No `depends_on`, no other services. One container, one process.
- `container_name: traverse` mirrors the existing PM2 app name so commands feel parallel (`pm2 logs traverse` ↔ `docker compose logs traverse`).

## Files added by the implementation

- `Dockerfile` — multi-stage as described above.
- `docker-compose.yml` — as above.
- `.dockerignore` — exclusions as described above.

That's it for new files. No entrypoint script, no helper Makefile, no separate `compose.prod.yml`.

## Documentation changes

### `DEPLOY.md`

Restructure the top into two co-equal options. Order them PM2-first to minimize churn for existing users.

**Option A — PM2 (existing flow):** unchanged. Section heading added, body untouched.

**Option B — Docker (new):**

```bash
# 1. Clone + configure (same as Option A)
git clone <your-repo-url> traverse && cd traverse
cp home.example.md home.md
cp .env.example .env
# Edit home.md and .env

# 2. Initialize the on-disk state files Docker needs to bind-mount
touch settings.json .geocode-cache.json .image-cache.json \
      .route-cache.json .workflow-stats.json
mkdir -p ideas planning completed archived

# 3. Build + run
docker compose up -d --build

# 4. Tail logs
docker compose logs -f traverse
```

Followed by these subsections, all short:

- **Updating** — `git pull && docker compose up -d --build`
- **Stopping / uninstalling** — `docker compose down` (data persists; `docker image rm traverse:local` to drop the image)
- **uid/gid on Linux servers** — when and why to set `UID=$(id -u) GID=$(id -g)` (e.g. in `.env`)
- **PM2 ↔ Docker swap** — short note: `pm2 delete traverse` before `docker compose up -d` if migrating, since both want port 3456

Everything below the top-of-file (settings overlay, provider configuration, sample env blocks) applies unchanged to both options and stays where it is.

### `CONTRIBUTING.md`

One paragraph under "Quick start for development":

> Contributors can run a prod-style instance locally with `docker compose up -d --build`. The inner dev loop is still `npm run dev` — Vite HMR is not containerized.

### `README.md`

Add one line to the Quick Start block: *"Or run with Docker: see DEPLOY.md."*

### `CLAUDE.md`

No changes. Project conventions are unaffected.

## Verification

Per the project's `npm run verify` standard (svelte-check + tests + build), the container path must additionally pass these manual checks before the implementation PR merges:

1. **Cold start on a clean Linux host** — `git clone`, follow Option B verbatim, end up at a working `http://<host>:3456` with seed/research features wired.
2. **Existing-install compatibility** — run `docker compose up -d --build` from a directory that already has populated `ideas/`, `planning/`, `completed/` and a working `home.md`/`.env`. Trips render unchanged, caches survive `docker compose restart`.
3. **Ownership sanity** — after a fresh run, on a Linux host where the deployer is uid 1000, confirm `settings.json` and the cache JSONs end up owned by the deployer (not root) after the container writes them.
4. **Image size** — `docker image inspect traverse:local --format='{{.Size}}'` ≤ 200 MB.
5. **`/settings` page round-trip** — set an API key via the UI, observe it lands in the host's `settings.json`, restart the container, key is still effective.
6. **Smoke test** — `docker compose exec traverse npm run smoke` should still complete a 1-token round-trip per configured provider.

## Risks and mitigations

| Risk                                                                                          | Mitigation                                                                                                                              |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Bind-mount target files don't exist on host → Docker creates them as directories → boot fails | Explicit `touch` step in Option B deploy snippet; the failure mode is loud and easy to diagnose in logs.                                |
| uid/gid mismatch on Linux servers → settings.json written as root → host can't edit it        | Documented `UID`/`GID` override; default of 1000 covers the common case.                                                                |
| `npm run smoke` and `npm run verify` aren't natural inside a container                        | They still work via `docker compose exec traverse npm run smoke`. Image keeps `npm` available because production `node_modules/` ships. |
| PM2 and Docker fight over port 3456 during migration                                          | Documented `pm2 delete traverse` step in the swap subsection.                                                                           |
| User edits `.env` and expects the container to pick it up live                                | DEPLOY.md notes `docker compose restart` is required for env changes (settings.json overlay still works live via the `/settings` page). |

## Out of scope — candidate follow-up tickets

- Publish image to GHCR on tag via GitHub Actions.
- Multi-arch (linux/amd64 + linux/arm64) build manifests.
- `.devcontainer/` for contributors who want a fully containerized dev loop.
- Auto-update (Watchtower) recipe in DEPLOY.md.
- `compose.override.yml` example for users who want to add reverse-proxy / TLS terminators (Caddy, Traefik) in front.

Each of these is independently shippable once the basic container path is in.
