#!/usr/bin/env bash
# בודק שהגרסה ב-Vercel וב-GitHub Pages תואמת ל-local.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOCAL=$(grep "APP_VERSION = '" js/version.js | sed "s/.*'\([^']*\)'.*/\1/")
VERCEL_URL="${VERCEL_URL:-https://yogevcakee.vercel.app}"
PAGES_URL="${PAGES_URL:-https://yogevlasri1-beep.github.io/cake-production-tracker}"

fetch_version() {
  local base="$1"
  local body
  body=$(curl -fsS -m 20 -H 'Cache-Control: no-cache' "${base}/js/version.js?b=$(date +%s)" 2>/dev/null || echo "")
  if echo "$body" | grep -q 'NOT_FOUND'; then
    echo "404"
    return
  fi
  echo "$body" | sed -n "s/.*APP_VERSION = '\([0-9]*\)'.*/\1/p" | head -1
}

VERCEL_VER=$(fetch_version "$VERCEL_URL" || echo "?")
PAGES_VER=$(fetch_version "$PAGES_URL" || echo "?")

echo "גרסה מקומית:  $LOCAL"
echo "GitHub Pages:  $PAGES_VER  ($PAGES_URL)"
echo "Vercel:        $VERCEL_VER  ($VERCEL_URL)"

OK=0
if [[ "$PAGES_VER" == "$LOCAL" ]]; then
  echo "✓ GitHub Pages מעודכן"
  OK=1
else
  echo "⚠ GitHub Pages לא מעודכן עדיין — המתן דקה ל-GitHub Actions"
fi

if [[ "$VERCEL_VER" == "$LOCAL" ]]; then
  echo "✓ Vercel מעודכן"
else
  if [[ "$VERCEL_VER" == "404" ]]; then
    echo "✗ Vercel מחזיר 404 — פריסה שבורה, צריך Deploy Hook או Drop (פעם אחת)"
  else
    echo "✗ Vercel לא מעודכן (מותקן ${VERCEL_VER:-?}, צפוי $LOCAL)"
  fi
  echo "  → פעם אחת: Deploy Hook (scripts/FIX-VERCEL.md) או Drop של proxy zip:"
  echo "     ./scripts/make-vercel-drop-zip.sh"
  echo "  → אחרי זה Vercel ישקף אוטומטית את GitHub Pages"
  echo "  → GitHub Pages (עובד עכשיו): $PAGES_URL"
fi

if [[ "$VERCEL_VER" == "$LOCAL" ]]; then
  exit 0
fi
exit 1
