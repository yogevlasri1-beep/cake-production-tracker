# מעקב יצור

אפליקציית PWA לתיעוד ייצור במפעל — עובדת **על האייפון גם כשה-Mac כבוי**, הנתונים נשמרים מקומית על המכשיר.

## עבודה בלי Mac (מומלץ)

### אפשרות א' — התקנה על מסך הבית (offline מלא)

1. פתח את האפליקציה **פעם אחת** עם אינטרנט (ראה אפשרות ב' למטה, או Wi‑Fi של Mac)
2. Safari → **שיתוף** ↗ → **«הוסף למסך הבית»**
3. מעכשיו — פתח **רק מהאייקון** (לא מ-Safari)

האפליקציה והנתונים נשמרים על האייפון. **אפשר לכבות את המחשב** — הכל ממשיך לעבוד.

> **חשוב:** בפעם הראשונה חייבים לטעון את האפליקציה עם חיבור (אינטרנט או Mac). אחרי זה — offline לגמרי.

### אפשרות ב' — Vercel (מומלץ, HTTPS + עדכונים מהירים)

1. היכנס ל-[vercel.com](https://vercel.com) → **Add New Project**
2. **Import** את `yogevlasri1-beep/cake-production-tracker` מ-GitHub
3. הגדרות (ברירת מחדל — **אין build**):
   - **Framework Preset:** Other
   - **Build Command:** (ריק)
   - **Output Directory:** (ריק)
4. **Deploy**
5. הכתובת: `https://cake-production-tracker.vercel.app` (או שם ש-Vercel נותן)
6. באייפון Safari → פתח את הכתובת → **הוסף למסך הבית**

לעדכון גרסה: `/?force-update=1` בכתובת.

קובץ `vercel.json` כבר מוגדר עם no-cache ל-`index.html`, `sw.js` ו-`version.js`.

### אפשרות ג' — GitHub Pages

פרסום חינמי באינטרנט — האייפון ניגש ישירות, בלי Mac:

1. צור repository ב-GitHub (למשל `cake-production-tracker`)
2. דחף את הקוד:
   ```bash
   cd ~/Projects/cake-production-tracker
   git remote add origin git@github.com:YOUR_USER/cake-production-tracker.git
   git add -A && git commit -m "offline PWA + GitHub Pages"
   git push -u origin main
   ```
3. ב-GitHub: **Settings → Pages → Build and deployment → GitHub Actions**
4. הכתובת תהיה: `https://YOUR_USER.github.io/cake-production-tracker/`
5. באייפון Safari → פתח את הכתובת → **הוסף למסך הבית**

אחרי ההתקנה — עובד offline, Mac כבוי.

## פיתוח / Wi‑Fi מקומי (Mac)

```bash
cd ~/Projects/cake-production-tracker
./scripts/start-for-iphone.sh
```

פתח באייפון: `http://192.168.x.x:8765` (ה-IP מודפס במסך)

## בדיקות

```bash
ruby scripts/verify-offline-assets.rb   # וידוא קבצי offline
./scripts/check-network.sh              # בדיקת רשת מקומית
```

בדפדפן: `http://127.0.0.1:8765/tests/`

## מסכים

| מסך | תפקיד |
|-----|--------|
| בית | גרפים + סיכום חודשי |
| ייצור | רישום מוצרים + ייבוא Excel |
| תיעוד | תהליכי הכנה |
| מוצרים | קטגוריות ומחירים |
| יעדים | יעדי כמות |
| דוחות | ייצוא Excel |

## גיבוי

הנתונים ב-IndexedDB על האייפון. לגיבוי — ייצוא Excel ממסך **דוחות**.

## נתיב

`/Users/yogevlasriapple/Projects/cake-production-tracker`
