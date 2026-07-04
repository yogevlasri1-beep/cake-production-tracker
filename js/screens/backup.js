import {
  getBackupStatus,
  runBackup,
  saveBackupSettings,
  chooseDefaultBackupFolder,
  keepOnlyLatestBackup,
  clearBackupLocation,
  listLocalSnapshots,
  listExternalBackupFiles,
  restoreLocalSnapshot,
  restoreFromExternalPath,
  restoreSupabaseBackup,
  testSupabaseBackupConnection,
  saveSupabaseBackupConfig,
  uploadBackupToSupabase,
  getBackupHistory,
  formatBackupSummary,
  supportsBackupLocationPicker,
  confirmAndRestoreBackupFile,
  downloadLatestBackupFile,
} from '../backup-service.js?v=221';
import { describeDownloadMethod } from '../download.js?v=221';
import { showToast, escapeHtml } from '../utils.js?v=221';
import { openModal, closeModal } from '../modal.js?v=221';
import { APP_VERSION } from '../version.js?v=221';
import { forceAppUpdate, checkForAppUpdate, detectRemoteVersion, isStandaloneApp } from '../sw-register.js?v=221';

function formatWhen(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('he-IL');
}

function kindLabel(kind) {
  return kind === 'auto' ? 'אוטומטי' : 'ידני';
}

function unsupportedFolderMessage(status) {
  if (status.isNativeApp) return 'לא ניתן לפתוח תיקייה — נסה שוב';
  if (status.isIOS) {
    return 'באייפון: התקן את האפליקציה המקורית (npm run ios:setup) כדי לבחור תיקייה ב«קבצים». דפדפן Safari לא תומך בבחירת תיקייה.';
  }
  return 'פתח ב-Chrome על Mac/Windows לבחירת תיקייה, או התקן את האפליקציה המקורית.';
}

