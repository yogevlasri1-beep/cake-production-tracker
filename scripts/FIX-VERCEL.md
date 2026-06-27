# תיקון yogevcakee — 404 / גרסה ישנה

**פרויקט:** yogevcakee  
**URL:** https://yogevcakee.vercel.app  
**GitHub Pages (גיבוי):** https://yogevlasri1-beep.github.io/cake-production-tracker/

## מה קרה?

ניסיון proxy (rewrites בלבד) גרם ל-**404** — Vercel פרס deployment ריק.

**פתרון:** פריסה **סטטית מלאה** מה-repo (vercel.json + כל קבצי האפליקציה).

---

## תיקון מהיר — Vercel Drop

```bash
./scripts/make-vercel-drop-zip.sh
```

1. פתח https://vercel.com/dashboard → **yogevcakee**
2. גרור `cake-production-tracker-vercel.zip` ל-**Deploy** / Drop
3. המתן ~1 דקה
4. בדוק: https://yogevcakee.vercel.app/js/version.js

---

## לעתיד — Deploy Hook (אוטומטי)

1. Vercel → **yogevcakee** → Settings → Git → **Deploy Hooks** → Create (main)
2. GitHub → Secrets → `VERCEL_DEPLOY_HOOK`
3. כל push ל-main יפעיל deploy

---

## בדיקה

```bash
./scripts/verify-deploy.sh
```

---

## באייפון (עובד תמיד)

```
https://yogevlasri1-beep.github.io/cake-production-tracker/?force-update=1
```
