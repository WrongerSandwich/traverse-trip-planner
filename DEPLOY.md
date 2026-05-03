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
- The `ANTHROPIC_API_KEY` enables the in-browser "Add trips" (seed) and "Research →" (deepen) buttons. Without it, those buttons will fail with a clear error.
- The `PEXELS_API_KEY` enables trip card photos. Without it, cards show a map thumbnail instead.
