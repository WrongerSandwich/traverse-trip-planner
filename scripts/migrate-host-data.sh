#!/usr/bin/env bash
# Pre-#411 host-side migration. Moves legacy root-level trip data, home.md,
# settings.json, and .cache/ into ./data/ so the new single Docker bind mount
# (./data:/app/data) can see everything.
#
# Run from the repo root, on the HOST, BEFORE `docker compose up`:
#   ./scripts/migrate-host-data.sh
#
# Idempotent and safe to re-run. Does nothing if there's no legacy state to
# move. Aborts on the first error rather than leaving you with half a migration.
#
# Why this script exists: the in-container migration shim
# (src/lib/server/migrate-to-data-dir.js) handles the bare-metal `node build`
# case fine, but post-#411 the new docker-compose.yml only mounts ./data —
# the legacy host paths (./ideas, ./planning, …) are no longer visible inside
# the container, so the in-container shim can't reach them. This script
# bridges that gap.

set -euo pipefail

LEGACY_NAMES=(
  ideas
  planning
  completed
  archived
  home.md
  settings.json
  .cache
)

# Refuse to do anything destructive if we're not in the repo root.
if [[ ! -f docker-compose.yml || ! -d src ]]; then
  echo "error: run this from the traverse repo root (the dir that has docker-compose.yml and src/)" >&2
  exit 1
fi

# Build the list of legacy entries actually present at the root.
present=()
for name in "${LEGACY_NAMES[@]}"; do
  [[ -e "$name" ]] && present+=("$name")
done

if (( ${#present[@]} == 0 )); then
  echo "Nothing to migrate — no legacy root-level data found. Safe to 'docker compose up'."
  exit 0
fi

mkdir -p data

moved=()
for name in "${present[@]}"; do
  dest="data/$name"
  if [[ -e "$dest" ]]; then
    echo "  skip   $name (already exists at data/$name — manual review recommended)"
    continue
  fi
  echo "  move   $name → data/$name"
  mv -- "$name" "$dest"
  moved+=("$name")
done

echo
echo "Done. Moved ${#moved[@]} entries into data/."
echo "Next: docker compose up -d --build"
