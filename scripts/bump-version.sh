#!/usr/bin/env bash
# מעלה מספר גרסה בכל הקבצים הרלוונטיים (cache bust + PWA).
# שימוש: ./scripts/bump-version.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CURRENT=$(grep "APP_VERSION = '" js/version.js | sed "s/.*'\([^']*\)'.*/\1/")
NEXT=$((10#$CURRENT + 1))

echo "גרסה $CURRENT → $NEXT"

perl -pi -e "s/export const APP_VERSION = '$CURRENT'/export const APP_VERSION = '$NEXT'/" js/version.js
perl -pi -e "s/const VERSION = '$CURRENT'/const VERSION = '$NEXT'/" sw.js
perl -pi -e "s/window.__APP_BUILD__ = '$CURRENT'/window.__APP_BUILD__ = '$NEXT'/" index.html
perl -pi -e "s/styles\.css\?v=$CURRENT/styles.css?v=$NEXT/" index.html
perl -pi -e "s/\?v=$CURRENT/?v=$NEXT/g" js/**/*.js js/*.js index.html tests/*.html tests/*.js 2>/dev/null || true

ruby scripts/verify-offline-assets.rb
echo "✓ גרסה $NEXT מוכנה. הרץ: ./scripts/publish-to-vercel.sh \"תיאור השינוי\""
