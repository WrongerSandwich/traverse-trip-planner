# Sample data

A small representative dataset for exploring Traverse without filling in your own trips first. The dataset is keyed to a fictional home base in Springfield, IL — short driving estimates are accurate for that origin and meaningless for any other.

## What's here

- `home.md` — sample personal-preferences file
- `ideas/` — three idea-stage trips of varying drive distance
- `planning/` — one researched planning trip (Starved Rock State Park)
- `completed/` — one completed trip with a retrospective (Madison, WI)

## Loading it

From the repo root, after `npm install`:

```bash
npm run seed-sample
```

This copies `sample-data/home.md` to `data/home.md` and the trip folders into `data/ideas/`, `data/planning/`, `data/completed/`. It will **not** overwrite an existing `data/home.md` or any trip whose slug already exists — re-running is safe.

## Removing it

The script doesn't track what it copied. To start fresh:

```bash
rm -rf data/home.md data/ideas data/planning data/completed
```

(The `data/` tree is gitignored, so you won't disturb the repo state.)

## Replacing it

The fastest way to make Traverse feel like *yours* is to replace `data/home.md` with your real home base + preferences (or work through the in-app onboarding flow), then use the **Seed** action on the home page to generate ideas tailored to you.
