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
# עדכון ?v= בכל קבצי JS/HTML (בלי glob שבור שיכול לדלג בשקט)
while IFS= read -r -d '' f; do
  perl -pi -e "s/\?v=\d+/?v=$NEXT/g" "$f"
done < <(find js tests -type f \( -name '*.js' -o -name '*.html' \) -print0; printf '%s\0' index.html)

# הוספת ?v= לייבואים בלי cache-bust
while IFS= read -r -d '' f; do
  perl -pi -e "s/(from\s+(['\"]))(\.\.?\/(?:(?!\2).)+?\.js)(?!\?v=\d+)\2/\$1\$3?v=$NEXT\$2/g" "$f"
done < <(find js tests -type f -name '*.js' -print0)

SW_VER=$(grep "const VERSION = '" sw.js | sed "s/.*'\([^']*\)'.*/\1/")
APP_VER=$(grep "APP_VERSION = '" js/version.js | sed "s/.*'\([^']*\)'.*/\1/")
if [[ "$SW_VER" != "$APP_VER" ]]; then
  echo "❌ אי-התאמה: sw.js=$SW_VER, version.js=$APP_VER"
  exit 1
fi

# וידוא שאין ייבואים עם ?v= ישן (שני מופעי db.js שוברים טרנזקציות / איחוד)
STALE=$(grep -R -n -E '\?v=[0-9]+' js tests index.html --include='*.js' --include='*.html' 2>/dev/null \
  | grep -v "?v=${NEXT}" || true)
if [[ -n "${STALE}" ]]; then
  echo "❌ נשארו ייבואים עם גרסת cache ישנה (צפוי ?v=$NEXT):"
  echo "$STALE" | head -40
  exit 1
fi

if command -v ruby >/dev/null 2>&1; then
  ruby scripts/verify-offline-assets.rb
else
  node -e '
    const fs=require("fs");
    const sw=fs.readFileSync("sw.js","utf8");
    const m=sw.match(/const PRECACHE = \[([\s\S]*?)\];/);
    if(!m){console.error("❌ אין PRECACHE");process.exit(1)}
    const paths=[...m[1].matchAll(/(?:v\?\(\s*["'\''])(\.\/[^"'\'']+)|["'\''](\.\/[^"'\'']+)/g)]
      .map(x=>x[1]||x[2]).filter(p=>!p.endsWith("/")).map(p=>p.replace(/^\.\//,""));
    const uniq=[...new Set(paths)];
    const missing=uniq.filter(p=>!fs.existsSync(p));
    if(missing.length){console.error("❌ קבצים חסרים ל-offline:",missing);process.exit(1)}
    console.log("✅",uniq.length,"קבצים מוכנים ל-offline");
  '
fi
echo "✓ גרסה $NEXT מוכנה. הרץ: ./scripts/publish-to-vercel.sh \"תיאור השינוי\""
