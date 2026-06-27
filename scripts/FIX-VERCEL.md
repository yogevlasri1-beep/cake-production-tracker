# תיקון yogevcakee — מ-153 לגרסה עדכנית

**פרויקט:** yogevcakee  
**URL:** https://yogevcakee.vercel.app  
**GitHub Pages (עובד):** https://yogevlasri1-beep.github.io/cake-production-tracker/

Redeploy **לא עוזר** — הוא מפרס מחדש 153.

---

## דרך 1 — Deploy Hook + GitHub Actions (5 דקות, מומלץ)

### א. צור Hook ב-Vercel
1. https://vercel.com/dashboard → **yogevcakee**
2. **Settings → Git → Deploy Hooks**
3. **Create Hook** · שם: `github-main` · Branch: **main**
4. **העתק את ה-URL** (מתחיל ב-`https://api.vercel.com/v1/integrations/deploy/`)

### ב. הרץ ב-GitHub
1. https://github.com/yogevlasri1-beep/cake-production-tracker/actions/workflows/vercel-deploy-manual.yml
2. **Run workflow** (ימין)
3. הדבק את ה-URL בשדה **deploy_hook_url**
4. **Run workflow**
5. אחרי ~2 דקות: https://yogevcakee.vercel.app/js/version.js

### ג. לעתיד (אוטומטי)
GitHub → repo → **Settings → Secrets → Actions** → New secret:
- Name: `VERCEL_DEPLOY_HOOK`
- Value: אותו URL

---

## דרך 2 — חבר Git מחדש

1. **yogevcakee** → **Settings → Git**
2. **Disconnect**
3. **Connect** → `yogevlasri1-beep/cake-production-tracker` · branch **main**
4. המתן ל-Deployment חדש (לא Redeploy!)

---

## דרך 3 — באייפון (עובד עכשיו, בלי Vercel)

```
https://yogevlasri1-beep.github.io/cake-production-tracker/?force-update=1
```

הוסף למסך הבית · מחק אייקון yogevcakee ישן.

---

## בדיקה

```bash
./scripts/verify-deploy.sh
```
