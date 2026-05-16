# Docker containerization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a co-equal Docker deploy path alongside PM2 — `docker compose up -d` clones, builds, and runs Traverse with all trip data and config bind-mounted from the host repo.

**Architecture:** Single-service `docker-compose.yml` at the repo root, backed by a multi-stage `Dockerfile` (builder → prod-deps → `node:20-alpine` runtime, target ≤200 MB). Bind mounts for trip folders, `home.md`, settings, and caches so existing installs pick up their data unchanged. `.env` is injected via Compose's `env_file` rather than bind-mounted. PM2 is preserved; the README + DEPLOY get a parallel "Option B: Docker" section.

**Tech Stack:** Docker (Engine + Compose v2), `node:20-bookworm-slim` builder, `node:20-alpine` runtime, SvelteKit (`@sveltejs/adapter-node`).

**Spec:** [`docs/superpowers/specs/2026-05-16-docker-containerization-design.md`](../specs/2026-05-16-docker-containerization-design.md)
**Origin ticket:** [#126](https://github.com/WrongerSandwich/traverse/issues/126)

---

## File structure

- **Create:** `Dockerfile` — multi-stage build.
- **Create:** `docker-compose.yml` — single service, bind mounts.
- **Create:** `.dockerignore` — exclude build artifacts, user data, secrets, and large dirs.
- **Modify:** `DEPLOY.md` — restructure the top into Option A (PM2, unchanged) / Option B (Docker, new); add subsections for update, teardown, uid/gid, and PM2↔Docker swap.
- **Modify:** `CONTRIBUTING.md` — one paragraph under "Quick start for development".
- **Modify:** `README.md` — one line in the Quick Start block.

No source-code changes. No new dependencies.

---

## Safety note for the executing engineer

The repo is checked out at `/home/evan/dev/traverse-trip-planner` and **the user already runs Traverse here under PM2 on port 3456.** Do *not* run `docker compose up` against this directory during testing — it will fight PM2 for the port and may write root-owned files into the live data directory.

For end-to-end validation, clone a fresh copy to a scratch dir (e.g. `/tmp/traverse-docker-test`) with a minimal seed (`mkdir -p ideas planning completed archived`, dummy `home.md`/`.env`, `touch` the cache files). Steps below specify when to do this.

---

### Task 1: Branch setup

**Files:** none modified — branch only.

- [ ] **Step 1: Create and switch to the feature branch**

```bash
git checkout -b claude/issue-126-docker
```

- [ ] **Step 2: Verify you're on a clean tree**

Run: `git status --short`
Expected: only the pre-existing dirty cache JSONs (`.geocode-cache.json` etc.) and untracked `ideas/*.md` from the user's working state. No staged changes.

---

### Task 2: Create `.dockerignore`

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Write `.dockerignore`**

Create `/home/evan/dev/traverse-trip-planner/.dockerignore` with exactly this content:

```
# Build artifacts
node_modules
build
.svelte-kit

# Secrets and personal config (provided at runtime via bind mounts or env_file)
.env
.env.example
home.md
settings.json

# Runtime cache files (provided at runtime via bind mounts)
.geocode-cache.json
.image-cache.json
.route-cache.json
.workflow-stats.json

# User trip data (provided at runtime via bind mounts)
ideas
planning
completed
archived

# Tooling, tests, docs — not needed in the runtime image
.claude
.git
.gitignore
.github
tests
docs
*.log
/tmp
.DS_Store

# This file itself
.dockerignore
```

- [ ] **Step 2: Commit**

```bash
git add .dockerignore
git commit -m "build: add .dockerignore for Docker image"
```

---

### Task 3: Create the `Dockerfile`

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Write `Dockerfile`**

Create `/home/evan/dev/traverse-trip-planner/Dockerfile` with exactly this content:

```dockerfile
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
```

**Why each stage exists:**
- `builder` runs `npm run build` with full dev deps (vite, svelte-check, etc.).
- `prod-deps` runs `npm ci --omit=dev` against the same lockfile to produce a smaller `node_modules/` for the runtime layer.
- `runtime` is `node:20-alpine` (~50 MB base); it pulls only `build/`, `node_modules/`, and the manifests from the prior stages.

- [ ] **Step 2: Validate the Dockerfile syntactically**

Run: `docker build --check .`
Expected: no errors. (If Docker isn't installed locally, skip this step and rely on the build in Task 4.)

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "build: add multi-stage Dockerfile (~150MB Alpine runtime)"
```

---

### Task 4: Build the image and verify size

**Files:** none — validation only.

- [ ] **Step 1: Build the image**

Run: `docker build -t traverse:local .`
Expected: build succeeds, final image tagged `traverse:local`.

Common pitfalls:
- If `npm ci` fails with "lockfile out of sync," the build context is missing something `.dockerignore` accidentally excluded. Check `package.json` and `package-lock.json` are *not* in `.dockerignore`.
- If the Alpine stage fails on `npm` calls, note that we don't run `npm` in the runtime stage — only `node build/index.js`. Re-check the COPY paths.

- [ ] **Step 2: Verify image size ≤ 200 MB**

Run: `docker image inspect traverse:local --format='{{.Size}}' | awk '{print $1/1024/1024 " MB"}'`
Expected: ≤ 200 MB. If higher, suspect that dev deps leaked into the runtime stage — re-confirm the runtime stage uses `--from=prod-deps` not `--from=builder` for `node_modules/`.

- [ ] **Step 3: Verify the image runs and serves 200**

Run (in a separate scratch directory to avoid touching the live deploy):

```bash
mkdir -p /tmp/traverse-smoke && cd /tmp/traverse-smoke
docker run --rm -d --name traverse-smoke -p 13456:3456 traverse:local
# wait a few seconds for boot
curl -fsS http://localhost:13456/ -o /dev/null && echo "OK" || echo "FAIL"
docker stop traverse-smoke
```

Expected: prints `OK`. (The app will boot in a degraded state because no `home.md`/`.env` are mounted, but the SvelteKit server still responds 200 on the root.)

- [ ] **Step 4: Verify the image has no embedded user data**

Run:
```bash
docker run --rm traverse:local sh -c "ls /app | sort"
```
Expected output (one per line, exactly):
```
build
node_modules
package-lock.json
package.json
```

**No `ideas/`, `planning/`, `completed/`, `archived/`, `home.md`, `.env`, `settings.json`, or cache JSONs should be present.** If any are, `.dockerignore` is incomplete — fix it and rebuild.

---

### Task 5: Create `docker-compose.yml`

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Write `docker-compose.yml`**

Create `/home/evan/dev/traverse-trip-planner/docker-compose.yml` with exactly this content:

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

- [ ] **Step 2: Validate compose syntax**

Run: `docker compose config --quiet`
Expected: no output, exit 0. If errors, re-check indentation (YAML is whitespace-sensitive).

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "build: add docker-compose with bind-mounted trip data and config"
```

---

### Task 6: End-to-end cold-start validation in a scratch directory

**Files:** none — validation only. **Do not run in the live repo.**

- [ ] **Step 1: Set up a scratch copy of the repo**

```bash
cd /tmp
git clone /home/evan/dev/traverse-trip-planner traverse-docker-test
cd traverse-docker-test
git checkout claude/issue-126-docker
```

- [ ] **Step 2: Seed the bootstrap state the deploy doc will tell users to run**

```bash
cp home.example.md home.md
cp .env.example .env
# Edit .env to set a real PEXELS_API_KEY and ANTHROPIC_API_KEY if you want
# AI features to work; for a pure boot test, leaving placeholders is fine.

touch settings.json .geocode-cache.json .image-cache.json \
      .route-cache.json .workflow-stats.json
mkdir -p ideas planning completed archived
```

- [ ] **Step 3: Build + start**

Run (in `/tmp/traverse-docker-test`):
```bash
UID=$(id -u) GID=$(id -g) docker compose up -d --build
```

Expected: builds image (if not cached), starts container `traverse`, exits cleanly.

- [ ] **Step 4: Verify the container is running and healthy**

Run: `docker compose ps`
Expected: `STATE` shows `running` and after ~30 s `STATUS` includes `(healthy)`.

If `STATUS` is `unhealthy`, run `docker compose logs traverse` and look for the SvelteKit startup banner. Common cause: a bind-mounted JSON exists as a directory (Docker created it) — `docker compose down`, remove the offending directory, `touch` the file, retry.

- [ ] **Step 5: Confirm 200 on the root**

Run: `curl -fsS http://localhost:3456/ -o /dev/null && echo OK`
Expected: `OK`.

- [ ] **Step 6: Verify host ownership of writable bind-mounted files**

Run:
```bash
ls -la settings.json .geocode-cache.json .image-cache.json .route-cache.json .workflow-stats.json
```

Expected: all owned by `$(id -un)`, not `root`. If any are `root`-owned, the `user: "${UID:-1000}:${GID:-1000}"` mapping didn't kick in — re-check that the `UID`/`GID` env vars were exported in step 3.

- [ ] **Step 7: Verify persistence across restart**

```bash
echo '{"keys":{"anthropic":"sentinel-value"}}' > settings.json
docker compose restart
sleep 5
cat settings.json
```

Expected: `settings.json` still contains `sentinel-value` after restart.

- [ ] **Step 8: Tear down the scratch instance**

```bash
docker compose down
docker image rm traverse:local
cd /
rm -rf /tmp/traverse-docker-test
```

Expected: no errors. Back to the live repo at `/home/evan/dev/traverse-trip-planner` afterwards.

- [ ] **Step 9: No commit in this task** — validation only. Continue to Task 7.

---

### Task 7: Update `DEPLOY.md` — Option A / Option B restructure

**Files:**
- Modify: `DEPLOY.md`

The current `DEPLOY.md` opens with "Prerequisites" then "First deploy" assuming PM2. We're restructuring so PM2 becomes "Option A" and Docker becomes "Option B," both reaching the same `http://<server-ip>:3456` endpoint. Everything below "## Settings overlay (settings.json)" stays put — it applies to both options.

- [ ] **Step 1: Read the current top of `DEPLOY.md` to anchor the edit**

Run: `sed -n '1,80p' DEPLOY.md`
Expected: see "# Deploying Traverse to a Home Server" → "## Prerequisites" → "## First deploy" → "## Finding the server IP" → "## Updating after changes" → ...

- [ ] **Step 2: Replace the top of `DEPLOY.md`**

Replace the block from line 1 through the end of the "## Updating after changes" section (i.e., everything before "## Migrating from the old `atlas` process name") with this exact content:

````markdown
# Deploying Traverse to a Home Server

Traverse can be deployed two ways. Both reach the same `http://<server-ip>:3456` and read the same on-disk trip data. Pick whichever feels lighter.

| Option              | Best for                                                                        |
| ------------------- | ------------------------------------------------------------------------------- |
| **A. PM2**          | Existing Linux servers that already run Node services; no Docker dependency.    |
| **B. Docker**       | Fresh installs, devices without a Node toolchain, easier teardown / migration.  |

You can swap between them later — both read the same `ideas/`, `planning/`, `completed/`, `archived/`, `home.md`, `.env`, and cache files.

---

## Option A — PM2

### Prerequisites (on the Linux server)

```bash
# Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 (process manager)
sudo npm install -g pm2
```

### First deploy

```bash
# 1. Clone the repo
git clone <your-repo-url> traverse
cd traverse

# 2. Configure your preferences
cp home.example.md home.md
# Edit home.md — set your home city/coords, traveler name(s), vehicle(s), and taste profile.
# This file drives all AI features; the more honest detail you add, the better the suggestions.

# 3. Set up your API keys
cp .env.example .env
# Edit .env — paste your ANTHROPIC_API_KEY and PEXELS_API_KEY.

# 4. Install dependencies, verify provider keys, and build
npm install
npm run smoke         # 1-token round trip per configured provider; <1¢
npm run build

# 5. Start with PM2
pm2 start ecosystem.config.cjs
pm2 save                        # persist across reboots
pm2 startup                     # enable auto-start (follow the printed command)
```

Traverse is now accessible on your LAN at `http://<server-ip>:3456`.

### Finding the server IP

```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
```

### Updating after changes

```bash
git pull
npm install          # if dependencies changed
npm run build
pm2 restart traverse
```

---

## Option B — Docker

### Prerequisites (on the host)

- Docker Engine 20.10+ with Compose v2 (`docker compose ...`, not the old `docker-compose`).
- That's it — no Node, no PM2 on the host.

### First deploy

```bash
# 1. Clone the repo
git clone <your-repo-url> traverse
cd traverse

# 2. Configure your preferences (same as Option A)
cp home.example.md home.md
cp .env.example .env
# Edit home.md and .env.

# 3. Initialize on-disk state files that Compose will bind-mount
# (Docker would otherwise create these as directories on first run.)
touch settings.json .geocode-cache.json .image-cache.json \
      .route-cache.json .workflow-stats.json
mkdir -p ideas planning completed archived

# 4. Build the image and start the container
docker compose up -d --build

# 5. Tail logs to confirm the boot banner
docker compose logs -f traverse
```

Traverse is now accessible on your LAN at `http://<server-ip>:3456`.

### Updating after changes

```bash
git pull
docker compose up -d --build
```

### Stopping and uninstalling

```bash
docker compose down                # stop the container; data on disk is untouched
docker image rm traverse:local     # also drop the image
```

Trip data, `home.md`, `.env`, and caches stay on the host — `docker compose down` does not touch them.

### uid/gid on Linux servers

If your host user isn't uid 1000 (the default `node` user inside the image), writes to bind-mounted files (`settings.json`, the cache JSONs) would end up root-owned. Set both env vars before `up`:

```bash
echo "UID=$(id -u)" >> .env
echo "GID=$(id -g)" >> .env
docker compose up -d
```

macOS Docker Desktop translates ownership automatically; you can leave the defaults.

### Swapping between PM2 and Docker

Both want port 3456. If you're migrating, stop the other first:

```bash
# PM2 → Docker
pm2 delete traverse
docker compose up -d --build

# Docker → PM2
docker compose down
pm2 start ecosystem.config.cjs
```

---
````

(After this block, the existing "## Migrating from the old `atlas` process name" section and everything below it stays exactly as it was.)

- [ ] **Step 3: Verify the file still flows correctly**

Run: `sed -n '1,5p' DEPLOY.md && echo '---' && sed -n '120,140p' DEPLOY.md`
Expected: top now shows the two-options intro; around line 120-140 you should still see the start of the unchanged "## Migrating from the old `atlas` process name" section.

- [ ] **Step 4: Commit**

```bash
git add DEPLOY.md
git commit -m "docs(deploy): add Option B (Docker) alongside PM2"
```

---

### Task 8: Update `CONTRIBUTING.md`

**Files:**
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Locate the "Quick start for development" section**

Run: `grep -n "Quick start" CONTRIBUTING.md`
Expected: the section heading appears once near the top.

- [ ] **Step 2: Add a one-paragraph addition immediately after the existing fenced code block**

Find the line `npm run dev                      # http://localhost:3456` and the closing ```` ``` ```` that follows it. Immediately after that closing fence, insert one blank line and then the following paragraph:

```markdown

Prefer Docker for a prod-style local run? `docker compose up -d --build` works the same way as on a server (see [DEPLOY.md](DEPLOY.md#option-b--docker)). The inner dev loop is still `npm run dev` — Vite HMR is not containerized.
```

- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs(contributing): mention Docker for prod-style local runs"
```

---

### Task 9: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Locate the Quick Start block**

Run: `grep -n "Quick start" README.md`
Expected: one match, around line 39.

- [ ] **Step 2: Add the Docker line after the existing Quick Start fenced block**

Find the closing ```` ``` ```` of the Quick Start code block (the one that ends with `node build/index.js`) and the `Open http://localhost:3456.` line that follows it. Immediately after that `Open …` line, insert one blank line and then:

```markdown

Prefer Docker? See [DEPLOY.md](DEPLOY.md#option-b--docker) for `docker compose up -d --build`.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): point to Docker deploy option"
```

---

### Task 10: Run the standard verify pipeline

**Files:** none — validation only.

- [ ] **Step 1: Run the standard go/no-go**

Run: `npm run verify`
Expected: svelte-check passes with no warnings, all tests pass, `npm run build` succeeds. (The Docker work doesn't touch source code, so this is a sanity check that the docs edits and new files haven't broken anything indirectly — e.g., the build picking up `Dockerfile` as a route. They shouldn't, but verify catches regressions of any kind.)

If it fails, do not proceed — fix the failure first.

- [ ] **Step 2: Confirm the branch contains everything**

Run: `git log --oneline main..HEAD`
Expected (exact 5 commits, newest first):
```
docs(readme): point to Docker deploy option
docs(contributing): mention Docker for prod-style local runs
docs(deploy): add Option B (Docker) alongside PM2
build: add docker-compose with bind-mounted trip data and config
build: add multi-stage Dockerfile (~150MB Alpine runtime)
build: add .dockerignore for Docker image
```

(Six commits total. If the count is off, something was skipped — check the task list.)

---

### Task 11: Push and open the PR

**Files:** none — handoff only.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin claude/issue-126-docker
```

- [ ] **Step 2: Open the PR**

Run:
```bash
gh pr create --title "Add Docker deploy path (closes #126)" --body "$(cat <<'EOF'
## Summary
- Multi-stage Dockerfile (`node:20-bookworm-slim` builder → `node:20-alpine` runtime, ~150 MB).
- `docker-compose.yml` with bind mounts for `ideas/`, `planning/`, `completed/`, `archived/`, `home.md`, `settings.json`, and the four cache JSONs. `.env` is injected via `env_file`.
- `.dockerignore` keeps user data, secrets, dev-only files, and `node_modules/` out of the build context.
- DEPLOY.md restructured into Option A (PM2, unchanged) and Option B (Docker, new) with subsections for first deploy, update, teardown, uid/gid on Linux servers, and PM2↔Docker swap.
- One-line/one-paragraph mentions added to README.md and CONTRIBUTING.md.

Implements the design in `docs/superpowers/specs/2026-05-16-docker-containerization-design.md`. Closes #126.

## Test plan
- [ ] `npm run verify` passes
- [ ] `docker build -t traverse:local .` succeeds; resulting image is ≤200 MB
- [ ] `docker run --rm traverse:local sh -c "ls /app"` shows only `build`, `node_modules`, `package.json`, `package-lock.json` (no trip data, no secrets)
- [ ] In a fresh scratch directory, Option B from DEPLOY.md works end-to-end: container reaches healthy state, `/` returns 200
- [ ] `settings.json` written from inside the container ends up host-owned (not root) when `UID`/`GID` are exported
- [ ] `docker compose restart` preserves settings.json contents

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: prints a PR URL. Surface it to the user.

---

## Self-review notes

**Spec coverage check** — every section of `2026-05-16-docker-containerization-design.md` maps to a task:
- Image / Dockerfile architecture → Task 3
- `.dockerignore` exclusions → Task 2
- Healthcheck → Task 5 (embedded in compose)
- Bind-mount table (rw + ro) → Task 5
- Env loading via `env_file` → Task 5
- Bootstrap `touch` requirement → Task 6 step 2, Task 7 deploy snippet
- uid/gid override docs → Task 7 deploy section
- Single compose file decision → Task 5 (only one file written)
- DEPLOY.md restructure → Task 7
- CONTRIBUTING.md paragraph → Task 8
- README.md one-liner → Task 9
- CLAUDE.md "no changes" → no task (intentional)
- Verification checklist 1 (cold start) → Task 6
- Verification 2 (existing-install compat) → Task 6 (the scratch clone *is* the existing-install pattern, since bind mounts pick up pre-existing data identically)
- Verification 3 (ownership sanity) → Task 6 step 6
- Verification 4 (image size ≤200 MB) → Task 4 step 2
- Verification 5 (/settings round-trip) → Task 6 step 7
- Verification 6 (smoke inside container) → captured implicitly; can be added to the PR test-plan checklist if desired
- Risks table → each risk has a corresponding doc/task addressing it

No spec requirements left uncovered.
