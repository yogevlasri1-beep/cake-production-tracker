#!/bin/bash
# הפעלת השרver + הצגת QR לפתיחה באייפון

cd "$(dirname "$0")/.." || exit 1
PORT=8765

# כתובת IP ברשת הביתית (Wi‑Fi)
IP=$(ipconfig getifaddr en0 2>/dev/null)
if [ -z "$IP" ]; then
  IP=$(ipconfig getifaddr en1 2>/dev/null)
fi
if [ -z "$IP" ]; then
  IP="127.0.0.1"
  echo "⚠️  לא נמצא IP של Wi‑Fi — ודא שה-Mac מחובר ל-Wi‑Fi"
fi

HOST=$(scutil --get LocalHostName 2>/dev/null)
URL="http://${IP}:${PORT}/?force-update=1"
OPEN_URL="http://${IP}:${PORT}"
LOCAL_URL="http://${HOST}.local:${PORT}"

# עצור שרver ישן על אותו פורט
if lsof -tiTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "מפעיל מחדש שרver על פורט ${PORT}..."
  kill "$(lsof -tiTCP:${PORT} -sTCP:LISTEN)" 2>/dev/null
  sleep 1
fi

# דף QR לסריקה מהאייפון
cat > /tmp/yitzur-connect.html <<EOF
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>פתיחה באייפון — מעקב יצור</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 420px; margin: 40px auto; text-align: center; padding: 20px; }
    h1 { font-size: 1.4rem; color: #1d4ed8; }
    img { margin: 24px 0; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,.12); }
    .url { font-size: 1.25rem; font-weight: 700; color: #2563eb; word-break: break-all; margin: 16px 0; }
    ol { text-align: right; line-height: 1.8; color: #334155; }
    .alt { font-size: 0.9rem; color: #64748b; margin-top: 20px; }
  </style>
</head>
<body>
  <h1>📱 פתיחה באייפון</h1>
  <p>סרוק עם <strong>מצלמת האייפון</strong>:</p>
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${URL}" width="280" height="280" alt="QR">
  <div class="url">${URL}</div>
  <ol>
    <li>ודא שהאייפון וה-Mac <strong>באותה רשת Wi‑Fi</strong></li>
    <li>סרוק את ה-QR — או הקלד את הכתובת ב-Safari</li>
    <li>שיתוף ↗ → <strong>«הוסף למסך הבית»</strong></li>
    <li>אחרי ההתקנה — פתח <strong>מהאייקון</strong>. אפשר לכבות את ה-Mac</li>
  </ol>
  <p class="alt" style="margin-top:24px"><strong>עדכון גרסה?</strong><br>פתח ב-Safari:<br><strong>${URL}</strong></p>
  <p class="alt">התקנה ראשונה / גלישה רגילה:<br><strong>${OPEN_URL}</strong></p>
  <p class="alt">אם לא עובד, נסה: <br><strong>${LOCAL_URL}</strong></p>
</body>
</html>
EOF

echo ""
echo "═══════════════════════════════════════"
echo "  מעקב יצור — פתיחה באייפון"
echo "═══════════════════════════════════════"
echo ""
echo "  כתובת לאייפון (Safari):"
echo "  ${URL}"
echo ""
echo "  חלופה: ${LOCAL_URL}"
echo ""
echo "  אחרי «הוסף למסך הבית» — האפליקציה עובדת גם כש-Mac כבוי"
echo ""
echo "═══════════════════════════════════════"
echo ""

open /tmp/yitzur-connect.html 2>/dev/null

echo "מפעיל שרver... (Ctrl+C לעצירה)"
echo ""
echo "  לעדכון באייפון — Safari:"
echo "  ${URL}"
echo ""
chmod +x scripts/http-server.py 2>/dev/null
exec python3 scripts/http-server.py "${PORT}"
