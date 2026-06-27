#!/usr/bin/env bash
# Zip proxy-only deploy for Vercel Drop — רק vercel.json (rewrites ל-GitHub Pages).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/cake-production-tracker-vercel.zip"
PAGES_URL="${PAGES_URL:-https://yogevlasri1-beep.github.io/cake-production-tracker}"
TMP="$ROOT/dist-vercel-drop"
rm -rf "$TMP" "$OUT"
mkdir -p "$TMP"
cat > "$TMP/vercel.json" << EOF
{
  "\$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    {
      "source": "/:path*",
      "destination": "${PAGES_URL}/:path*"
    }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "no-store, no-cache, must-revalidate" }
      ]
    }
  ]
}
EOF
(cd "$TMP" && zip -r "$OUT" vercel.json)
rm -rf "$TMP"
echo "Created: $OUT (proxy → GitHub Pages, ללא build)"
echo "Vercel Drop → yogevcakee → גרור zip → Deploy"
