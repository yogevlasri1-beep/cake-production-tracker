#!/usr/bin/env bash
# Zip proxy-only deploy for Vercel Drop — mirrors GitHub Pages (לא עותק סטטי).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/cake-production-tracker-vercel.zip"
cd "$ROOT"
bash scripts/vercel-proxy-build.sh
rm -f "$OUT"
(cd dist-vercel && zip -r "$OUT" .)
echo "Created: $OUT (proxy → GitHub Pages)"
echo "Open https://vercel.com/new/drop → גרור ל-yogevcakee או פרויקט חדש"
echo "אחרי Drop אחד: Vercel יתעדכן אוטומטית עם כל push ל-GitHub Pages"
