#!/usr/bin/env bash
#
# new-worktree.sh — spin up a ready-to-work git worktree for Traverse.
#
# Does the four things a fresh `git worktree add` does NOT do for you, each of
# which has bitten us before:
#   1. Puts the worktree at a NON-HIDDEN path. svelte-check silently checks
#      0 FILES (vacuously green) when any parent dir is dot-prefixed, e.g.
#      .claude/worktrees/* — so `npm run check` passes without checking anything.
#   2. Symlinks node_modules from the main checkout (a bare worktree has none;
#      `npm install` per worktree is slow and mutates a tree others share).
#   3. Symlinks your dev credentials in as .env (gitignored secrets don't travel
#      into a worktree), so `npm run smoke` and `npm run dev` have keys.
#   4. Runs `svelte-kit sync` so .svelte-kit/tsconfig.json exists.
#
# Usage:
#   scripts/new-worktree.sh <name> [--branch <branch>] [--base <ref>] [--seed]
#
#   <name>          short name → worktree dir + (default) branch name
#   --branch, -b    branch to create (default: <name>)
#   --base          base ref to branch from (default: main)
#   --seed          also run `npm run seed-sample` (demo trips for manual UI QA)
#   --help, -h      show this help
#
# Env overrides:
#   TRAVERSE_WT_DIR    parent dir for worktrees   (default: <repo>/../traverse-wt)
#   TRAVERSE_DEV_ENV   dev credentials file       (default: ~/.config/traverse/dev.env)
#
# Examples:
#   scripts/new-worktree.sh fix-geocode
#   scripts/new-worktree.sh receipts --branch feat/receipts-revival --base main --seed
#
set -euo pipefail

# ── Resolve repo root from this script's location ─────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && git rev-parse --show-toplevel)"

# ── Defaults ──────────────────────────────────────────────────────────────────
WT_DIR="${TRAVERSE_WT_DIR:-$(cd "$REPO_ROOT/.." && pwd)/traverse-wt}"
DEV_ENV="${TRAVERSE_DEV_ENV:-$HOME/.config/traverse/dev.env}"
DEV_ENV_EXAMPLE="$REPO_ROOT/scripts/dev.env.example"

NAME=""
BRANCH=""
BASE="main"
SEED=0

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

show_help() { sed -n '3,40p' "$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")" | sed 's/^# \{0,1\}//'; exit 0; }

# ── Parse args ────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) show_help ;;
    -b|--branch) BRANCH="${2:-}"; shift 2 || die "--branch needs a value" ;;
    --base)      BASE="${2:-}";   shift 2 || die "--base needs a value" ;;
    --seed)      SEED=1; shift ;;
    -*)          die "unknown flag: $1" ;;
    *)           [ -z "$NAME" ] || die "unexpected extra argument: $1"; NAME="$1"; shift ;;
  esac
done

[ -n "$NAME" ] || die "missing <name>. Try: scripts/new-worktree.sh --help"
BRANCH="${BRANCH:-$NAME}"
WT_PATH="$WT_DIR/$NAME"

# ── Guard: reject hidden (dot-prefixed) path segments (the svelte-check trap) ──
case "/$WT_PATH/" in
  */.*/) die "worktree path '$WT_PATH' contains a hidden (dot-prefixed) directory.
       svelte-check silently checks 0 files under such paths. Pick a non-hidden
       location (set TRAVERSE_WT_DIR) and retry." ;;
esac

[ ! -e "$WT_PATH" ] || die "path already exists: $WT_PATH"

# ── Create the worktree ───────────────────────────────────────────────────────
echo "→ git worktree add -b $BRANCH $WT_PATH $BASE"
git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WT_PATH" "$BASE"

# ── 2. node_modules symlink ───────────────────────────────────────────────────
if [ -d "$REPO_ROOT/node_modules" ]; then
  ln -s "$REPO_ROOT/node_modules" "$WT_PATH/node_modules"
  echo "✓ node_modules → symlinked from main checkout"
else
  echo "⚠ $REPO_ROOT/node_modules not found — run 'npm install' in the main checkout first"
fi

# ── 3. dev credentials → .env ─────────────────────────────────────────────────
if [ ! -e "$DEV_ENV" ]; then
  echo "⚠ dev credentials file not found at: $DEV_ENV"
  if [ -f "$DEV_ENV_EXAMPLE" ]; then
    mkdir -p "$(dirname "$DEV_ENV")"
    cp "$DEV_ENV_EXAMPLE" "$DEV_ENV"
    echo "  scaffolded a template there from scripts/dev.env.example — fill it in,"
    echo "  then re-run this script (or symlink it yourself) to get keys in the worktree."
  fi
fi
if [ -e "$DEV_ENV" ]; then
  ln -s "$DEV_ENV" "$WT_PATH/.env"
  echo "✓ .env → symlinked from $DEV_ENV"
else
  echo "⚠ no .env linked — smoke/dev server will run keyless in this worktree"
fi

# ── 4. svelte-kit sync ────────────────────────────────────────────────────────
echo "→ svelte-kit sync"
( cd "$WT_PATH" && npx --no-install svelte-kit sync >/dev/null 2>&1 ) \
  && echo "✓ .svelte-kit synced" \
  || echo "⚠ svelte-kit sync failed — run 'npx svelte-kit sync' in the worktree"

# ── optional: seed demo trips for manual UI QA ────────────────────────────────
if [ "$SEED" -eq 1 ]; then
  echo "→ npm run seed-sample (demo trips)"
  ( cd "$WT_PATH" && npm run --silent seed-sample ) \
    && echo "✓ sample data seeded" \
    || echo "⚠ seed-sample failed — run 'npm run seed-sample' in the worktree"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
cat <<EOF

Worktree ready:
  path    $WT_PATH
  branch  $BRANCH  (from $BASE)

Next:
  cd $WT_PATH
  npm run verify        # svelte-check (confirm a NON-ZERO file count) → vitest → build
  npm run dev -- --port 3456   # manual / Playwright QA
  npm run smoke         # provider round-trip (needs a filled $DEV_ENV)

Tear down when the branch is merged:
  git -C $REPO_ROOT worktree remove $WT_PATH
EOF
