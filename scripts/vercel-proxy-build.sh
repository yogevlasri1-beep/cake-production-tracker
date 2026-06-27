#!/usr/bin/env bash
# בונה פריסת Vercel שמעבירה הכל ל-GitHub Pages — בלי קבצים סטטיים ישנים.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PAGES_URL="${PAGES_URL:-https://yogevlasri1-beep.github.io/cake-production-tracker}"
OUT="$ROOT/dist-vercel"

rm -rf "$OUT"
mkdir -p "$OUT"

cat > "$OUT/vercel.json" << EOF
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

echo "✓ Vercel proxy → ${PAGES_URL} (dist-vercel/)"
