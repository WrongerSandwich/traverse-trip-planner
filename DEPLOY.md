# Deploying Atlas to a Home Server

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
git clone <your-repo-url> atlas
cd atlas

# 2. Configure your preferences
cp home.example.md home.md
# Edit home.md — set your home city/coords, traveler name(s), vehicle(s), and taste profile.
# This file drives all AI features; the more honest detail you add, the better the suggestions.

# 3. Set up your API keys
cp .env.example .env
# Edit .env — paste your ANTHROPIC_API_KEY and PEXELS_API_KEY.

# 4. Install dependencies and build
npm install
npm run build

# 5. Start with PM2
pm2 start ecosystem.config.cjs
pm2 save                        # persist across reboots
pm2 startup                     # enable auto-start (follow the printed command)
```

Atlas is now accessible on your LAN at `http://<server-ip>:3456`.

## Finding the server IP

```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
```

## Updating after changes

```bash
git pull
npm install          # if dependencies changed
npm run build
pm2 restart atlas
```

## Useful PM2 commands

```bash
pm2 status           # check if running
pm2 logs atlas       # tail logs
pm2 restart atlas    # restart after code changes
pm2 stop atlas       # stop
```

## Notes

- **Geocode cache** (Nominatim) is in-memory and re-fetched on each restart. With ~30 trips at 1.1s each, warmup takes ~35s after restart. The app is functional immediately; the map markers fill in during warmup.
- **Image + route caches** (`.image-cache.json`, `.route-cache.json`) are on disk and survive restarts.
- **`.env` is gitignored** — never committed. Use `.env.example` as your template.
- **`home.md` is gitignored** — your personal preferences stay local. Use `home.example.md` as your template.
- The `PEXELS_API_KEY` enables trip card photos. Without it, cards show a map thumbnail instead.

## Provider configuration (BYOK)

Atlas talks to model and search providers through a thin adapter layer. The defaults preserve the original Anthropic-only behavior, so existing deployments keep working without env changes. To switch providers, set the `ATLAS_*` variables in `.env`.

### What each feature needs

| Feature                    | Requires                                                |
| -------------------------- | ------------------------------------------------------- |
| Seed / Add (`+`, pin)      | `modelDefault` provider with valid key                  |
| Lock & generate itinerary  | `modelDefault` provider with valid key                  |
| Ask Claude (planning chat) | `modelDefault` provider with valid key                  |
| Research → (deepen)        | `modelResearch` provider with key **+** search backend  |

If a feature's backing provider isn't configured, its button is disabled in the UI with a tooltip pointing at `.env`. The startup banner (printed to the server log) lists which features are wired.

### Supported providers

| Slot           | Variable                            | Values                              |
| -------------- | ----------------------------------- | ----------------------------------- |
| Default model  | `ATLAS_MODEL_DEFAULT_PROVIDER`      | `anthropic` (default) · `openai`    |
| Default model  | `ATLAS_MODEL_DEFAULT`               | model id (e.g. `claude-sonnet-4-6`, `gpt-4o-mini`) |
| Research model | `ATLAS_MODEL_RESEARCH_PROVIDER`     | `anthropic` (default) · `openai`    |
| Research model | `ATLAS_MODEL_RESEARCH`              | tool-use-capable model id           |
| Search backend | `ATLAS_SEARCH_PROVIDER`             | `anthropic-builtin` (default) · `tavily` |

`anthropic-builtin` runs Anthropic's server-side `web_search` tool — only valid when the research model is also Anthropic. `tavily` is portable across any model provider but requires a `TAVILY_API_KEY`.

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

ATLAS_MODEL_DEFAULT_PROVIDER=openai
ATLAS_MODEL_DEFAULT=gpt-4o-mini
ATLAS_MODEL_RESEARCH_PROVIDER=openai
ATLAS_MODEL_RESEARCH=gpt-4o
ATLAS_SEARCH_PROVIDER=tavily
```

**Mixed (cheap default, smart research, portable search):**
```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
TAVILY_API_KEY=tvly-...
PEXELS_API_KEY=...

ATLAS_MODEL_DEFAULT_PROVIDER=openai
ATLAS_MODEL_DEFAULT=gpt-4o-mini
ATLAS_MODEL_RESEARCH_PROVIDER=anthropic
ATLAS_MODEL_RESEARCH=claude-opus-4-7
ATLAS_SEARCH_PROVIDER=tavily
```
