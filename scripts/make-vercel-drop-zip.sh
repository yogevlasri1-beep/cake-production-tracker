#!/usr/bin/env bash
# Zip static app files for Vercel Drop (drag-and-drop deploy, no Git needed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/cake-production-tracker-vercel.zip"
cd "$ROOT"
rm -f "$OUT"
zip -r "$OUT" . \
  -x 'node_modules/*' \
  -x 'ios/*' \
  -x '.git/*' \
  -x '.DS_Store' \
  -x '*.local' \
  -x '.env*' \
  -x 'cake-production-tracker-vercel.zip'
echo "Created: $OUT"
echo "Open https://vercel.com/new/drop and drag this zip onto the page."
