# Vercel תקוע על גרסה ישנה — תיקון חד-פעמי

GitHub Pages מתעדכן אוטומטically. Vercel **לא** מקבל push מ-GitHub (ניתק).

## אפשרות א' — הכי מהיר (2 דקות)

1. פתח [Vercel Dashboard](https://vercel.com/dashboard) → פרויקט **cake-production-tracker**
2. **Deployments** → לחץ **⋯** על הפריסה האחרונה → **Redeploy**
3. אם אין פריסות חדשות: **Settings → Git** → ודא חיבור ל-`yogevlasri1-beep/cake-production-tracker` → **Disconnect** ו-**Connect** מחדש

## אפשרות ב' — Deploy Hook (אוטומטי לעתיד)

1. Vercel → **Settings → Git → Deploy Hooks** → **Create Hook** (branch: `main`)
2. העתק את ה-URL
3. GitHub → repo → **Settings → Secrets and variables → Actions** → **New secret**
   - Name: `VERCEL_DEPLOY_HOOK`
   - Value: ה-URL שהעתקת
4. Actions → **Deploy Vercel** → **Run workflow**

## אפשרות ג' — ZIP (בלי Git)

```bash
./scripts/make-vercel-drop-zip.sh
```

גרור `cake-production-tracker-vercel.zip` לפרויקט הקיים ב-Vercel (לא Drop חדש).

## בדיקה

```bash
./scripts/verify-deploy.sh
```

Vercel ו-GitHub Pages צריכים להראות אותה גרסה.

## באייפון (עד ש-Vercel מתוקן)

https://yogevlasri1-beep.github.io/cake-production-tracker/?force-update=1
