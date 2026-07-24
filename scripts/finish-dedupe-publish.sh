#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
find . -type f \( -name '*.js' -o -name '*.html' \) ! -path './.git/*' ! -path './node_modules/*' ! -path './plugins/*' \
  -print0 | xargs -0 perl -pi -e 's/\?v=352\b/?v=353/g' || true
ruby scripts/verify-offline-assets.rb
./scripts/publish-to-vercel.sh "תיקון כפילויות סנכרון: fingerprint match + ניקוי ענן"
