#!/bin/bash
# בדיקת חיבור רשת לאייפון — מריץ במחשב Mac

cd "$(dirname "$0")/.." || exit 1
PORT=8765
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)

echo ""
echo "══════════════════════════════════════"
echo "  בדיקת רשת — מעקב יצור"
echo "══════════════════════════════════════"
echo ""

if [ -z "$IP" ]; then
  echo "❌ Mac לא מחובר ל-Wi‑Fi"
  exit 1
fi

if ! curl -sf "http://127.0.0.1:${PORT}/" >/dev/null; then
  echo "❌ השרver לא רץ על פורט ${PORT}"
  echo "   הרץ: ./scripts/start-for-iphone.sh"
  exit 1
fi

echo "✅ השרver רץ במחשב"
echo ""
echo "  כתובת לאייפון (Safari):"
echo "  http://${IP}:${PORT}"
echo ""
echo "  בדיקות:"
curl -sf -o /dev/null -w "  • דף ראשי: %{http_code}\n" "http://${IP}:${PORT}/"
curl -sf -o /dev/null -w "  • JS: %{http_code}\n" "http://${IP}:${PORT}/js/app.js"
curl -sf -o /dev/null -w "  • בדיקות: %{http_code}\n" "http://${IP}:${PORT}/tests/"
echo ""
echo "  באייפון: פתח Safari → הכתובת למעלה"
echo "  ודא ששני המכשירים באותה Wi‑Fi"
echo ""
echo "══════════════════════════════════════"
