#!/usr/bin/env bash
# מפעיל Deploy Hook ל-yogevcakee (אם VERCEL_DEPLOY_HOOK מוגדר).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HOOK="${VERCEL_DEPLOY_HOOK:-}"
if [[ -z "$HOOK" ]]; then
  echo "VERCEL_DEPLOY_HOOK לא מוגדר."
  echo "  1. Vercel → yogevcakee → Settings → Git → Deploy Hooks → Create (main)"
  echo "  2. GitHub → Settings → Secrets → VERCEL_DEPLOY_HOOK"
  echo "  3. או: VERCEL_DEPLOY_HOOK='https://...' $0"
  exit 1
fi

echo "→ מפעיל Deploy Hook..."
curl -fsS -X POST "$HOOK"
echo ""
echo "✓ Hook נשלח — המתן ~2 דקות"
echo "  בדיקה: ./scripts/verify-deploy.sh"
