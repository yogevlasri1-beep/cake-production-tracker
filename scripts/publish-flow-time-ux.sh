#!/usr/bin/env bash
# פרסום מהיר לתיקוני תזרים (זמן / סיום הכל / לחיצה)
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/bump-version.sh
./scripts/publish-to-vercel.sh "תזרים: פתיחה בלחיצה, סעיף זמן, ביטול זמני שלבים, סיום כל השלבים"
