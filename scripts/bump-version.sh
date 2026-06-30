#!/usr/bin/env bash
# מעלה מספר גרסה בכל הקבצים הרלוונטיים (cache bust + PWA).
# שימוש: ./scripts/bump-version.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CURRENT=$(grep "APP_VERSION = '" js/version.js | sed "s/.*'\([^']*\)'.*/\1/")
NEXT=$((10#$CURRENT + 1))

echo "גרסה $CURRENT → $NEXT"

perl -pi -e "s/export const APP_VERSION = '\d+'/export const APP_VERSION = '$NEXT'/" js/version.js
perl -pi -e "s/const VERSION = '\d+'/const VERSION = '$NEXT'/" sw.js
perl -pi -e "s/window.__APP_BUILD__ = '\d+'/window.__APP_BUILD__ = '$NEXT'/" index.html
perl -pi -e "s/styles\.css\?v=\d+/styles.css?v=$NEXT/" index.html
perl -pi -e "s/\?v=\d+/?v=$NEXT/g" js/**/*.js js/*.js index.html tests/*.html tests/*.js 2>/dev/null || true
perl -pi -e "s/(from\s+(['\"]))(\.\.?\/(?:(?!\2).)+?\.js)(?!\?v=\d+)\2/\$1\$3?v=$NEXT\$2/g" js/*.js js/**/*.js tests/*.js 2>/dev/null || true

SW_VER=$(grep "const VERSION = '" sw.js | sed "s/.*'\([^']*\)'.*/\1/")
APP_VER=$(grep "APP_VERSION = '" js/version.js | sed "s/.*'\([^']*\)'.*/\1/")
if [[ "$SW_VER" != "$APP_VER" ]]; then
  echo "❌ אי-התאמה: sw.js=$SW_VER, version.js=$APP_VER"
  exit 1
fi

ruby scripts/verify-offline-assets.rb
echo "✓ גרסה $NEXT מוכנה. הרץ: ./scripts/publish-to-vercel.sh \"תיאור השינוי\""
