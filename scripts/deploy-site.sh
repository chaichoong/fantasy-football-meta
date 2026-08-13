#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# Deploy the site to Cloudflare Pages from a STAGED copy.
#
# Why staged and not the repo root: Pages serves whatever you hand it, and
# handing it the repo root published README.md, ROADMAP.md and relay/worker.js
# on the live domain. ROADMAP.md is the internal plan. It names the blockers
# before charging, the trademark reasoning and the data-licence position. That
# is not something to serve to a visitor at a guessable URL.
#
# So this builds a directory containing ONLY what a visitor should get, and
# deploys that. Add new public pages to PUBLIC_FILES below or they will not ship.
#
# Usage:  ./scripts/deploy-site.sh
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

PUBLIC_FILES=(
  index.html
  how-it-works.html
  privacy.html
  terms.html
  stats.html
)
PUBLIC_DIRS=(css js)

for f in "${PUBLIC_FILES[@]}"; do
  [ -f "$ROOT/$f" ] || { echo "MISSING public file: $f" >&2; exit 1; }
  cp "$ROOT/$f" "$STAGE/"
done
for d in "${PUBLIC_DIRS[@]}"; do
  [ -d "$ROOT/$d" ] || { echo "MISSING public dir: $d" >&2; exit 1; }
  cp -R "$ROOT/$d" "$STAGE/"
done

# Guard: nothing internal may ever reach the staged copy.
if find "$STAGE" \( -name "*.md" -o -name "worker.js" -o -name "wrangler.toml" \) | grep -q .; then
  echo "REFUSING to deploy: internal file found in the staged copy" >&2
  find "$STAGE" \( -name "*.md" -o -name "worker.js" -o -name "wrangler.toml" \) >&2
  exit 1
fi

echo "Staged $(find "$STAGE" -type f | wc -l | tr -d ' ') files for deploy."

export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-$(cat ~/.config/od/cloudflare_token)}"
npx wrangler pages deploy "$STAGE" --project-name fantasy-football-meta --commit-dirty=true
