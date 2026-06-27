#!/usr/bin/env bash
# העלאת שינויים ל-Vercel דרך GitHub (push → deploy אוטומטי).
# שימוש:
#   ./scripts/publish-to-vercel.sh "תיאור השינוי"
#   ./scripts/publish-to-vercel.sh --drop "תיאור"   # גם zip ל-Vercel Drop
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MAKE_ZIP=0
MSG=""
for arg in "$@"; do
  if [[ "$arg" == "--drop" ]]; then
    MAKE_ZIP=1
  elif [[ -z "$MSG" ]]; then
    MSG="$arg"
  fi
done
MSG="${MSG:-Update app}"

if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  ruby scripts/verify-offline-assets.rb
  git add -A
  git commit -m "$MSG"
else
  echo "אין שינויים חדשים לשמור."
fi

echo ""
echo "→ דוחף ל-GitHub (main)..."
git push origin main

VER=$(grep "APP_VERSION = '" js/version.js | sed "s/.*'\([^']*\)'.*/\1/")
echo ""
echo "✓ נדחף ל-GitHub. GitHub Pages יתעדכן תוך ~1 דקה."
echo "  גרסה: $VER"
echo ""
echo "→ ממתין ל-GitHub Pages..."
sleep 45
if ./scripts/verify-deploy.sh; then
  echo ""
  echo "✓ פריסה תקינה"
else
  echo ""
  echo "⚠️ Vercel לא מקבל push מ-GitHub — השתמש ב-GitHub Pages (מעודכן):"
  echo "  https://yogevlasri1-beep.github.io/cake-production-tracker/"
fi
echo ""
echo "בדיקה: https://vercel.com/dashboard → Deployments → Ready"
echo "GitHub Pages: https://yogevlasri1-beep.github.io/cake-production-tracker/?force-update=1"
echo "Vercel:       https://cake-production-tracker.vercel.app/?force-update=1"

if [[ "$MAKE_ZIP" -eq 1 ]]; then
  echo ""
  ./scripts/make-vercel-drop-zip.sh
  echo ""
  echo "אם השתמשת ב-Vercel Drop (לא GitHub): גרור את cake-production-tracker-vercel.zip ל-"
  echo "https://vercel.com/new/drop"
fi
