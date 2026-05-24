# Deploying Traverse to a Home Server

**Docker is the canonical deployment path.** It requires no Node.js toolchain on the host and is the path documented in CLAUDE.md.

---

## Docker (canonical)

### Prerequisites (on the host)

- Docker Engine 20.10+ with Compose v2 (`docker compose ...`, not the old `docker-compose`).
- That's it — no Node, no PM2 on the host.

### First deploy

```bash
# 1. Clone the repo
git clone <your-repo-url> traverse
cd traverse

# 2. Configure your preferences
cp .env.example .env
# Edit .env — paste your ANTHROPIC_API_KEY and PEXELS_API_KEY.
# home.md is created by the in-app onboarding flow on first run; edit later via Settings.

# 3. Pre-create settings.json so dockerd doesn't materialize the bind-mount
# target as a directory on first run. Stage dirs (ideas/, planning/, completed/,
# archived/) and the runtime cache dir (.cache/) already exist from `git clone`
# via tracked .gitkeep files — no mkdir needed.
touch settings.json

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

If your host user isn't uid 1000 (the default `node` user inside the image), writes to bind-mounted paths (`settings.json`, the `.cache/` directory, trip data under `ideas/` / `planning/` / `completed/` / `archived/`) would end up root-owned. Set both env vars before `up`:

```bash
echo "UID=$(id -u)" >> .env
echo "GID=$(id -g)" >> .env
docker compose up -d
```

macOS Docker Desktop translates ownership automatically; you can leave the defaults.

The startup banner lists which providers are wired and which features are available. Each AI call also emits a one-line `[ai] <label> <provider>/<model> — N in / N out (T turns, ms)` log so you can grep for total spend per feature. Transient API failures (network blips, 429 rate limits, 5xx) are retried with exponential backoff (3 attempts, 1s/2s/4s) and logged as `[retry] <label> attempt N/3 …`. Non-retriable errors (4xx other than 429, malformed responses) fail immediately.

## Notes

- **Runtime caches** (geocode, image, route, workflow-stats) live under `.cache/` on the host, bind-mounted into the container as a directory. All four persist across restarts. The directory ships with a tracked `.gitkeep` so `git clone` materializes it as the cloning user — without it, dockerd would auto-create the missing bind-mount target as root and break writes from the container's non-root uid. Per-file bind mounts aren't used here because atomic writes do a tmp-then-rename, and renaming onto a single bind-mounted file fails with `EBUSY` (the kernel won't replace a bind-mount target). Pre-`.cache/` installs are auto-migrated on first boot: any root-level `.geocode-cache.json` / `.image-cache.json` / `.route-cache.json` / `.workflow-stats.json` is moved into `.cache/` before the first read.
- **`.env` is gitignored** — never committed. Use `.env.example` as your template.
- **`home.md` is gitignored** — your personal preferences stay local. It's created by the in-app onboarding flow on first run, and editable later from the Settings page.
- The `PEXELS_API_KEY` enables trip card photos. Without it, cards show a map thumbnail instead.
- The `STADIA_API_KEY` (optional) replaces the brochure's destination-area illustrative paper map with a real Stadia "Outdoors" tile render (streets, parks, terrain shading visible). Without it, the destination map falls back to the state-outlines + rivers + place-labels illustration. Free tier: 200K static-map requests/month for non-commercial use. Sign up at [stadiamaps.com](https://stadiamaps.com) → Property → API key.

## Settings overlay (settings.json)

The Settings page (`/settings`) lets you manage API keys and routing configuration from the browser without editing files or restarting the server. Values are stored in `settings.json` at the repo root.

**Precedence (highest to lowest):**
1. `settings.json` — set via the UI; takes effect on the next request, no restart needed
2. `.env` — the traditional deployment path; still the right choice for production servers where the UI is not accessible or key rotation is managed externally (Vault, sealed-secrets, Doppler, etc.)
3. Compiled defaults (e.g. `anthropic` / `claude-sonnet-4-6`)

`settings.json` is gitignored; it never appears in version control. See `settings.example.json` for the expected shape, and the [Configuration reference](#configuration-reference) below for the full list of what can live where.

To revert to `.env`-only behavior, delete `settings.json` or use the **Remove** button next to a stored key on the Settings page. Removing a key deletes only that key's entry from `settings.json`; other stored settings are untouched. Once removed, the corresponding `.env` value resumes as the active key. If no `.env` fallback exists, the next AI call using that provider will fail with a missing-key error.

**`TRAVERSE_DISABLE_SETTINGS_UI`** — set to any non-empty value to disable the `/settings` page and `POST /api/settings` entirely (both return 403). Recommended for production deployments where the server is reachable over an untrusted network and you prefer `.env`-only key management.

## Configuration reference

Where each configuration knob can live. The short answer: provider/service keys and AI routing live in either `.env` or `settings.json` (settings.json wins where both are set). Operational knobs (process startup, security boundaries) live in `.env` only by design.

### Knobs that work in both .env and settings.json

These overlay through `getEffectiveConfig()` (`src/lib/server/config.js`). Set them via `.env` for config-as-code, or via the Settings UI for click-through setup — both work, and settings.json wins per-key when both are populated.

| Knob                            | .env variable                      | settings.json path           | Notes                                          |
| ------------------------------- | ---------------------------------- | ---------------------------- | ---------------------------------------------- |
| Anthropic API key               | `ANTHROPIC_API_KEY`                | `keys.anthropic`             |                                                |
| OpenAI API key                  | `OPENAI_API_KEY`                   | `keys.openai`                |                                                |
| OpenRouter API key              | `OPENROUTER_API_KEY`               | `keys.openrouter`            |                                                |
| Pexels API key                  | `PEXELS_API_KEY`                   | `services.pexels`            | Cover photos                                   |
| Tavily API key                  | `TAVILY_API_KEY`                   | `services.tavily`            | Search backend (when `tavily` is selected)     |
| Stadia Maps API key             | `STADIA_API_KEY`                   | `services.stadia`            | Brochure base map                              |
| Default slot provider           | `TRAVERSE_MODEL_DEFAULT_PROVIDER`  | `slots.default.provider`     |                                                |
| Default slot model              | `TRAVERSE_MODEL_DEFAULT`           | `slots.default.model`        |                                                |
| Research slot provider          | `TRAVERSE_MODEL_RESEARCH_PROVIDER` | `slots.research.provider`    |                                                |
| Research slot model             | `TRAVERSE_MODEL_RESEARCH`          | `slots.research.model`       |                                                |
| Search backend                  | `TRAVERSE_SEARCH_PROVIDER`         | `search.provider`            | `anthropic-builtin` (default) or `tavily`      |
| Assistant display name          | `TRAVERSE_ASSISTANT_NAME`          | `assistantName`              |                                                |

Per-feature model overrides (`TRAVERSE_MODEL_SEED`, `TRAVERSE_MODEL_LOCK`, etc.) are `.env`-only today; the UI doesn't surface them. Set them when you want a specific feature to use a different model than its slot default — for example, a cheaper formatting model for `lock`.

### Knobs that are .env only

These are intentionally not in `settings.json`. Each row explains why.

| Knob                            | Variable                                                    | Why env-only                                                                                          |
| ------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Host uid                        | `UID`                                                       | Read by Docker Compose on the host (`docker-compose.yml`'s `user:` interpolation) before the container starts. Compose can't read a JSON file inside an unstarted container. |
| Host gid                        | `GID`                                                       | Same as `UID`.                                                                                        |
| HTTP port                       | `PORT`                                                      | Read by SvelteKit's adapter-node at process startup. Set in `docker-compose.yml`'s `environment:` block.   |
| Listen address                  | `HOST`                                                      | Same as `PORT`.                                                                                       |
| Node environment                | `NODE_ENV`                                                  | Set by Docker Compose; affects framework behavior at startup.                                         |
| Disable the Settings UI         | `TRAVERSE_DISABLE_SETTINGS_UI`                              | Trust boundary — if it lived in `settings.json`, the UI it disables could re-enable itself.           |
| Allow LAN writes to config      | `TRAVERSE_ALLOW_LAN_WRITES`                                 | Auth gate for `POST /api/settings` and `PUT /api/home`. Same trust-boundary reasoning.                |
| Trust proxy for auth            | `TRUST_PROXY_FOR_AUTH`                                      | Auth gate behavior; see [Config-write auth](#config-write-auth-loopback-by-default) below.            |
| Share-link HMAC secret          | `TRAVERSE_SHARE_SECRET`                                     | Long-lived secret; rotating it should invalidate existing share links, so it shouldn't round-trip through a UI. |
| Rate-limit overrides            | `TRAVERSE_RATELIMIT_<endpoint>_CAPACITY`, `_REFILL_PER_MIN` | Operational tuning, not user preferences.                                                             |

If you need a knob that's currently `.env`-only to be UI-editable, open an issue — the current split is intentional but not sacred.

### Config-write auth (loopback-by-default)

`POST /api/settings` and `PUT /api/home` write provider keys and the
home.md profile that shapes every AI prompt. The CSRF Origin check in
`src/hooks.server.js` blocks cross-origin browser requests but does
**not** block direct `curl` from anywhere the host is reachable. To
prevent a LAN attacker (or a misconfigured proxy / sibling container)
from swapping the provider to their own endpoint and exfiltrating
prompts, these two endpoints require the request to originate from
loopback by default.

For a typical single-user home deployment where the browser runs on a
different device on the same LAN, set:

```bash
TRAVERSE_ALLOW_LAN_WRITES=1
```

This opens the gate. Only set it when every device that can reach the
API is trusted by the operator.

Behind a reverse proxy (Caddy, nginx) the socket address is always the
proxy's loopback. To gate by the real client IP, instead set:

```bash
TRUST_PROXY_FOR_AUTH=1
```

The gate then reads the first hop of `X-Forwarded-For`. **The proxy
must unconditionally overwrite `X-Forwarded-For`** — otherwise an
attacker can spoof it. With Caddy, `reverse_proxy` does this by
default; with nginx, set `proxy_set_header X-Forwarded-For $remote_addr;`
(not `$proxy_add_x_forwarded_for`).

If both vars are set, `TRAVERSE_ALLOW_LAN_WRITES` wins (gate fully
open). The threat model is documented in `src/lib/server/auth.js`.

## Provider configuration (BYOK)

Traverse talks to model and search providers through a thin adapter layer. The defaults preserve the original Anthropic-only behavior, so existing deployments keep working without env changes. To switch providers, set the `TRAVERSE_*` variables in `.env`.

### What each feature needs

| Feature                    | Requires                                                |
| -------------------------- | ------------------------------------------------------- |
| Seed / Add (`+`, pin)      | `modelDefault` provider with valid key                  |
| Lock & generate itinerary  | `modelDefault` provider with valid key                  |
| Ask Field guide (planning chat) | `modelDefault` provider with valid key             |
| Retro on completion        | `modelDefault` provider with valid key                  |
| Add receipts (completed trips) | `modelDefault` provider with valid key **+ vision-capable model** (e.g. `claude-sonnet-4-6`, `gpt-4o`; non-vision models like `gpt-3.5-turbo` will error at runtime) |
| Research → (deepen)        | `modelResearch` provider with key **+** search backend  |

If a feature's backing provider isn't configured, its button is disabled in the UI with a tooltip pointing at either `.env` or the Settings page. The startup banner (printed to the server log) lists which features are wired and tags each effective value's source.

### Supported providers

| Slot           | Variable                            | Values                              |
| -------------- | ----------------------------------- | ----------------------------------- |
| Default model  | `TRAVERSE_MODEL_DEFAULT_PROVIDER`      | `anthropic` (default) · `openai` · `openrouter` |
| Default model  | `TRAVERSE_MODEL_DEFAULT`               | model id (e.g. `claude-sonnet-4-6`, `gpt-4o-mini`) |
| Research model | `TRAVERSE_MODEL_RESEARCH_PROVIDER`     | `anthropic` (default) · `openai` · `openrouter` |
| Research model | `TRAVERSE_MODEL_RESEARCH`              | tool-use-capable model id           |
| Search backend | `TRAVERSE_SEARCH_PROVIDER`             | `anthropic-builtin` (default) · `tavily` |
| Assistant name | `TRAVERSE_ASSISTANT_NAME`              | display name in UI (default `Field guide`)    |
| Per-feature    | `TRAVERSE_MODEL_<FEATURE>(_PROVIDER)?` | optional override; `<FEATURE>` ∈ `SEED`, `ADD`, `LOCK`, `CHAT`, `RETRO`, `RECEIPTS`, `DEEPEN` |

`anthropic-builtin` runs Anthropic's server-side `web_search` tool — only valid when the research model is also Anthropic. `tavily` is portable across any model provider but requires a `TAVILY_API_KEY`.

#### OpenRouter

[OpenRouter](https://openrouter.ai) is a multi-provider gateway that exposes hundreds of models (Claude, GPT, Gemini, Llama, Mistral, DeepSeek, and more) behind a single OpenAI-compatible API and a single API key. Benefits: one key for all providers, often cheaper than provider-direct, access to non-Anthropic/non-OpenAI models without per-provider adapters.

**Setup:** sign up at [openrouter.ai](https://openrouter.ai), create an API key, and set it in `.env`:

```
OPENROUTER_API_KEY=sk-or-...
```

**Model slugs** use the `provider/model` format, e.g.:
- `anthropic/claude-3.5-sonnet` — Claude via OpenRouter
- `openai/gpt-4o-mini` — GPT-4o Mini via OpenRouter
- `meta-llama/llama-3.1-70b-instruct` — Llama 3.1 via OpenRouter
- `google/gemini-pro` — Gemini Pro via OpenRouter

**Important constraint:** OpenRouter requires `TRAVERSE_SEARCH_PROVIDER=tavily` for Research → (Deepen). The `anthropic-builtin` search backend dispatches Anthropic's server-side tool directly — it cannot route through OpenRouter even if the underlying model is Claude. Traverse will surface a config error if this combination is detected.

`TRAVERSE_ASSISTANT_NAME` only affects user-facing UI strings ("Ask Field guide…", SSE progress messages). Set it to whatever fits the model you've configured.

**Public share links** are off by default. Set `TRAVERSE_SHARE_SECRET` (e.g. `openssl rand -base64 32`) to enable a "Generate share link" button on the trip detail view. The link is `/share/<token>` where the token is `HMAC-SHA256(slug, secret)`; tokens are deterministic but tied per-trip via a `shared: true` frontmatter flag, so disabling share on a trip revokes access immediately even if someone has the URL. Rotating `TRAVERSE_SHARE_SECRET` invalidates every existing share link.

**Per-feature overrides** let you route specific actions to a different model than the slot default — e.g. use Haiku for the deterministic itinerary-generation call (`lock`) while keeping Sonnet for everything else:

```
ANTHROPIC_API_KEY=sk-ant-...
TRAVERSE_MODEL_LOCK=claude-haiku-4-5
```

Both `TRAVERSE_MODEL_<FEATURE>` (model id) and `TRAVERSE_MODEL_<FEATURE>_PROVIDER` (provider) are independent overrides; either or both can be set. An override that points to a provider with no key configured disables only that feature, leaving the rest working — the startup banner shows per-feature provider/model and marks overrides explicitly.

### Sample configurations

**Anthropic-only (default — no env changes needed):**
```
ANTHROPIC_API_KEY=sk-ant-...
PEXELS_API_KEY=...
```

**OpenAI-only (no Anthropic dependency):**
```
OPENAI_API_KEY=sk-proj-...
TAVILY_API_KEY=tvly-...
PEXELS_API_KEY=...