export async function renderBackup(container, { navigate } = {}) {
  const status = await getBackupStatus();
  const {
    settings, snapshots, hasDefaultFolder, canWriteToFolder,
    supportsLocationPicker, isNativeApp, isIOS,
    supabaseConfig, supabaseConfigured, supabaseBackups, deviceId,
    backupScopeId,
  } = status;
  const iosPwa = isIOS && !isNativeApp;

  container.innerHTML = `
    <button type="button" class="btn btn-secondary btn-sm backup-back-btn" id="backup-back">← חזרה</button>

    <div class="card">
      <div class="card-title">🔄 עדכון אפליקציה</div>
      <p class="form-hint">גרסה מותקנת: <strong>${APP_VERSION}</strong>${isStandaloneApp() ? ' · מהאייקון במסך הבית' : ''}</p>
      <p class="form-hint" id="backup-remote-version" style="margin-top:4px"></p>
      <p class="form-hint" style="margin-top:6px;color:var(--danger)">
        <strong>yogevcakee תקוע על 153?</strong>
        Redeploy לא עוזר — צור Deploy Hook ב-Vercel והרץ
        <a href="https://github.com/yogevlasri1-beep/cake-production-tracker/actions/workflows/vercel-deploy-manual.yml" target="_blank" rel="noopener">Deploy Vercel (Manual)</a>
        · או
        <a href="https://yogevlasri1-beep.github.io/cake-production-tracker/?force-update=1" target="_blank" rel="noopener">GitHub Pages</a>
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button type="button" class="btn btn-primary btn-sm" id="check-app-update">בדוק עדכון</button>
        <button type="button" class="btn btn-secondary btn-sm" id="force-app-update">נקה מטמון ועדכן</button>
      </div>
      <p class="form-hint" style="margin-top:8px">אם לא רואה «מנהל» בתפריט — לחץ «נקה מטמון ועדכן» (פעם אחת עם Wi‑Fi)</p>
    </div>

    <div class="card backup-hero-card">
      <div class="card-title">💾 גיבוי ושחזור</div>
      ${iosPwa ? `
        <div class="backup-ios-notice">
          <p><strong>איפה הגיבוי נשמר באייפון?</strong></p>
          <p class="form-hint" style="margin-bottom:8px">הגיבוי כולל את כל האפליקציה — מוצרים, מתכונים, ספקים, תזרימי יצור והגדרות.</p>
          <ul class="backup-ios-list">
            <li><strong>קובץ JSON ב«קבצים»</strong> — הגיבוי האמיתי (דרך Share → שמירה לקבצים)</li>
            <li><strong>פנימי באפליקציה</strong> — גיבוי מהיר לשחזור, <em>נמחק עם האפליקציה</em></li>
          </ul>
        </div>
        <button type="button" class="btn btn-primary" id="backup-now-btn" style="width:100%;margin-bottom:8px">
          💾 גיבוי — שמור קובץ JSON לקבצים
        </button>
        ${snapshots.length ? `
          <button type="button" class="btn btn-secondary" id="backup-redownload-btn" style="width:100%;margin-bottom:8px">
            📥 הורד שוב את קובץ הגיבוי האחרון
          </button>
        ` : ''}
        <p class="form-hint">אחרי לחיצה → בחר <strong>שמירה לקבצים</strong> → בחר תיקייה (למשל Yitzur)</p>
      ` : `
        <p class="backup-lead">
          הגיבוי כולל <strong>את כל תוכן האפליקציה</strong>: קטגוריות וקטגוריות כלליות (קבוצות),
          מוצרים (מחירים, סדר), <strong>מתכונים</strong> (קטגוריות, חומרים, קישור למוצרים),
          <strong>ספקים וחומרי גלם</strong>, רישומי ייצור, יעדים, תיעוד הכנות,
          <strong>תבניות תזרים יצור</strong> (שמות, שלבים) ו<strong>תהליכי יצור פעילים/הושלמו</strong>, והגדרות.
          <strong>לאחר מחיקת האפליקציה</strong> — התקן מחדש וייבא את קובץ הגיבוי.
        </p>
        <button type="button" class="btn btn-primary" id="backup-now-btn" style="width:100%;margin-bottom:8px">
          💾 גיבוי ידני עכשיו
        </button>
        <button type="button" class="btn btn-secondary" id="backup-share-btn" style="width:100%;margin-bottom:8px">
          📤 שמור קובץ גיבוי (Share / הורדה)
        </button>
      `}
      <button type="button" class="btn btn-secondary" id="backup-history-btn" style="width:100%">
        📜 היסטוריית גיבויים
      </button>
    </div>

    <div class="card backup-supabase-card">
      <div class="card-title">☁️ גיבוי בענן — Supabase</div>
      <p class="form-hint" style="margin-bottom:10px">
        כל הגיבויים (ידני + אוטומטי) נשמרים בענן — גם אחרי מחיקת האפליקציה אפשר לשחזר.
        מזהה גיבוי: <code style="font-size:0.78rem">${escapeHtml(backupScopeId || 'yitzur')}</code>
        · מכשיר: <code style="font-size:0.78rem">${escapeHtml(deviceId || '—')}</code>
      </p>
      <div class="form-group">
        <label for="supabase-url">כתובת Supabase (Project URL)</label>
        <input type="url" id="supabase-url" placeholder="https://xxxx.supabase.co"
          value="${escapeHtml(supabaseConfig.supabaseUrl || '')}">
      </div>
      <div class="form-group">
        <label for="supabase-anon-key">מפתח anon / publishable</label>
        <input type="password" id="supabase-anon-key" placeholder="eyJ... או sb_publishable_..."
          value="${escapeHtml(supabaseConfig.anonKey || '')}" autocomplete="off">
      </div>
      <label class="backup-toggle-row" style="margin-bottom:10px">
        <span>שמירה אוטומטית ל-Supabase</span>
        <input type="checkbox" id="supabase-enabled" ${supabaseConfig.enabled !== false ? 'checked' : ''}>
      </label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <button type="button" class="btn btn-secondary btn-sm" id="supabase-save-config">שמור הגדרות</button>
        <button type="button" class="btn btn-secondary btn-sm" id="supabase-test">בדוק חיבור</button>
        <button type="button" class="btn btn-primary btn-sm" id="supabase-sync-now" ${supabaseConfigured ? '' : 'disabled'}>
          ☁️ גיבוי לענן עכשיו
        </button>
      </div>
      <p class="backup-meta">
        גיבוי אחרון לענן: ${formatWhen(supabaseConfig.lastSyncAt)}${supabaseConfig.lastSyncKind ? ` (${kindLabel(supabaseConfig.lastSyncKind)})` : ''}<br>
        ${supabaseConfig.lastSyncError
          ? `<span style="color:var(--danger)">שגיאה אחרונה: ${escapeHtml(supabaseConfig.lastSyncError)}</span>`
          : supabaseConfigured ? '✓ מחובר — גיבויים נשמרים אוטומטית פעם ביום' : 'הזן כתובת ומפתח ולחץ «בדוק חיבור»'}
      </p>
      ${supabaseConfigured ? `
        <p class="form-hint" style="margin-top:8px">
          ${supabaseBackups.length ? `${supabaseBackups.length} גיבויים בענן · ` : ''}
          <button type="button" class="btn btn-secondary btn-sm" id="supabase-open-history">צפה בהיסטוריה</button>
        </p>
      ` : ''}
    </div>

    <div class="card">
      <div class="card-title">גיבוי אוטומטי</div>
      <label class="backup-toggle-row">
        <span>הפעל גיבוי אוטומטי</span>
        <input type="checkbox" id="backup-auto-enabled" ${settings.autoEnabled ? 'checked' : ''}>
      </label>
      <div class="form-group" style="margin-top:12px">
        <label for="backup-auto-hours">תדירות</label>
        <select id="backup-auto-hours">
          ${[24, 12, 6, 3, 1].map((h) =>
            `<option value="${h}" ${Number(settings.autoIntervalHours) === h ? 'selected' : ''}>${h === 24 ? 'פעם ביום (24 שעות)' : `כל ${h} שעות`}</option>`
          ).join('')}
        </select>
      </div>
      <p class="backup-meta">
        גיבוי אחרון אוטומטי: ${formatWhen(settings.lastAutoAt)}<br>
        גיבוי אחרון ידני: ${formatWhen(settings.lastManualAt)}<br>
        גיבוי אחרון לתיקייה: ${formatWhen(settings.lastExternalAt)}
      </p>
      <p class="form-hint">${iosPwa
        ? 'באייפון: גיבוי אוטומטי פעם ביום — פנימי + Supabase (אם מוגדר). לקובץ ב«קבצים» — לחץ «גיבוי — שמור קובץ».'
        : 'גיבוי אוטומטי פעם ביום — על המכשיר, ל-Supabase (אם מוגדר), ולתיקיית ברירת המחדל (אם נבחרה). קובץ JSON כולל מטא-דאטה של Supabase.'}</p>
    </div>

    <div class="card backup-folder-card">
      <div class="card-title">📁 תיקיית ברירת מחדל לגיבויים</div>
      <p class="form-hint" style="margin-bottom:10px">
        ${hasDefaultFolder
          ? `תיקייה: <strong>${escapeHtml(settings.externalLocationLabel || 'נבחרה')}</strong>`
          : 'לחץ למטה — ייפתח «קבצים» לבחירת תיקייה. כל הגיבויים (ידני + אוטומטי) יישמרו שם.'}
      </p>
      ${hasDefaultFolder && canWriteToFolder ? `
        <p class="form-hint backup-folder-status">✓ גיבויים נשמרים אוטומטית לתיקייה זו</p>
      ` : ''}
      <button type="button" class="btn btn-primary btn-sm" id="choose-default-folder" style="width:100%;margin-bottom:8px">
        📁 ${hasDefaultFolder ? 'שנה תיקיית ברירת מחדל' : 'בחר תיקיית גיבוי לברירת מחדל'}
      </button>
      ${hasDefaultFolder ? `
        <button type="button" class="btn btn-secondary btn-sm" id="browse-backup-files" style="width:100%;margin-bottom:8px">
          📂 עיין בקבצי גיבוי בתיקייה
        </button>
        <button type="button" class="btn btn-secondary btn-sm" id="clear-backup-dir" style="width:100%">הסר תיקיית ברירת מחדל</button>
      ` : ''}
      ${!supportsLocationPicker ? `
        <p class="form-hint" style="margin-top:8px">${escapeHtml(unsupportedFolderMessage(status))}</p>
      ` : ''}
      ${isNativeApp ? `<p class="form-hint" style="margin-top:8px">אפליקציה מותקנת — בחירת תיקייה דרך «קבצים»</p>` : ''}
    </div>

    <div class="card">
      <div class="card-title">גיבוי מקומי על המכשיר</div>
      <p class="form-hint">נשמר <strong>גיבוי אחד בלבד</strong> — כל גיבוי חדש מחליף את הקודם</p>
      ${snapshots.length === 0
        ? '<p class="report-empty">אין עדיין גיבוי מקומי</p>'
        : `<div class="backup-snapshot-list">${snapshots.map((s) => `
            <div class="backup-snapshot-item">
              <div class="backup-snapshot-info">
                <strong>${formatWhen(s.createdAt)}</strong>
                <span class="backup-snapshot-meta">${kindLabel(s.kind)} · ${escapeHtml(s.summary)}</span>
              </div>
              <button type="button" class="btn btn-secondary btn-sm restore-local-backup" data-id="${s.id}">שחזר</button>
            </div>`).join('')}
        </div>`}
      <button type="button" class="btn btn-secondary btn-sm" id="prune-old-backups" style="width:100%;margin-top:10px">
        🗑 מחק גיבויים ישנים — השאר רק האחרון
      </button>
    </div>

    <div class="card">
      <div class="card-title">ייבוא מקובץ (אחרי מחיקה / מכשיר אחר)</div>
      <label class="btn btn-primary btn-sm backup-file-label" for="backup-restore-file" style="width:100%">
        📂 ייבא גיבוי מקובץ JSON
        <input type="file" id="backup-restore-file" accept=".json,application/json">
      </label>
    </div>`;

  document.getElementById('backup-back')?.addEventListener('click', () => navigate?.('home'));

  (async () => {
    const remote = await detectRemoteVersion();
    const el = document.getElementById('backup-remote-version');
    if (el && remote) {
      el.textContent = remote !== APP_VERSION
        ? `גרסה בשרver: ${remote} — יש עדכון חדש!`
        : `גרסה בשרver: ${remote} — מעודכן ✓`;
      el.style.color = remote !== APP_VERSION ? 'var(--danger)' : 'var(--success, #16a34a)';
    }
  })();

  document.getElementById('check-app-update')?.addEventListener('click', async () => {
    const btn = document.getElementById('check-app-update');
    if (btn) btn.disabled = true;
    try {
      const remote = await detectRemoteVersion();
      const found = await checkForAppUpdate();
      if (remote && remote !== APP_VERSION) {
        showToast(`גרסה ${remote} זמינה — לחץ «נקה מטמון ועדכן»`);
      } else if (found) {
        showToast('עדכון מוכן — לחץ «נקה מטמון ועדכן»');
      } else {
        showToast('אין עדכון — אתה על הגרסה האחרונה');
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById('force-app-update')?.addEventListener('click', async () => {
    if (!confirm('ינקה מטמון ויטען מחדש. הנתונים שלך לא יימחקו. להמשיך?')) return;
    showToast('מעדכן...');
    await forceAppUpdate();
  });

  document.getElementById('backup-auto-enabled')?.addEventListener('change', async (e) => {
    await saveBackupSettings({ autoEnabled: e.target.checked });
    showToast(e.target.checked ? 'גיבוי אוטומטי הופעל ✓' : 'גיבוי אוטומטי כובה');
  });

  document.getElementById('backup-auto-hours')?.addEventListener('change', async (e) => {
    await saveBackupSettings({ autoIntervalHours: Number(e.target.value) });
    showToast('תדירות גיבוי עודכנה ✓');
  });

  const readSupabaseForm = () => ({
    supabaseUrl: document.getElementById('supabase-url')?.value?.trim() || '',
    anonKey: document.getElementById('supabase-anon-key')?.value?.trim() || '',
    enabled: document.getElementById('supabase-enabled')?.checked !== false,
  });

  document.getElementById('supabase-save-config')?.addEventListener('click', async () => {
    await saveSupabaseBackupConfig(readSupabaseForm());
    showToast('הגדרות Supabase נשמרו ✓');
    renderBackup(container, { navigate });
  });

  document.getElementById('supabase-enabled')?.addEventListener('change', async (e) => {
    await saveSupabaseBackupConfig({ enabled: e.target.checked });
    showToast(e.target.checked ? 'גיבוי ענן הופעל ✓' : 'גיבוי ענן כובה');
  });

  document.getElementById('supabase-test')?.addEventListener('click', async () => {
    const btn = document.getElementById('supabase-test');
    const label = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'בודק...'; }
    try {
      await testSupabaseBackupConnection(readSupabaseForm());
      showToast('חיבור Supabase תקין ✓');
      renderBackup(container, { navigate });
    } catch (err) {
      showToast(err.message || 'שגיאת חיבור');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  });

  document.getElementById('supabase-sync-now')?.addEventListener('click', async () => {
    const btn = document.getElementById('supabase-sync-now');
    const label = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'מגבה...'; }
    try {
      const result = await runBackup({ kind: 'manual', shareToFiles: false });
      if (result.supabase) {
        showToast(`גיבוי בענן הושלם ✓ · ${formatBackupSummary(result.payload.counts)}`);
      } else {
        showToast(result.supabaseError || 'לא נשמר בענן — בדוק הגדרות');
      }
      renderBackup(container, { navigate });
    } catch (err) {
      showToast(err.message || 'שגיאה');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  });

  const openHistory = () => openBackupHistoryModal(navigate);
  document.getElementById('backup-history-btn')?.addEventListener('click', openHistory);
  document.getElementById('supabase-open-history')?.addEventListener('click', openHistory);

  const runManual = async (shareToFiles) => {
    const btn = document.getElementById(shareToFiles ? 'backup-share-btn' : 'backup-now-btn');
    const label = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'מגבה...'; }
    try {
      const result = await runBackup({ kind: 'manual', shareToFiles: shareToFiles || iosPwa });
      const parts = ['נשמר באפליקציה'];
      if (result.external) parts.push('נשמר בתיקייה');
      if (result.supabase) parts.push('נשמר בענן');
      else if (result.supabaseError) parts.push('ענן — שגיאה');
      if (result.shared) parts.push('קובץ — Share');
      else if (result.downloaded) parts.push('קובץ הורד');
      else if (result.fileExport === false && iosPwa) {
        parts.push('לא נשמר קובץ — נסה שוב ובחר שמירה לקבצים');
      }
      let msg = `גיבוי הושלם ✓ · ${formatBackupSummary(result.payload.counts)} · ${parts.join(' · ')}`;
      if (result.shared) msg += ` · ${describeDownloadMethod('share')}`;
      showToast(msg);
      renderBackup(container, { navigate });
    } catch (err) {
      showToast(err.message || 'שגיאה בגיבוי');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  };

  document.getElementById('backup-now-btn')?.addEventListener('click', () => runManual(iosPwa));
  document.getElementById('backup-share-btn')?.addEventListener('click', () => runManual(true));

  document.getElementById('backup-redownload-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('backup-redownload-btn');
    const label = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'מכין קובץ...'; }
    try {
      const { method, filename } = await downloadLatestBackupFile();
      if (method === 'cancelled') {
        showToast('בוטל — בחר «שמירה לקבצים»');
      } else {
        showToast(`קובץ ${filename} · ${describeDownloadMethod(method)}`);
      }
    } catch (err) {
      showToast(err.message || 'שגיאה');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  });

  document.getElementById('choose-default-folder')?.addEventListener('click', async () => {
    try {
      const result = await chooseDefaultBackupFolder();
      showToast(`תיקיית ברירת מחדל: ${result.name} ✓`);
      renderBackup(container, { navigate });
    } catch (err) {
      if (err?.name === 'AbortError') return;
      if (err?.message === 'UNSUPPORTED') {
        openModal({
          title: 'בחירת תיקייה לא נתמכת',
          bodyHTML: `<p style="line-height:1.6">${escapeHtml(unsupportedFolderMessage(status))}</p>`,
          footerHTML: '<button type="button" class="btn btn-primary modal-cancel">הבנתי</button>',
        });
        document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
        return;
      }
      showToast(err.message || 'לא ניתן לבחור תיקייה');
    }
  });

  document.getElementById('browse-backup-files')?.addEventListener('click', () => {
    openBrowseExternalModal(navigate);
  });

  document.getElementById('clear-backup-dir')?.addEventListener('click', async () => {
    await clearBackupLocation();
    showToast('תיקיית ברירת המחדל הוסרה');
    renderBackup(container, { navigate });
  });

  document.getElementById('prune-old-backups')?.addEventListener('click', () => {
    openModal({
      title: 'מחיקת גיבויים ישנים',
      bodyHTML: `
        <p style="line-height:1.6">
          יימחקו כל הגיבויים הישנים — יישאר רק <strong>הגיבוי האחרון</strong>
          (על המכשיר ובתיקייה, אם הוגדרה).
        </p>`,
      footerHTML: `
        <button type="button" class="btn btn-secondary modal-cancel">ביטול</button>
        <button type="button" class="btn btn-danger" id="confirm-prune-backups">מחק ישנים</button>`,
    });
    document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('confirm-prune-backups')?.addEventListener('click', async () => {
      const btn = document.getElementById('confirm-prune-backups');
      btn.disabled = true;
      btn.textContent = 'מוחק...';
      try {
        const result = await keepOnlyLatestBackup();
        closeModal();
        const parts = [];
        if (result.localDeleted) parts.push(`${result.localDeleted} מקומיים`);
        if (result.externalDeleted) parts.push(`${result.externalDeleted} בתיקייה`);
        showToast(parts.length
          ? `נוקה ✓ · נמחקו ${parts.join(' · ')}`
          : 'כבר נשאר רק גיבוי אחד ✓');
        renderBackup(container, { navigate });
      } catch (err) {
        showToast(err.message || 'שגיאה');
        btn.disabled = false;
        btn.textContent = 'מחק ישנים';
      }
    });
  });

  container.querySelectorAll('.restore-local-backup').forEach((btn) => {
    btn.addEventListener('click', () => confirmRestoreLocal(Number(btn.dataset.id), navigate));
  });

  document.getElementById('backup-restore-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    confirmAndRestoreBackupFile(file, navigate);
  });
}

function formatFileSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function openBackupHistoryModal(navigate) {
  const history = await getBackupHistory();
  const { local, external, supabase } = history;
  const hasAny = local.length || external.length || supabase.length;

  const section = (title, itemsHtml) => {
    if (!itemsHtml) return '';
    return `
      <div class="backup-history-section">
        <h4 class="backup-history-title">${escapeHtml(title)}</h4>
        <div class="backup-snapshot-list">${itemsHtml}</div>
      </div>`;
  };

  const localHtml = local.map((s) => `
    <div class="backup-snapshot-item">
      <div class="backup-snapshot-info">
        <strong>${formatWhen(s.createdAt)}</strong>
        <span class="backup-snapshot-meta">${kindLabel(s.kind)} · ${escapeHtml(s.summary)} · מקומי</span>
      </div>
      <button type="button" class="btn btn-secondary btn-sm restore-local-backup" data-id="${s.id}">שחזר</button>
    </div>`).join('');

  const supabaseHtml = supabase.map((s) => `
    <div class="backup-snapshot-item">
      <div class="backup-snapshot-info">
        <strong>${formatWhen(s.exportedAt)}</strong>
        <span class="backup-snapshot-meta">${kindLabel(s.kind)} · ${escapeHtml(s.summary || '')} · Supabase</span>
      </div>
      <button type="button" class="btn btn-secondary btn-sm restore-supabase-backup" data-id="${escapeHtml(s.id)}">שחזר</button>
    </div>`).join('');

  const externalHtml = external.map((f, i) => `
    <div class="backup-snapshot-item">
      <div class="backup-snapshot-info">
        <strong>${escapeHtml(f.name)}</strong>
        <span class="backup-snapshot-meta">
          ${f.modified ? new Date(f.modified).toLocaleString('he-IL') : '—'} · ${formatFileSize(f.size)} · תיקייה
        </span>
      </div>
      <button type="button" class="btn btn-secondary btn-sm restore-external-file" data-idx="${i}">שחזר</button>
    </div>`).join('');

  openModal({
    title: 'היסטוריית גיבויים',
    bodyHTML: hasAny
      ? [
        section('☁️ Supabase', supabaseHtml),
        section('📱 על המכשיר', localHtml),
        section('📁 בתיקייה', externalHtml),
      ].join('')
      : '<p class="report-empty">אין גיבויים שמורים — בצע גיבוי ידני או הגדר Supabase</p>',
    footerHTML: '<button type="button" class="btn btn-primary modal-cancel">סגור</button>',
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  document.querySelectorAll('.restore-local-backup').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeModal();
      confirmRestoreLocal(Number(btn.dataset.id), navigate);
    });
  });

  document.querySelectorAll('.restore-supabase-backup').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeModal();
      confirmRestoreSupabase(btn.dataset.id, navigate);
    });
  });

  document.querySelectorAll('.restore-external-file').forEach((btn) => {
    btn.addEventListener('click', () => {
      const file = external[Number(btn.dataset.idx)];
      if (!file?.nativePath && !file?.name) return;
      closeModal();
      confirmRestoreExternal(file.nativePath || file.name, file.name, navigate);
    });
  });
}

