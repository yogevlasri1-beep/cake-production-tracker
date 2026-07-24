#!/usr/bin/env bashexport PATH="$HOME/.local/bin:$PATH"
cd ~/Projects/cake-production-tracker
gh auth status
git push origin main
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd "$HOME/Projects/cake-production-tracker"

echo "=== אימות GitHub ואז פרסום ==="
echo "1) יופיע קוד בפורמט XXXX-XXXX — העתק אותו"
echo "2) היכנס ל־https://github.com/login/device"
echo "3) הדבק את הקוד ואשר"
echo ""

if ! command -v gh >/dev/null 2>&1; then
  echo "✗ gh לא מותקן ב־$PATH"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  gh auth login --hostname github.com --git-protocol https --web
fi

gh auth setup-git
echo ""
echo "→ דוחף ל־GitHub (main)..."
git push origin main
echo ""
echo "✓ פורסם בהצלחה"
git status -sb
echo ""
echo "אפשר לסגור חלון זה"
