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

# 3. Initialize on-disk state files that Compose will bind-mount
# (Docker would otherwise create these as directories on first run.)
# Stage dirs (ideas/ planning/ completed/ archived/) already exist from
# `git clone` via tracked .gitkeep files — no mkdir needed.
touch settings.json .geocode-cache.json .image-cache.json \
      .route-cache.json .workflow-stats.json

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

The startup banner lists which providers are wired and which features are available. Each AI call also emits a one-line `[ai] <label> <provider>/<model> — N in / N out (T turns, ms)` log so you can grep for total spend per feature. Transient API failures (network blips, 429 rate limits, 5xx) are retried with exponential backoff (3 attempts, 1s/2s/4s) and logged as `[retry] <label> attempt N/3 …`. Non-retriable errors (4xx other than 429, malformed responses) fail immediately.

## Notes

- **Geocode cache** (Nominatim) is in-memory and re-fetched on each restart. With ~30 trips at 1.1s each, warmup takes ~35s after restart. The app is functional immediately; the map markers fill in during warmup.
- **Image + route caches** (`.image-cache.json`, `.route-cache.json`) are on disk and survive restarts.
- **`.env` is gitignored** — never committed. Use `.env.example` as your template.
- **`home.md` is gitignored** — your personal preferences stay local. It's created by the in-app onboarding flow on first run, and editable later from the Settings page.
- The `PEXELS_API_KEY` enables trip card photos. Without it, cards show a map thumbnail instead.
- The `STADIA_API_KEY` (optional) replaces the brochure's destination-area illustrative paper map with a real Stadia "Outdoors" tile render (streets, parks, terrain shading visible). Without it, the destination map falls back to the state-outlines + rivers + place-labels illustration. Free tier: 200K static-map requests/month for non-commercial use. Sign up at [stadiamaps.com](https://stadiamaps.com) → Property → API key.

## Settings overlay (settings.json)

The Settings page (`/settings`) lets you manage API keys and model-slot configuration from the browser without editing files or restarting the server. Values are stored in `settings.json` at the repo root.

**Precedence (highest to lowest):**
1. `settings.json` — set via the UI; takes effect on the next request, no restart needed
2. `.env` — the traditional deployment path; still the recommended approach for production servers where the UI is not accessible or key rotation is managed externally
3. Compiled defaults (e.g. `anthropic` / `claude-sonnet-4-6`)

**What settings.json stores:**
- Provider API keys (`keys.anthropic`, `keys.openai`, `keys.openrouter`)
- Slot configuration (`slots.default` and `slots.research`, each with `provider` + `model`)

**What settings.json does NOT store (deferred to later):**
- Search backend selection or Tavily key
- Assistant name, share secret, or feature flags

`settings.json` is gitignored; it never appears in version control. See `settings.example.json` for the expected shape.

To revert to `.env`-only behavior, delete `settings.json` or use the **Remove** button next to a stored key on the Settings page. Removing a key deletes only that key's entry from `settings.json`; other stored settings are untouched. Once removed, the corresponding `.env` value (e.g. `ANTHROPIC_API_KEY`) resumes as the active key. If no `.env` fallback exists, the next AI call using that provider will fail with a missing-key error.

> **Note:** The startup banner (printed to the server log on boot) reflects only `.env` state — it reads config before `settings.json` can be overlaid. The Settings page (`/settings`) shows what is actually effective for incoming requests.

**`TRAVERSE_DISABLE_SETTINGS_UI`** — set to any non-empty value to disable the `/settings` page and `POST /api/settings` entirely (both return 403). Recommended for production deployments where the server is reachable over an untrusted network and you prefer `.env`-only key management.

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

If a feature's backing provider isn't configured, its button is disabled in the UI with a tooltip pointing at `.env`. The startup banner (printed to the server log) lists which features are wired.

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