async function openBrowseExternalModal(navigate) {
  let files = [];
  try {
    files = await listExternalBackupFiles();
  } catch (err) {
    showToast(err.message || 'לא ניתן לקרוא קבצים');
    return;
  }

  if (!files.length) {
    showToast('לא נמצאו קבצי גיבוי בתיקייה');
    return;
  }

  openModal({
    title: 'קבצי גיבוי בתיקייה',
    bodyHTML: `
      <p class="form-hint" style="margin-bottom:10px">בחר קובץ לשחזור</p>
      <div class="backup-snapshot-list">
        ${files.map((f, i) => `
          <div class="backup-snapshot-item">
            <div class="backup-snapshot-info">
              <strong>${escapeHtml(f.name)}</strong>
              <span class="backup-snapshot-meta">
                ${f.modified ? new Date(f.modified).toLocaleString('he-IL') : '—'} · ${formatFileSize(f.size)}
              </span>
            </div>
            <button type="button" class="btn btn-secondary btn-sm restore-external-file" data-idx="${i}">שחזר</button>
          </div>`).join('')}
      </div>`,
    footerHTML: '<button type="button" class="btn btn-primary modal-cancel">סגור</button>',
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  document.querySelectorAll('.restore-external-file').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const file = files[Number(btn.dataset.idx)];
      if (!file?.nativePath && !file?.name) return;
      closeModal();
      confirmRestoreExternal(file.nativePath || file.name, file.name, navigate);
    });
  });
}

