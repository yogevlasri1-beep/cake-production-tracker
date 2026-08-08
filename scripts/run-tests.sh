#!/usr/bin/env bash
# מריץ את שתי חבילות הבדיקות (יחידה + אינטגרציה עם IndexedDB אמיתי) בכרום headless מקומי.
# לעולם לא מול production — שרת סטטי מקומי בלבד.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${TEST_PORT:-8791}"
node scripts/run-tests.mjs "$PORT"