TRAVERSE_MODEL_DEFAULT_PROVIDER=openai
TRAVERSE_MODEL_DEFAULT=gpt-4o-mini
TRAVERSE_MODEL_RESEARCH_PROVIDER=openai
TRAVERSE_MODEL_RESEARCH=gpt-4o
TRAVERSE_SEARCH_PROVIDER=tavily
```

**Mixed (cheap default, smart research, portable search):**
```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
TAVILY_API_KEY=tvly-...
PEXELS_API_KEY=...

TRAVERSE_MODEL_DEFAULT_PROVIDER=openai
TRAVERSE_MODEL_DEFAULT=gpt-4o-mini
TRAVERSE_MODEL_RESEARCH_PROVIDER=anthropic
TRAVERSE_MODEL_RESEARCH=claude-opus-4-7
TRAVERSE_SEARCH_PROVIDER=tavily
```

**OpenRouter (one key, any model):**
```
OPENROUTER_API_KEY=sk-or-...
TAVILY_API_KEY=tvly-...    # required for Research → when using OpenRouter
PEXELS_API_KEY=...

TRAVERSE_MODEL_DEFAULT_PROVIDER=openrouter
TRAVERSE_MODEL_DEFAULT=anthropic/claude-3.5-sonnet
TRAVERSE_MODEL_RESEARCH_PROVIDER=openrouter
TRAVERSE_MODEL_RESEARCH=anthropic/claude-opus-4-7
TRAVERSE_SEARCH_PROVIDER=tavily
```
