import {
  getSheetsConfig,
  saveSheetsConfig,
  testSheetsConnection,
  isSheetsConfigured,
  pullProductionFromSheets,
  importProductionFromSheets,
  pushAllToSheets,
  pushReportToSheets,
  openGoogleSheet,
  extractSheetId,
  sheetsSetupInstructions,
} from './google-sheets.js?v=306';
import { showToast, escapeHtml } from './utils.js?v=306';
import { openModal, closeModal } from './modal.js?v=306';

export async function openSheetsSetupModal({ onSaved } = {}) {
  const cfg = await getSheetsConfig();
  openModal({
    title: 'חיבור Google Sheets',
    bodyHTML: `
      <p class="form-hint sheets-setup-lead">
        עבודה ישירה עם Google Sheets — בלי הורדת Excel ובלי Share.
      </p>
      <div class="form-group">
        <label for="sheets-url">קישור ל-Google Sheet</label>
        <input type="url" id="sheets-url" dir="ltr" placeholder="https://docs.google.com/spreadsheets/d/..." value="${escapeHtml(cfg.sheetUrl || '')}">
      </div>
      <div class="form-group">
        <label for="sheets-webapp">כתובת Web App (Apps Script)</label>
        <input type="url" id="sheets-webapp" dir="ltr" placeholder="https://script.google.com/macros/s/.../exec" value="${escapeHtml(cfg.webAppUrl || '')}">
      </div>
      <div class="form-group">
        <label for="sheets-token">טוקן (אופציונלי)</label>
        <input type="text" id="sheets-token" dir="ltr" value="${escapeHtml(cfg.token || 'yitzur2024')}">
      </div>
      <details class="sheets-setup-details">
        <summary>הוראות התקנה</summary>
        <pre class="sheets-setup-pre">${escapeHtml(sheetsSetupInstructions())}</pre>
      </details>`,
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">ביטול</button>
      <button type="button" class="btn btn-primary" id="sheets-save-connect">שמור ובדוק</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('sheets-save-connect')?.addEventListener('click', async () => {
    const btn = document.getElementById('sheets-save-connect');
    const sheetUrl = document.getElementById('sheets-url')?.value?.trim();
    const webAppUrl = document.getElementById('sheets-webapp')?.value?.trim();
    const token = document.getElementById('sheets-token')?.value?.trim();
    const sheetId = extractSheetId(sheetUrl);
    if (!sheetId) {
      showToast('קישור גיליון לא תקין');
      return;
    }
    if (!webAppUrl?.includes('script.google.com')) {
      showToast('כתובת Web App לא תקינה');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'בודק...';
    try {
      const patch = { sheetUrl, sheetId, webAppUrl, token: token || 'yitzur2024' };
      const ping = await testSheetsConnection(patch);
      await saveSheetsConfig(patch);
      closeModal();
      showToast(`מחובר ✓ · ${ping.spreadsheet || 'Google Sheets'}`);
      await onSaved?.();
    } catch (err) {
      showToast(err.message || 'חיבור נכשל');
    } finally {
      btn.disabled = false;
      btn.textContent = 'שמור ובדוק';
    }
  });
}

export async function openSheetsImportModal({ onComplete } = {}) {
  let rows = [];
  try {
    rows = await pullProductionFromSheets();
  } catch (err) {
    showToast(err.message || 'לא ניתן לקרוא מ-Sheets');
    return;
  }
  if (!rows.length) {
    showToast('לא נמצאו רישומים בגיליון «ייצור»');
    return;
  }

  const categories = new Set(rows.map((r) => r.category).filter(Boolean));
  const products = new Set(rows.map((r) => r.product).filter(Boolean));

  openModal({
    title: 'ייבוא מ-Google Sheets',
    bodyHTML: `
      <p style="line-height:1.6;margin-bottom:10px">
        נמצאו <strong>${rows.length}</strong> רישומים בגיליון «ייצור»
        · ${categories.size} קטגוריות · ${products.size} מוצרים
      </p>
      <p style="font-size:0.82rem;color:var(--primary-dark);margin-bottom:10px">
        רישום קיים לאותו יום+מוצר — הכמויות יתווספו
      </p>`,
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">ביטול</button>
      <button type="button" class="btn btn-primary" id="confirm-sheets-import">ייבא ${rows.length} רישומים</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('confirm-sheets-import')?.addEventListener('click', async () => {
    const btn = document.getElementById('confirm-sheets-import');
    btn.disabled = true;
    btn.textContent = 'מייבא...';
    try {
      const result = await importProductionFromSheets();
      closeModal();
      const parts = [`${result.imported} רישומים`];
      if (result.merged) parts.push(`${result.merged} עודכנו`);
      if (result.newProducts) parts.push(`${result.newProducts} מוצרים חדשים`);
      showToast(`יובא מ-Sheets ✓ · ${parts.join(' · ')}`);
      await onComplete?.(result);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = `ייבא ${rows.length} רישומים`;
      showToast(err.message || 'שגיאה');
    }
  });
}

export async function exportReportToSheets(params, { openAfter = true } = {}) {
  await pushReportToSheets(params);
  if (openAfter) {
    const cfg = await getSheetsConfig();
    openGoogleSheet(cfg);
  }
  return 'הדוח נשלח ל-Google Sheets ✓';
}

export async function syncAllToSheets({ openAfter = true } = {}) {
  const result = await pushAllToSheets();
  if (openAfter) {
    const cfg = await getSheetsConfig();
    openGoogleSheet(cfg);
  }
  return result;
}

export async function renderSheetsStatusHTML() {
  const configured = await isSheetsConfigured();
  const cfg = await getSheetsConfig();
  if (!configured) {
    return `
      <p class="form-hint sheets-status-hint">חבר Google Sheet פעם אחת — ואז ייבוא, ייצוא ופתיחת דוחות ישירות בגיליון.</p>
      <button type="button" class="btn btn-primary btn-sm" id="sheets-setup-btn" style="width:100%">🔗 חבר Google Sheets</button>`;
  }
  const last = cfg.lastSyncAt
    ? new Date(cfg.lastSyncAt).toLocaleString('he-IL')
    : '—';
  return `
    <p class="form-hint sheets-status-line">
      מחובר: <strong>${escapeHtml(cfg.lastSyncLabel || 'Google Sheets')}</strong><br>
      סנכרון אחרון: ${last}
    </p>
    <button type="button" class="btn btn-primary btn-sm" id="sheets-open-btn" style="width:100%;margin-bottom:8px">📊 פתח ב-Google Sheets</button>
    <button type="button" class="btn btn-secondary btn-sm" id="sheets-import-btn" style="width:100%;margin-bottom:8px">📥 ייבא מ-Sheets</button>
    <button type="button" class="btn btn-secondary btn-sm" id="sheets-sync-all-btn" style="width:100%;margin-bottom:8px">⬆️ העלה הכל ל-Sheets</button>
    <button type="button" class="btn btn-secondary btn-sm" id="sheets-settings-btn" style="width:100%">⚙️ הגדרות חיבור</button>`;
}

export function bindSheetsStatusEvents(container, handlers = {}) {
  container.querySelector('#sheets-setup-btn')?.addEventListener('click', () => {
    openSheetsSetupModal({ onSaved: handlers.onRefresh });
  });
  container.querySelector('#sheets-settings-btn')?.addEventListener('click', () => {
    openSheetsSetupModal({ onSaved: handlers.onRefresh });
  });
  container.querySelector('#sheets-open-btn')?.addEventListener('click', async () => {
    try {
      const cfg = await getSheetsConfig();
      openGoogleSheet(cfg);
    } catch (err) {
      showToast(err.message);
    }
  });
  container.querySelector('#sheets-import-btn')?.addEventListener('click', () => {
    openSheetsImportModal({ onComplete: handlers.onImportComplete });
  });
  container.querySelector('#sheets-sync-all-btn')?.addEventListener('click', async () => {
    const btn = container.querySelector('#sheets-sync-all-btn');
    const label = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'מעלה...'; }
    try {
      const r = await syncAllToSheets({ openAfter: true });
      showToast(`הועלה ✓ · ${r.production} ייצור · ${r.catalog} מוצרים`);
      handlers.onRefresh?.();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  });
}
