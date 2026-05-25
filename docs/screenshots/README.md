# Screenshots

Referenced from the project [README](../../README.md). Keep the filenames stable so the README's image references continue to resolve.

## Files

- `home.png` — home page with trip cards + interactive map
- `detail.png` — trip detail page (any planning-stage trip; sections visible)
- `brochure.png` — print-optimized brochure view (`/trips/<slug>/brochure`)
- `home-base.png` — `/home-base` (the `home.md` profile editor)

Optional companions for later — not currently linked from the README:

- `configuration.png` — `/configuration` (provider keys + model routing)
- `*-dark.png` — dark-mode variants if/when we add a dark-mode showcase

## Capture conventions

- **2× retina** (browser DPR=2) so images render crisply on high-DPI displays.
- **Sample data first.** Run `npm run seed-sample` so trips look populated without exposing personal trips. The sample dataset writes into `data/` (which is gitignored) — your own trips and `home.md` stay out of the captured frame.
- **Light mode** by default. Use the OS appearance setting; the app follows it.
- **Full viewport, no browser chrome.** The OS screenshot tool's window-clip or a "capture page" browser extension both work.
- **Sweep for PII before saving.** The sample data is safe; any captures showing your own `home.md`, real trip names, or completed-trip receipts are not. The Home base shot is the highest-risk frame — capture it against a seeded `home.md` or redact before committing.
- **Keep each file under ~2 MB.** Downscale or convert to lossy PNG-8 / WebP if a fresh capture overshoots.
