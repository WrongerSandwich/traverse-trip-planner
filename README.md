# Traverse

[![CI](https://github.com/WrongerSandwich/traverse-trip-planner/actions/workflows/ci.yml/badge.svg)](https://github.com/WrongerSandwich/traverse-trip-planner/actions/workflows/ci.yml)

A self-hosted road-trip filing cabinet. Trips live as plain markdown files, progressing through a lifecycle: **idea → planning → completed**. An LLM helps generate, research, and reflect on them — but the data is yours, on your disk, in a format you can read and grep without the app running.

> Built to be lived in, not to be sold. Stable enough for daily personal use, rough enough that you'll want to be the kind of person who's comfortable editing the markdown directly when something gets weird.

## Why this exists

There are plenty of fancier travel apps. Almost all of them treat your trips as rows in their database, your photos as content for their feed, and your destination history as something to monetize. Traverse takes the opposite bet: trips are markdown, your `home.md` is your taste preferences in plain English, and AI is a useful tool wired into the workflow — not the workflow itself.

The mental model is closer to a personal wiki than a SaaS app. The LLM is fast at generating regional ideas, fleshing out routes, and parsing a long planning thread into a printable brochure; you stay in control of what actually goes into the file. See [docs/product.md](docs/product.md) for the longer design rationale.

## What it does

- **Seed** — generate trip ideas based on your home base, taste, and constraints (uses an LLM)
- **Research** — flesh out an idea with live web-searched details: hours, prices, lodging, routes (uses an LLM + web search)
- **Plan** — edit prose sections (Overview, Route, Logistics) in-browser, chat with the Field guide (Cmd-K) to refine them, and arrange day-by-day stops + lodging via the structured Plan and Candidates UI
- **Retro** — when a trip is marked completed, an AI-prompted Q&A writes a `notes.md` retrospective (rating, highlights, would-do-again) you can revisit later
- **Map** — all trips rendered on an interactive map with drive-time routing
- **Filter** — by stage, drive time, cost tier, NPS units, bookmarks
- **Calendar** — subscribe to `/api/cal.ics` from Google/Apple/Outlook to see planned trips on your calendar; per-trip feed at `/api/cal/<slug>.ics`

All trip data is plain markdown on disk — readable, portable, and easy to edit directly.

## Self-hosting

Traverse is designed to be self-hosted. You bring your own API keys; nothing is shared.

**You'll need:**
- A model provider API key — [Anthropic](https://console.anthropic.com/), [OpenAI](https://platform.openai.com/), or [OpenRouter](https://openrouter.ai) (one key, many models)
- A [Pexels API key](https://www.pexels.com/api/) (free, for trip card photos)
- *Optional:* a [Tavily](https://tavily.com/) API key — required only if you use a non-Anthropic research model and want `Research →`

Docker is the canonical deployment. See **[docs/deploy.md](docs/deploy.md)** for the full walkthrough.

## Configure Traverse

Two ways to configure — pick whichever fits your workflow. Both use Docker; both are first-class.

### Path A — Click through setup (NAS / homelab)

For when you'd rather configure from a browser than edit files:

```bash
git clone <repo-url> traverse && cd traverse
cp .env.example .env         # leave keys commented; set UID/GID if your host user isn't uid 1000
docker compose up -d --build
```

Open `http://<server-ip>:3456/configuration`, paste your API keys, save. Then go through the in-app onboarding to set up your home base (`/home-base`). **You won't need to edit `.env` again.** (`/settings` is preserved as a 308 redirect to `/home-base` for old bookmarks.)

### Path B — Infra-as-code / secrets manager

For when secrets come from Vault, sealed-secrets, Doppler, GitHub Actions, etc.:

```bash
git clone <repo-url> traverse && cd traverse
# Generate .env from your secrets pipeline with ANTHROPIC_API_KEY (or OPENAI_API_KEY /
# OPENROUTER_API_KEY), PEXELS_API_KEY, and TRAVERSE_DISABLE_SETTINGS_UI=1 to lock the
# runtime UI off.
docker compose up -d --build
```

Rotate keys via your existing pipeline. **You don't need to open `/configuration`.**

---

Both paths land you at `http://<server-ip>:3456`. The full table of what can live in `.env` vs. `data/settings.json` is in [docs/deploy.md → Configuration reference](docs/deploy.md#configuration-reference).

Running outside Docker (Node 20+ directly) is supported for development; see [docs/deploy.md](docs/deploy.md) and [CONTRIBUTING.md](CONTRIBUTING.md) for the manual path.

## Trip data

Trips are markdown files organized by stage under `data/`:

```
data/
├── ideas/          # single .md files — lightly sketched
├── planning/       # folders with overview.md + research files; dates, lodging, edits
├── completed/      # archive with retrospective in notes.md
├── archived/       # hidden from UI; excluded from re-suggestion
├── home.md         # your personal preferences — drives every AI prompt
├── settings.json   # runtime-editable provider keys + feature flags
└── .cache/         # geocode / image / route caches; safe to delete
```

The `data/` directory is **gitignored** — it holds your personal trips and runtime state, not project source. A bundled demo dataset under `sample-data/` is available via `npm run seed-sample`; see [sample-data/README.md](sample-data/README.md) for details.

Your personal preferences live in `data/home.md`. The in-app onboarding flow creates it on first run; from there, the Settings page lets you edit home location, vehicles, taste profile, and seasonal constraints. This file drives all AI prompts.

## Tech

SvelteKit · Leaflet · OSRM (routing) · Nominatim (geocoding) · Pexels (photos). AI calls go through a provider-agnostic adapter — Anthropic and OpenAI are supported out of the box. See [docs/deploy.md](docs/deploy.md#provider-configuration-byok).

## Status

Used daily by the original author; published as open source for anyone who wants the same approach for their own trips. The single-user, self-hosted shape is the design center — multi-user accounts, hosted plans, and integrations beyond the listed providers are explicit non-goals. Expect rough edges and `home.md`-heavy assumptions; PRs that respect the philosophy are welcome.

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and conventions; [SECURITY.md](SECURITY.md) for vulnerability reporting; [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards.

## License

MIT — see [LICENSE](LICENSE).
