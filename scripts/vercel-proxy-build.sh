#!/usr/bin/env bash
# בונה פריסת Vercel שמעבירה הכל ל-GitHub Pages — בלי קבצים סטטיים ישנים.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PAGES_URL="${PAGES_URL:-https://yogevlasri1-beep.github.io/cake-production-tracker}"
OUT="$ROOT/dist-vercel"

rm -rf "$OUT"
mkdir -p "$OUT"
touch "$OUT/.vercel-proxy"

echo "✓ Vercel proxy → ${PAGES_URL} (rewrites in root vercel.json)"
