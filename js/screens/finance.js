import { escapeHtml, showToast, todayISO } from '../utils.js?v=485';
import {
  FINANCE_CATEGORIES,
  FINANCE_CATEGORY_LABELS,
  FINANCE_BEHAVIORS,
  FINANCE_REPORT_TYPES,
  FINANCE_SOURCES,
  listFinanceAccountMap,
  requireManualPeriod,
} from '../finance-db.js?v=485';
import {
  FINANCE_COLUMN_ROLES,
  FINANCE_COLUMN_ROLE_LABELS,
  FINANCE_ENCODINGS,
  parseFinanceSpreadsheet,
  previewRows,
  guessColumnMapping,
  getSavedFinanceColumnMapping,
  saveFinanceColumnMapping,
  extractMappedLines,
  uniqueAccountsFromLines,
  mappingHasRequiredRoles,
  commitFinanceImport,
} from '../finance-import.js?v=485';

export function financeMeta() {
  return { title: 'ייבוא כספים', subtitle: 'אשף ייבוא מחשבשבת ודוחות שכר' };
}

function monthBounds(iso) {
  const [y, m] = String(iso || todayISO()).split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return {
    periodStart: `${y}-${String(m).padStart(2, '0')}-01`,
    periodEnd: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`,
  };
}

function defaultWizard() {
  const period = monthBounds(todayISO());
  return {
    step: 1,
    file: null,
    fileName: '',
    encoding: FINANCE_ENCODINGS.utf8,
    encodingManual: false,
    detectedEncoding: FINANCE_ENCODINGS.utf8,
    reportType: FINANCE_REPORT_TYPES.trial_balance,
    source: FINANCE_SOURCES.hashavshevet,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    sheets: [],
    sheetName: '',
    bySheet: null,
    rows: [],
    startRow: 1,
    columnMapping: {},
    classifications: {},
    result: null,
  };
}

let wizard = defaultWizard();

function defaultBehaviorFor(category) {
  if (category === FINANCE_CATEGORIES.rent
    || category === FINANCE_CATEGORIES.admin
    || category === FINANCE_CATEGORIES.depreciation) {
    return FINANCE_BEHAVIORS.fixed;
  }
  return FINANCE_BEHAVIORS.variable;
}

function stepTitle(step) {
  return ['העלאה', 'תצוגה מקדימה', 'מיפוי עמודות', 'סיווג חשבונות'][step - 1] || '';
}

function categoryOptions(selected) {
  return Object.keys(FINANCE_CATEGORIES).map((key) => (
    `<option value="${key}" ${selected === key ? 'selected' : ''}>${escapeHtml(FINANCE_CATEGORY_LABELS[key])}</option>`
  )).join('');
}

function roleOptions(selected) {
  return Object.keys(FINANCE_COLUMN_ROLES).map((key) => (
    `<option value="${key}" ${selected === key ? 'selected' : ''}>${escapeHtml(FINANCE_COLUMN_ROLE_LABELS[key])}</option>`
  )).join('');
}

function renderPreviewTable(rows) {
  const preview = previewRows(rows, 20);
  if (!preview.length) return '<p class="form-hint">אין שורות בקובץ</p>';
  const width = preview.reduce((max, row) => Math.max(max, row.length), 0);
  const head = Array.from({ length: width }, (_, i) => `<th>עמודה ${i + 1}</th>`).join('');
  const body = preview.map((row, idx) => {
    const cells = Array.from({ length: width }, (_, i) => `<td>${escapeHtml(row[i] ?? '')}</td>`).join('');
    return `<tr><th>${idx + 1}</th>${cells}</tr>`;
  }).join('');
  return `
    <div class="finance-preview-wrap">
      <table class="finance-preview-table">
        <thead><tr><th>#</th>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function currentLines() {
  return extractMappedLines(wizard.rows, wizard.startRow, wizard.columnMapping);
}

function renderStep(container) {
  const steps = [1, 2, 3, 4].map((n) => (
    `<span class="finance-step-dot${wizard.step === n ? ' is-active' : ''}${wizard.step > n ? ' is-done' : ''}">${n}</span>`
  )).join('<span class="finance-step-line"></span>');

  let body = '';
  if (wizard.step === 1) {
    body = `
      <label class="form-label">קובץ (xlsx או csv)
        <input type="file" id="finance-file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
      </label>
      <p class="form-hint" id="finance-file-name">${wizard.fileName ? escapeHtml(wizard.fileName) : 'לא נבחר קובץ'}</p>
      <label class="form-label">סוג דוח
        <select id="finance-report-type">
          <option value="trial_balance" ${wizard.reportType === 'trial_balance' ? 'selected' : ''}>מאזן בוחן</option>
          <option value="payroll" ${wizard.reportType === 'payroll' ? 'selected' : ''}>שכר</option>
        </select>
      </label>
      <label class="form-label">מקור
        <select id="finance-source">
          <option value="hashavshevet" ${wizard.source === 'hashavshevet' ? 'selected' : ''}>חשבשבת</option>
          <option value="payroll" ${wizard.source === 'payroll' ? 'selected' : ''}>תוכנת שכר</option>
          <option value="other" ${wizard.source === 'other' ? 'selected' : ''}>אחר</option>
        </select>
      </label>
      <label class="form-label">קידוד (csv)
        <select id="finance-encoding">
          <option value="utf-8" ${wizard.encoding === 'utf-8' ? 'selected' : ''}>UTF-8</option>
          <option value="windows-1255" ${wizard.encoding === 'windows-1255' ? 'selected' : ''}>Windows-1255</option>
        </select>
      </label>
      <p class="form-hint">זוהה אוטומטית: ${escapeHtml(wizard.detectedEncoding)}. אפשר להחליף ידנית אם העברית משובשת.</p>
      ${wizard.sheets.length > 1 ? `
        <label class="form-label">גיליון
          <select id="finance-sheet">
            ${wizard.sheets.map((name) => `<option value="${escapeHtml(name)}" ${name === wizard.sheetName ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
          </select>
        </label>` : ''}
      <div class="finance-period-row">
        <label class="form-label">מתאריך
          <input type="date" id="finance-period-start" value="${escapeHtml(wizard.periodStart)}">
        </label>
        <label class="form-label">עד תאריך
          <input type="date" id="finance-period-end" value="${escapeHtml(wizard.periodEnd)}">
        </label>
      </div>
      <p class="form-hint">התקופה נבחרת כאן ידנית. תאריך מהקובץ לא קובע אותה.</p>`;
  } else if (wizard.step === 2) {
    body = `
      <label class="form-label">שורת נתונים ראשונה (1 = השורה הראשונה בקובץ)
        <input type="number" id="finance-start-row" min="1" step="1" value="${wizard.startRow + 1}">
      </label>
      <p class="form-hint">20 השורות הראשונות כפי שנקראו — כולל כותרות.</p>
      ${renderPreviewTable(wizard.rows)}`;
  } else if (wizard.step === 3) {
    const header = wizard.startRow > 0 ? (wizard.rows[wizard.startRow - 1] || []) : [];
    const sample = wizard.rows[wizard.startRow] || [];
    const width = Math.max(header.length, sample.length, ...wizard.rows.slice(0, 5).map((r) => r.length));
    const rowsHtml = Array.from({ length: width }, (_, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(header[idx] ?? '')}</td>
        <td>${escapeHtml(sample[idx] ?? '')}</td>
        <td>
          <select class="finance-col-role" data-col="${idx}">
            ${roleOptions(wizard.columnMapping[idx] || FINANCE_COLUMN_ROLES.ignore)}
          </select>
        </td>
      </tr>`).join('');
    body = `
      <p class="form-hint">לכל עמודה בוחרים מה היא. המיפוי נשמר לסוג הדוח הזה.</p>
      <div class="finance-preview-wrap">
        <table class="finance-preview-table">
          <thead><tr><th>#</th><th>כותרת</th><th>דוגמה</th><th>תפקיד</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
  } else {
    const lines = currentLines();
    const accounts = uniqueAccountsFromLines(lines);
    const rowsHtml = accounts.map((acc) => {
      const cls = wizard.classifications[acc.accountCode] || {};
      return `
        <tr>
          <td dir="ltr">${escapeHtml(acc.accountCode)}</td>
          <td>${escapeHtml(cls.accountName || acc.accountName || '')}</td>
          <td>
            <select class="finance-acc-cat" data-code="${escapeHtml(acc.accountCode)}">
              <option value="">— בחר —</option>
              ${categoryOptions(cls.category)}
            </select>
          </td>
          <td>
            <select class="finance-acc-beh" data-code="${escapeHtml(acc.accountCode)}">
              <option value="variable" ${cls.behavior === 'variable' || !cls.behavior ? 'selected' : ''}>משתנה</option>
              <option value="fixed" ${cls.behavior === 'fixed' ? 'selected' : ''}>קבוע</option>
            </select>
          </td>
        </tr>`;
    }).join('');
    body = `
      <p class="form-hint">${accounts.length} חשבונות מתוך ${lines.length} שורות. סיווג שנשמר ימולא אוטומטית בפעם הבאה.</p>
      <div class="finance-preview-wrap">
        <table class="finance-preview-table">
          <thead><tr><th>קוד</th><th>שם</th><th>קטגוריה</th><th>התנהגות</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="4">אין שורות אחרי המיפוי</td></tr>'}</tbody>
        </table>
      </div>
      ${wizard.result ? `<p class="form-hint" style="color:var(--success,#16a34a)">יובאו ${wizard.result.rowCount} שורות${wizard.result.replaced ? ' (הוחלף ייבוא קודם לאותה תקופה)' : ''}.</p>` : ''}`;
  }

  container.innerHTML = `
    <div class="finance-wizard">
      <button type="button" class="btn btn-secondary btn-sm" id="finance-back-backup">← חזרה לגיבוי</button>
      <div class="card" style="margin-top:12px">
        <div class="finance-steps">${steps}</div>
        <div class="card-title">${escapeHtml(stepTitle(wizard.step))}</div>
        ${body}
        <div class="finance-wizard-nav">
          <button type="button" class="btn btn-secondary" id="finance-prev" ${wizard.step === 1 ? 'disabled' : ''}>חזרה</button>
          ${wizard.step < 4
            ? `<button type="button" class="btn btn-primary" id="finance-next">הבא</button>`
            : `<button type="button" class="btn btn-primary" id="finance-commit">ייבא</button>`}
        </div>
      </div>
    </div>`;
}

async function loadFileIntoWizard(file, encoding) {
  const parsed = await parseFinanceSpreadsheet(file, { encoding });
  wizard.file = file;
  wizard.fileName = parsed.fileName;
  wizard.detectedEncoding = parsed.detectedEncoding;
  if (!wizard.encodingManual) wizard.encoding = parsed.encoding;
  wizard.sheets = parsed.sheets;
  wizard.sheetName = parsed.sheetName;
  wizard.bySheet = parsed.bySheet || null;
  wizard.rows = parsed.rows;
  if (!Object.keys(wizard.columnMapping).length) {
    const saved = await getSavedFinanceColumnMapping(wizard.reportType);
    wizard.columnMapping = saved || guessColumnMapping(parsed.rows[0] || []);
    wizard.startRow = saved ? wizard.startRow : (parsed.rows.length > 1 ? 1 : 0);
  }
}

async function applySavedMapForType() {
  const saved = await getSavedFinanceColumnMapping(wizard.reportType);
  if (saved) wizard.columnMapping = saved;
  else if (wizard.rows[0]) wizard.columnMapping = guessColumnMapping(wizard.rows[0]);
}

async function hydrateClassifications() {
  const lines = currentLines();
  const accounts = uniqueAccountsFromLines(lines);
  const existing = await listFinanceAccountMap();
  const byCode = new Map(existing.map((row) => [row.accountCode, row]));
  const next = { ...wizard.classifications };
  for (const acc of accounts) {
    if (next[acc.accountCode]?.category) continue;
    const prev = byCode.get(acc.accountCode);
    next[acc.accountCode] = {
      accountCode: acc.accountCode,
      accountName: acc.accountName || prev?.accountName || '',
      category: prev?.category || '',
      behavior: prev?.behavior || defaultBehaviorFor(prev?.category),
    };
  }
  wizard.classifications = next;
}

function bind(container, opts) {
  const { navigate, openBackup } = opts || {};
  document.getElementById('finance-back-backup')?.addEventListener('click', () => {
    if (typeof openBackup === 'function') openBackup();
    else navigate?.('backup');
  });

  document.getElementById('finance-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      wizard.encodingManual = false;
      wizard.columnMapping = {};
      await loadFileIntoWizard(file);
      renderFinance(container, opts);
    } catch (err) {
      showToast(err.message || 'לא ניתן לקרוא את הקובץ');
    }
  });

  document.getElementById('finance-report-type')?.addEventListener('change', async (e) => {
    wizard.reportType = e.target.value;
    await applySavedMapForType();
  });
  document.getElementById('finance-source')?.addEventListener('change', (e) => {
    wizard.source = e.target.value;
  });
  document.getElementById('finance-encoding')?.addEventListener('change', async (e) => {
    wizard.encoding = e.target.value;
    wizard.encodingManual = true;
    if (wizard.file) {
      try {
        await loadFileIntoWizard(wizard.file, wizard.encoding);
        renderFinance(container, opts);
      } catch (err) {
        showToast(err.message || 'שגיאת קידוד');
      }
    }
  });
  document.getElementById('finance-sheet')?.addEventListener('change', (e) => {
    wizard.sheetName = e.target.value;
    wizard.rows = wizard.bySheet?.[wizard.sheetName] || wizard.rows;
    wizard.columnMapping = guessColumnMapping(wizard.rows[0] || []);
    renderFinance(container, opts);
  });
  document.getElementById('finance-period-start')?.addEventListener('change', (e) => {
    wizard.periodStart = e.target.value;
  });
  document.getElementById('finance-period-end')?.addEventListener('change', (e) => {
    wizard.periodEnd = e.target.value;
  });
  document.getElementById('finance-start-row')?.addEventListener('change', (e) => {
    wizard.startRow = Math.max(0, Number(e.target.value) - 1);
  });
  container.querySelectorAll('.finance-col-role').forEach((sel) => {
    sel.addEventListener('change', () => {
      wizard.columnMapping[Number(sel.dataset.col)] = sel.value;
    });
  });
  container.querySelectorAll('.finance-acc-cat').forEach((sel) => {
    sel.addEventListener('change', () => {
      const code = sel.dataset.code;
      const prev = wizard.classifications[code] || { accountCode: code };
      wizard.classifications[code] = {
        ...prev,
        category: sel.value,
        behavior: prev.behavior || defaultBehaviorFor(sel.value),
      };
    });
  });
  container.querySelectorAll('.finance-acc-beh').forEach((sel) => {
    sel.addEventListener('change', () => {
      const code = sel.dataset.code;
      const prev = wizard.classifications[code] || { accountCode: code };
      wizard.classifications[code] = { ...prev, behavior: sel.value };
    });
  });

  document.getElementById('finance-prev')?.addEventListener('click', () => {
    wizard.step = Math.max(1, wizard.step - 1);
    wizard.result = null;
    renderFinance(container, opts);
  });

  document.getElementById('finance-next')?.addEventListener('click', async () => {
    try {
      if (wizard.step === 1) {
        if (!wizard.rows.length) throw new Error('יש לבחור קובץ');
        requireManualPeriod(wizard.periodStart, wizard.periodEnd);
        wizard.step = 2;
      } else if (wizard.step === 2) {
        const start = Number(document.getElementById('finance-start-row')?.value);
        wizard.startRow = Number.isFinite(start) ? Math.max(0, start - 1) : 1;
        if (!Object.keys(wizard.columnMapping).length) {
          wizard.columnMapping = guessColumnMapping(wizard.rows[Math.max(0, wizard.startRow - 1)] || wizard.rows[0] || []);
        }
        wizard.step = 3;
      } else if (wizard.step === 3) {
        if (!mappingHasRequiredRoles(wizard.columnMapping)) {
          throw new Error('יש למפות עמודת קוד חשבון ועמודת סכום');
        }
        await saveFinanceColumnMapping(wizard.reportType, wizard.columnMapping);
        await hydrateClassifications();
        wizard.step = 4;
      }
      renderFinance(container, opts);
    } catch (err) {
      showToast(err.message || 'יש להשלים את השלב');
    }
  });

  document.getElementById('finance-commit')?.addEventListener('click', async () => {
    const btn = document.getElementById('finance-commit');
    if (btn) { btn.disabled = true; btn.textContent = 'מייבא...'; }
    try {
      requireManualPeriod(wizard.periodStart, wizard.periodEnd);
      const lines = currentLines();
      const result = await commitFinanceImport({
        source: wizard.source,
        reportType: wizard.reportType,
        periodStart: wizard.periodStart,
        periodEnd: wizard.periodEnd,
        fileName: wizard.fileName,
        columnMapping: wizard.columnMapping,
        lines,
        classifications: wizard.classifications,
      });
      wizard.result = result;
      showToast(`יובאו ${result.rowCount} שורות ✓`);
      renderFinance(container, opts);
    } catch (err) {
      showToast(err.message || 'הייבוא נכשל');
      if (btn) { btn.disabled = false; btn.textContent = 'ייבא'; }
    }
  });
}

export async function renderFinance(container, opts = {}) {
  renderStep(container);
  bind(container, opts);
}
