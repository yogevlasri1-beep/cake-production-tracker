# תיקון yogevcakee — סנכרון עם GitHub Pages

**פרויקט:** yogevcakee  
**URL:** https://yogevcakee.vercel.app  
**GitHub Pages (מקור):** https://yogevlasri1-beep.github.io/cake-production-tracker/

## למה Vercel נתקע על 153?

Vercel שמר **עותק סטטי ישן** של האפליקציה. Redeploy רגיל מפרס מחדש את אותו artifact — לא עוזר.

**פתרון (גרסה 164+):** Vercel מפרס **proxy בלבד** — כל בקשה מועברת ל-GitHub Pages.  
אחרי פריסה **פעם אחת**, Vercel תמיד מציג את הגרסה העדכנית מ-GitHub.

---

## פעם אחת — הפעל proxy על Vercel

### א. Deploy Hook (מומלץ)

1. https://vercel.com/dashboard → **yogevcakee**
2. **Settings → Git → Deploy Hooks** → Create · `github-main` · branch **main**
3. העתק URL
4. GitHub → repo → **Settings → Secrets → Actions** → `VERCEL_DEPLOY_HOOK`
5. Actions → **Deploy Vercel (Manual)** → הדבק URL → Run

### ב. Vercel Drop (ללא Git)

```bash
./scripts/make-vercel-drop-zip.sh
```

גרור `cake-production-tracker-vercel.zip` ל-yogevcakee ב-Vercel Drop.

---

## בדיקה

```bash
./scripts/verify-deploy.sh
```

צפוי: GitHub Pages ו-Vercel **אותה גרסה**.

---

## באייפון (עובד תמיד)

```
https://yogevlasri1-beep.github.io/cake-production-tracker/?force-update=1
```

או yogevcakee אחרי שה-proxy הופעל.
