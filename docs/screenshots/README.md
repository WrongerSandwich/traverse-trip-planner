# Screenshots

Referenced from the project [README](../../README.md). When updating, keep filenames stable so the README's image references continue to resolve.

## Files

- `home.png` — home page with trip cards + interactive map
- `detail.png` — trip detail page in Read mode
- `brochure.png` — print-optimized brochure view (`/trips/<slug>/brochure`)
- `settings.png` — settings page with the Home base tab visible

## Capture conventions

- **2× retina** (browser DPR=2) so images render crisply on high-DPI displays.
- **Sample data first.** Run `npm run seed-sample` so trips look populated without exposing personal data. Restart the app after seeding.
- **Light mode** by default. Dark-mode shots can land as `*-dark.png` later if we add a dark-mode showcase.
- **Full viewport, no browser chrome.** Use the OS screenshot tool's window-clip or a browser extension that captures the page only.
- **Sweep for PII before saving** — home city, traveler names, receipt amounts, etc. The sample dataset is safe; your own data is not.
