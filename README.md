# Traverse

[![CI](https://github.com/WrongerSandwich/traverse/actions/workflows/ci.yml/badge.svg)](https://github.com/WrongerSandwich/traverse/actions/workflows/ci.yml)

A personal road-trip filing cabinet — managed through a web UI and an LLM. Trips live as markdown files that progress through a lifecycle: **idea → exploring → planning → completed**.

## What it does

- **Seed** — generate trip ideas based on your home base, taste, and constraints (uses an LLM)
- **Research** — flesh out an idea with live web-searched details: hours, prices, lodging, routes (uses an LLM + web search)
- **Plan** — edit trip sections in-browser, chat with the assistant to refine them, then lock the trip to generate a day-by-day itinerary
- **Retro** — when a trip is marked completed, an AI-prompted Q&A writes a `notes.md` retrospective (rating, highlights, would-do-again) you can revisit later
- **Map** — all trips rendered on an interactive map with drive-time routing
- **Filter** — by stage, drive time, cost tier, NPS units, bookmarks
- **Calendar** — subscribe to `/api/cal.ics` from Google/Apple/Outlook to see planned trips on your calendar; per-trip feed at `/api/cal/<slug>.ics`

All trip data is plain markdown on disk — readable, portable, and easy to edit directly.

## Self-hosting

Traverse is designed to be self-hosted. You bring your own API keys; nothing is shared.

**Requirements:**
- Node.js 20+
- A model provider API key — [Anthropic](https://console.anthropic.com/) or [OpenAI](https://platform.openai.com/) (for AI features)
- A [Pexels API key](https://www.pexels.com/api/) (free, for trip card photos)
- *Optional:* a [Tavily](https://tavily.com/) API key — required only if you use a non-Anthropic model and want the `Research →` (deepen) feature

See **[DEPLOY.md](DEPLOY.md)** for full setup instructions, including provider switching.

## Quick start

```bash
git clone <repo-url> traverse && cd traverse
cp home.example.md home.md   # edit with your home city, vehicles, taste
cp .env.example .env         # edit with your API keys
npm install
npm run smoke                # optional: 1-token round-trip per provider
npm run build
node build/index.js
```

Open `http://localhost:3456`.

## Trip data

Trips are markdown files organized by stage:

```
ideas/          # single .md files — lightly sketched
exploring/      # folders with overview.md + research files
planning/       # concrete dates, lodging, edits in progress
completed/      # archived with itinerary intact
archived/       # hidden from UI; excluded from re-suggestion
```

Your personal preferences live in `home.md` (gitignored — see `home.example.md`). This file drives all AI prompts: home location, vehicle specs, taste profile, seasonal constraints.

## Tech

SvelteKit · Leaflet · OSRM (routing) · Nominatim (geocoding) · Pexels (photos). AI calls go through a provider-agnostic adapter — Anthropic and OpenAI are supported out of the box. See [DEPLOY.md](DEPLOY.md#provider-configuration-byok).

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and conventions; [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

MIT — see [LICENSE](LICENSE).
