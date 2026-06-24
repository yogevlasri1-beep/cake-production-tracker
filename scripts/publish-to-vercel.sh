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
echo "✓ נדחף ל-GitHub. Vercel יפרוס אוטומטית תוך 1–2 דקות (אם הפרויקט מחובר ל-GitHub)."
echo "  גרסה: $VER"
echo ""
echo "בדיקה: https://vercel.com/dashboard → Deployments → Ready"
echo "באייפון: https://YOUR-URL.vercel.app/?force-update=1"

if [[ "$MAKE_ZIP" -eq 1 ]]; then
  echo ""
  ./scripts/make-vercel-drop-zip.sh
  echo ""
  echo "אם השתמשת ב-Vercel Drop (לא GitHub): גרור את cake-production-tracker-vercel.zip ל-"
  echo "https://vercel.com/new/drop"
fi
