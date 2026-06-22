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

#### דרך GitHub (אוטומטי אחרי כל push)

1. היכנס ל-[vercel.com/new](https://vercel.com/new) → התחבר עם **GitHub**
2. אם לא רואה את הריפו — **Adjust GitHub App Permissions** → תן גישה ל-`cake-production-tracker`
3. **Import** את `yogevlasri1-beep/cake-production-tracker`
4. בדף ההגדרות — **חשוב ללחוץ Override** ולוודא:
   - **Framework Preset:** Other
   - **Install Command:** (ריק)
   - **Build Command:** (ריק)
   - **Output Directory:** `.` (נקודה בלבד)
5. **Deploy**

`vercel.json` כבר מגדיר את זה — אם ה-Override לא דלוק, Vercel עלול לנסות `npm install` (Capacitor) ולהיכשל.

#### דרך Drop (בלי Git — הכי פשוט אם GitHub נתקע)

1. בטרמינל:
   ```bash
   cd ~/Projects/cake-production-tracker
   ./scripts/make-vercel-drop-zip.sh
   ```
2. פתח [vercel.com/new/drop](https://vercel.com/new/drop)
3. גרור את `cake-production-tracker-vercel.zip` לדף
4. קבל URL מיד

#### באייפון

1. Safari → פתח את כתובת Vercel
2. **שיתוף** → **הוסף למסך הבית**
3. לעדכון גרסה: `/?force-update=1`

#### אם הפריסה נכשלת

| שגיאה | פתרון |
|--------|--------|
| `npm install` / Capacitor | Override: Install + Build ריקים, Output = `.` |
| Repository not found | GitHub App → הרשאות לריפו |
| 404 אחרי deploy | Output Directory חייב להיות `.` לא `public` |
| DEPLOYMENT_NOT_FOUND | הפרויקט עדיין לא נפרס — השלם Deploy או Drop |

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
