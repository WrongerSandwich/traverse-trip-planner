# Deploying Traverse to a Home Server

## Prerequisites (on the Linux server)

```bash
# Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 (process manager)
sudo npm install -g pm2
```

## First deploy

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

## Finding the server IP

```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
```

## Updating after changes

```bash
git pull
npm install          # if dependencies changed
npm run build
pm2 restart traverse
```

## Migrating from the old `atlas` process name

If you deployed before the brand rename, the pm2 app was called `atlas` and the env vars were `ATLAS_*`. One-time migration on the server:

```bash
pm2 delete atlas                # drop the old process
sed -i 's/^ATLAS_/TRAVERSE_/' .env  # rename env vars in place
git pull && npm install && npm run build
pm2 start ecosystem.config.cjs  # registers the new `traverse` process
pm2 save
```

## Useful PM2 commands

```bash
pm2 status           # check if running
pm2 logs traverse    # tail logs (includes provider banner + per-call token usage)
pm2 restart traverse    # restart after code changes
pm2 stop traverse    # stop
```

The startup banner lists which providers are wired and which features are available. Each AI call also emits a one-line `[ai] <label> <provider>/<model> — N in / N out (T turns, ms)` log so you can grep for total spend per feature. Transient API failures (network blips, 429 rate limits, 5xx) are retried with exponential backoff (3 attempts, 1s/2s/4s) and logged as `[retry] <label> attempt N/3 …`. Non-retriable errors (4xx other than 429, malformed responses) fail immediately.

## Notes

- **Geocode cache** (Nominatim) is in-memory and re-fetched on each restart. With ~30 trips at 1.1s each, warmup takes ~35s after restart. The app is functional immediately; the map markers fill in during warmup.
- **Image + route caches** (`.image-cache.json`, `.route-cache.json`) are on disk and survive restarts.
- **`.env` is gitignored** — never committed. Use `.env.example` as your template.
- **`home.md` is gitignored** — your personal preferences stay local. Use `home.example.md` as your template.
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

> **Note:** The startup banner (printed to the PM2 log on boot) reflects only `.env` state — it reads config before `settings.json` can be overlaid. The Settings page (`/settings`) shows what is actually effective for incoming requests.

**`TRAVERSE_DISABLE_SETTINGS_UI`** — set to any non-empty value to disable the `/settings` page and `POST /api/settings` entirely (both return 403). Recommended for production deployments where the server is reachable over an untrusted network and you prefer `.env`-only key management.

## Provider configuration (BYOK)

Traverse talks to model and search providers through a thin adapter layer. The defaults preserve the original Anthropic-only behavior, so existing deployments keep working without env changes. To switch providers, set the `TRAVERSE_*` variables in `.env`.

### What each feature needs

| Feature                    | Requires                                                |
| -------------------------- | ------------------------------------------------------- |
| Seed / Add (`+`, pin)      | `modelDefault` provider with valid key                  |
| Lock & generate itinerary  | `modelDefault` provider with valid key                  |
| Ask Field guide (planning chat) | `modelDefault` provider with valid key             |
| Retro on completion        | `modelDefault` provider with valid key                  |
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
| Per-feature    | `TRAVERSE_MODEL_<FEATURE>(_PROVIDER)?` | optional override; `<FEATURE>` ∈ `SEED`, `ADD`, `LOCK`, `CHAT`, `RETRO`, `DEEPEN` |

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
