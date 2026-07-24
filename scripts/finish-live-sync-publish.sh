#!/usr/bin/env bash
# Complete publish for live-sync release (version already set to 352).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Ensure remaining cache-bust strings
find . -type f \( -name '*.js' -o -name '*.html' \) ! -path './.git/*' ! -path './node_modules/*' ! -path './plugins/*' \
  -print0 | xargs -0 perl -pi -e 's/\?v=351\b/?v=352/g' || true
ruby scripts/verify-offline-assets.rb
./scripts/publish-to-vercel.sh "סנכרון חי Supabase: טבלאות sync_* + מנוע סנכרון בין מכשירים"
