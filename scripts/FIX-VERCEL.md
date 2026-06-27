# Vercel תקוע — פרויקט yogevcakee

**URL:** https://yogevcakee.vercel.app  
**Redeploy** = מפרס מחדש את **אותה גרסה ישנה** — לא מושך מ-GitHub.

GitHub Pages (תמיד עדכני):  
https://yogevlasri1-beep.github.io/cake-production-tracker/

---

## שלב 1 — חבר Git מחדש (yogevcakee)

1. [Vercel Dashboard](https://vercel.com/dashboard) → **yogevcakee**
2. **Settings → Git**
3. אם מחובר — **Disconnect**
4. **Connect Git Repository** → `yogevlasri1-beep/cake-production-tracker`
5. Production Branch: **main** → Deploy

## שלב 2 — Create Deployment

1. **Deployments** → **Create Deployment** (לא Redeploy!)
2. Branch: **main**
3. Deploy

## שלb 3 — Deploy Hook

1. **yogevcakee** → **Settings → Git → Deploy Hooks** → Create (branch: `main`)
2. GitHub Secrets → `VERCEL_DEPLOY_HOOK` = ה-URL
3. Actions → **Deploy Vercel** → Run workflow

או:
```bash
curl -X POST "הדבק_כאן_Deploy_Hook_URL"
```

## בדיקה

```bash
./scripts/verify-deploy.sh
```

https://yogevcakee.vercel.app/js/version.js — צריך להתאים לגרסה ב-GitHub Pages.

## באייפון (עד ש-Vercel מתוקן)

https://yogevlasri1-beep.github.io/cake-production-tracker/?force-update=1