function confirmRestoreExternal(path, name, navigate) {
  openModal({
    title: 'שחזור מקובץ',
    bodyHTML: `<p style="line-height:1.6">לשחזר מ<strong>${escapeHtml(name)}</strong>?<br>כל הנתונים הנוכחיים יוחלפו.</p>`,
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">ביטול</button>
      <button type="button" class="btn btn-primary" id="confirm-restore-external">שחזר</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('confirm-restore-external')?.addEventListener('click', async () => {
    try {
      const meta = await restoreFromExternalPath(path);
      closeModal();
      showToast(`שוחזר ✓ · ${formatBackupSummary(meta.counts)}`);
      navigate?.('home');
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

function confirmRestoreSupabase(id, navigate) {
  openModal({
    title: 'שחזור מ-Supabase',
    bodyHTML: `<p style="line-height:1.6">פעולה זו תחליף את <strong>כל</strong> הנתונים הנוכחיים בגיבוי מהענן.<br><br>להמשיך?</p>`,
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">ביטול</button>
      <button type="button" class="btn btn-primary" id="confirm-restore-supabase">שחזר</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('confirm-restore-supabase')?.addEventListener('click', async () => {
    const btn = document.getElementById('confirm-restore-supabase');
    btn.disabled = true;
    btn.textContent = 'משחזר...';
    try {
      const meta = await restoreSupabaseBackup(id);
      closeModal();
      showToast(`שוחזר מענן ✓ · ${formatBackupSummary(meta.counts)}`);
      navigate?.('home');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'שחזר';
      showToast(err.message || 'שגיאה');
    }
  });
}

function confirmRestoreLocal(id, navigate) {
  openModal({
    title: 'שחזור גיבוי מקומי',
    bodyHTML: `<p style="line-height:1.6">פעולה זו תחליף את <strong>כל</strong> הנתונים הנוכחיים בגיבוי שנבחר.<br><br>להמשיך?</p>`,
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">ביטול</button>
      <button type="button" class="btn btn-primary" id="confirm-restore-local">שחזר</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('confirm-restore-local')?.addEventListener('click', async () => {
    try {
      const meta = await restoreLocalSnapshot(id);
      closeModal();
      showToast(`שוחזר ✓ · ${formatBackupSummary(meta.counts)}`);
      navigate?.('home');
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

export function backupMeta() {
  return { title: 'גיבוי ושחזור', subtitle: 'מכשיר, ענן ושחזור' };
}
