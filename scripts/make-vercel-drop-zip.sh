#!/usr/bin/env bash
# Zip static app for Vercel Drop — פריסה מלאה (לא proxy).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/cake-production-tracker-vercel.zip"
cd "$ROOT"
rm -f "$OUT"
zip -r "$OUT" . \
  -x 'node_modules/*' \
  -x 'ios/*' \
  -x '.git/*' \
  -x '.github/*' \
  -x 'dist-vercel/*' \
  -x 'dist-vercel-drop/*' \
  -x '.DS_Store' \
  -x '*.local' \
  -x '.env*' \
  -x 'cake-production-tracker-vercel.zip' \
  -x 'scripts/*' \
  -x 'tests/*' \
  -x 'plugins/*'
echo "Created: $OUT"
echo "→ Vercel Dashboard → yogevcakee → Deployments → ⋯ → Redeploy"
echo "→ או: https://vercel.com/new/drop — גרור את ה-zip"
