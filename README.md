# Atlas

A personal travel filing cabinet — road trips and fly-in destinations — managed through a web UI and Claude. Trips live as markdown files that progress through a lifecycle: **idea → exploring → planning → completed**.

## What it does

- **Seed** — generate trip ideas based on your home base, taste, and constraints (uses Claude)
- **Research** — flesh out an idea with live web-searched details: hours, prices, lodging, routes (uses Claude + web search)
- **Plan** — edit trip sections in-browser, chat with Claude to refine them, then lock the trip to generate a day-by-day itinerary
- **Map** — all trips rendered on an interactive map with drive-time routing
- **Filter** — by stage, drive time, cost tier, fly vs. drive, NPS units, bookmarks

All trip data is plain markdown on disk — readable, portable, and easy to edit directly.

## Self-hosting

Atlas is designed to be self-hosted. You bring your own API keys; nothing is shared.

**Requirements:**
- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com/) (for AI features)
- A [Pexels API key](https://www.pexels.com/api/) (free, for trip card photos)

See **[DEPLOY.md](DEPLOY.md)** for full setup instructions.

## Quick start

```bash
git clone <repo-url> atlas && cd atlas
cp home.example.md home.md   # edit with your home city, vehicles, taste
cp .env.example .env         # edit with your API keys
npm install && npm run build
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

SvelteKit · Leaflet · OSRM (routing) · Nominatim (geocoding) · Pexels (photos) · Anthropic Claude
