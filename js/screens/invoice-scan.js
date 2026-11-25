import {
  getSuppliers, getRawMaterials, getSupplierCategories, getCombinedPriceHistory,
  sanitizeSku, sanitizeMinOrderQty, getMaterialSynonyms, computePricePerKg,
  packageWeightKgFromGrams, formatKgWeight,
} from '../kitchen-db.js?v=553';
import { escapeHtml, showToast, formatMoney, formatDate, formatDateTime } from '../utils.js?v=553';
import { openModal, closeModal } from '../modal.js?v=553';
import {
  suggestSupplierMatches, compareInvoicePrice,
  isFirstMaterialScan, extractPackageKgFromName,
  INVOICE_ITEM_ROLES, invoiceItemRoleLabel, roleFromSupplierCategory,
  guessInvoiceItemRole, searchMaterialsByName, filterInvoiceDraftsByName,
  applyInvoiceLineFieldPatch, lineDraftFromParsed,
} from '../invoice-match.js?v=553';
import { parseInvoiceFiles, getInvoiceAiKey, setInvoiceAiKey } from '../invoice-ai.js?v=553';
import { listInvoiceScans, getInvoiceScan, saveInvoiceScan, applyInvoiceLine, categoryIdForInvoiceRole } from '../invoice-scan-db.js?v=553';
import { requestAutoBackupNow } from '../backup-service.js?v=553';

export const invoiceScanMeta = {
  title: 'סריקת מסמכים',
  subtitle: 'חשבוניות ספקים → מחירים, מק״ט וכמות באריזה',
};

function priceStatusClass(status) {
  if (status === 'mismatch') return 'invoice-price-mismatch';
  if (status === 'match') return 'invoice-price-match';
  return '';
}

/** escapeHtml לא בורח גרשיים — חובה בשדות value. */
function escapeAttr(value) {
  return escapeHtml(String(value ?? '')).replace(/"/g, '&quot;');
}

function categoryById(categories, id) {
  return (categories || []).find((c) => Number(c.id) === Number(id)) || null;
}

function materialRole(mat, categories) {
  if (!mat) return 'raw';
  return roleFromSupplierCategory(categoryById(categories, mat.supplierCategoryId));
}

function materialProfileHTML(mat, { suppliers = [], history = [], categories = [] } = {}) {
  if (!mat) return '<p class="form-hint">אין חומר מקושר</p>';
  const sup = suppliers.find((s) => Number(s.id) === Number(mat.supplierId));
  const syn = getMaterialSynonyms(mat);
  const perKg = computePricePerKg(mat.unitPrice, mat.packageWeightGrams);
  const hist = (history || []).slice(0, 5);
  const role = materialRole(mat, categories);
  return `
    <div class="invoice-profile">
      <div class="invoice-profile-name">${escapeHtml(mat.name)} · ${escapeHtml(invoiceItemRoleLabel(role))}</div>
      <div class="invoice-profile-grid">
        <span>ספק</span><strong>${escapeHtml(sup?.name || 'ללא ספק')}</strong>
        <span>מק״ט</span><strong>${escapeHtml(sanitizeSku(mat.sku) || '—')}</strong>
        <span>יחידה</span><strong>${escapeHtml(mat.unit || '—')}</strong>
        <span>אריזה</span><strong>${mat.packageWeightGrams ? `${packageWeightKgFromGrams(mat.packageWeightGrams)} ק״ג` : '—'}</strong>
        <span>מחיר אריזה</span><strong>${Number(mat.unitPrice) > 0 ? formatMoney(mat.unitPrice) : '—'}</strong>
        <span>לק״ג</span><strong>${perKg != null ? `${formatMoney(perKg)}/ק״ג` : '—'}</strong>
        <span>מינימום הזמנה</span><strong>${sanitizeMinOrderQty(mat.minOrderQty) ?? '—'}</strong>
        <span>נרדפות</span><strong>${syn.length ? escapeHtml(syn.join(', ')) : '—'}</strong>
      </div>
      ${hist.length ? `<p class="form-hint" style="margin-top:8px">היסטוריית מחיר: ${hist.map((h) => `${formatDate(h.effectiveDate)} ${formatMoney(h.price)}`).join(' · ')}</p>` : ''}
    </div>`;
}

export async function renderInvoiceScan(container) {
  const [suppliers, materials, categories, scans] = await Promise.all([
    getSuppliers(),
    getRawMaterials(),
    getSupplierCategories(),
    listInvoiceScans(),
  ]);
  const unscanedCount = materials.filter((m) => isFirstMaterialScan(m)).length;

  container.innerHTML = `
    <section class="card invoice-scan-card">
      <h3 class="card-title">סריקת חשבונית</h3>
      <p class="form-hint" style="line-height:1.55;margin-bottom:10px">
        צלם או העלה חשבונית (תמונה / PDF). ה-AI מחלץ שורות, מזהה ספק, ומציע שיוך לחומרים קיימים —
        בלי לפתוח כפילות. ${unscanedCount ? `<strong>${unscanedCount}</strong> חומרים עדיין בלי סריקה.` : 'כל החומרים כבר נסרקו פעם.'}
      </p>
      <div class="invoice-scan-upload">
        <label class="btn btn-primary invoice-file-btn">
          📷 בחר / צלם חשבונית
          <input type="file" id="invoice-files" accept="image/*,application/pdf" multiple capture="environment" hidden>
        </label>
        <button type="button" class="btn btn-secondary" id="invoice-paste-btn">הדבק טקסט</button>
      </div>
      <p class="form-hint" id="invoice-file-names" style="margin-top:8px"></p>
      <button type="button" class="btn btn-primary" id="invoice-parse-btn" style="width:100%;margin-top:8px" disabled>חלץ מהמסמך</button>
      <p class="form-hint" id="invoice-parse-status" style="margin-top:8px;line-height:1.5"></p>
    </section>
    <section class="card" id="invoice-review-host"></section>
    <section class="card">
      <h3 class="card-title">מפתח AI</h3>
      <p class="form-hint" style="line-height:1.5;margin-bottom:8px">
        אם אין מפתח בשרת, אפשר מפתח Gemini מקומי (נשמר במכשיר בלבד).
        משיגים בחינם ב־<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>.
      </p>
      <div class="form-group">
        <input type="password" id="invoice-ai-key" placeholder="מפתח Gemini" autocomplete="off">
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="invoice-ai-save">שמור מפתח</button>
    </section>
    <section class="card">
      <h3 class="card-title">היסטוריית סריקות לפי ספק</h3>
      ${scans.length ? renderHistory(scans, suppliers) : '<p class="report-empty">אין סריקות עדיין</p>'}
    </section>`;

  const fileInput = document.getElementById('invoice-files');
  const parseBtn = document.getElementById('invoice-parse-btn');
  const namesEl = document.getElementById('invoice-file-names');
  const statusEl = document.getElementById('invoice-parse-status');
  let chosenFiles = [];

  document.getElementById('invoice-ai-key').value = await getInvoiceAiKey();
  document.getElementById('invoice-ai-save')?.addEventListener('click', async () => {
    await setInvoiceAiKey(document.getElementById('invoice-ai-key').value);
    showToast('מפתח נשמר במכשיר');
  });

  fileInput?.addEventListener('change', () => {
    chosenFiles = [...(fileInput.files || [])];
    namesEl.textContent = chosenFiles.map((f) => f.name).join(' · ') || '';
    parseBtn.disabled = !chosenFiles.length;
  });

  document.getElementById('invoice-paste-btn')?.addEventListener('click', () => {
    openModal({
      title: 'הדבקת טקסט חשבונית',
      bodyHTML: `<textarea id="invoice-paste-text" rows="10" style="width:100%" placeholder="הדבק כאן את תוכן החשבונית"></textarea>`,
      footerHTML: `<button type="button" class="btn btn-secondary modal-cancel">ביטול</button>
        <button type="button" class="btn btn-primary" id="invoice-paste-go">חלץ</button>`,
    });
    document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('invoice-paste-go')?.addEventListener('click', async () => {
      const text = document.getElementById('invoice-paste-text')?.value || '';
      closeModal();
      const blob = new File([text], 'invoice.txt', { type: 'text/plain' });
      chosenFiles = [blob];
      namesEl.textContent = 'טקסט שהודבק';
      parseBtn.disabled = false;
      parseBtn.click();
    });
  });

  parseBtn?.addEventListener('click', async () => {
    if (!chosenFiles.length) return;
    parseBtn.disabled = true;
    statusEl.textContent = 'מפענח את החשבונית, זה יכול לקחת רגע...';
    try {
      const parsed = await parseInvoiceFiles(chosenFiles, {
        suppliers,
        materials,
        onStatus: (msg) => { statusEl.textContent = msg; },
      });
      const supplierHits = suggestSupplierMatches(parsed.supplierName, suppliers);
      const supplierId = supplierHits[0]?.supplier?.id || null;
      const drafts = parsed.lines.map((line) => lineDraftFromParsed(line, materials, { supplierId, categories }));
      await renderInvoiceReview(document.getElementById('invoice-review-host'), {
        parsed, drafts, suppliers, materials, categories, supplierId, files: chosenFiles,
        onSaved: () => renderInvoiceScan(container),
      });
      statusEl.textContent = `נמצאו ${drafts.length} שורות · ספק: ${parsed.supplierName || 'לא זוהה'}`;
    } catch (err) {
      statusEl.textContent = err.message || 'הפענוח נכשל';
      showToast(err.message || 'הפענוח נכשל');
    } finally {
      parseBtn.disabled = !chosenFiles.length;
    }
  });

  container.querySelectorAll('[data-open-scan]')?.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const scan = await getInvoiceScan(Number(btn.dataset.openScan));
      if (!scan) return;
      openModal({
        title: `חשבונית ${escapeHtml(scan.invoiceNumber || '')}`.trim() || 'סריקה',
        bodyHTML: `
          <p class="form-hint">${escapeHtml(scan.supplierName || '')} · ${escapeHtml(formatDateTime(scan.scannedAt))}</p>
          <div class="invoice-history-lines">
            ${(scan.lines || []).map((line) => `
              <div class="invoice-history-line">
                <strong>${escapeHtml(line.name)}</strong>
                <span>${line.quantity || ''} ${escapeHtml(line.unit || '')} · ${formatMoney(line.unitPrice)} · ${escapeHtml(invoiceItemRoleLabel(line.itemRole) || line.action || '')}</span>
              </div>`).join('')}
          </div>`,
        footerHTML: '<button type="button" class="btn btn-secondary modal-cancel">סגור</button>',
      });
      document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
    });
  });
}

function renderHistory(scans, suppliers) {
  const groups = new Map();
  for (const scan of scans) {
    const name = suppliers.find((s) => Number(s.id) === Number(scan.supplierId))?.name
      || scan.supplierName
      || 'ללא ספק';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(scan);
  }
  return [...groups.entries()].map(([name, rows]) => `
    <div class="invoice-history-group">
      <h4>${escapeHtml(name)} · ${rows.length}</h4>
      ${rows.map((scan) => `
        <button type="button" class="invoice-history-row" data-open-scan="${scan.id}">
          <span>${escapeHtml(scan.invoiceNumber || 'בלי מספר')} · ${escapeHtml(scan.invoiceDate || formatDate(scan.scannedAt))}</span>
          <span class="form-hint">${scan.lineCount || 0} שורות</span>
        </button>`).join('')}
    </div>`).join('');
}

function matchHitsForLine(line, materials) {
  const query = String(line.matchQuery || '').trim();
  if (query) return searchMaterialsByName(query, materials);
  return (line.matches || []).slice(0, 8);
}

function renderMatchResults(hits, line, idx, categories) {
  if (!hits.length) {
    const q = String(line.matchQuery || '').trim();
    return `<p class="form-hint invoice-match-empty">${q ? 'לא נמצא חומר בשם הזה — אפשר ליצור חדש או לשנות את החיפוש.' : 'אין הצעת שיוך אוטומטית — חפשו לפי שם או צרו חדש.'}</p>`;
  }
  return hits.map((hit) => {
    const selected = Number(line.materialId) === Number(hit.material.id) && line.action === 'link';
    const role = materialRole(hit.material, categories);
    return `
      <button type="button" class="invoice-match-hit${selected ? ' selected' : ''}"
        data-idx="${idx}" data-material-id="${hit.material.id}">
        <span class="invoice-match-hit-name">${escapeHtml(hit.material.name)}</span>
        <span class="invoice-match-hit-meta">${escapeHtml(invoiceItemRoleLabel(role))}${hit.reason ? ` · ${escapeHtml(hit.reason)}` : ''}${hit.material.sku ? ` · ${escapeHtml(hit.material.sku)}` : ''}</span>
      </button>`;
  }).join('');
}

function renderRoleChips(line, idx) {
  return `
    <div class="invoice-role-row">
      <span class="form-hint">שייך ל</span>
      <div class="invoice-role-chips" role="group" aria-label="סוג פריט">
        ${INVOICE_ITEM_ROLES.map((role) => `
          <button type="button" class="invoice-role-chip${line.itemRole === role.id ? ' active' : ''}"
            data-idx="${idx}" data-role="${role.id}">${escapeHtml(role.label)}</button>`).join('')}
      </div>
    </div>`;
}

function renderMatchPicker(line, idx, materials, categories) {
  const selected = materials.find((m) => Number(m.id) === Number(line.materialId));
  const hits = matchHitsForLine(line, materials);
  return `
    <div class="invoice-match-picker">
      <label class="form-hint">חיפוש לפי שם חומר גלם
        <input type="search" class="invoice-match-search" data-idx="${idx}"
          placeholder="חפש חומר קיים לפי שם / מק״ט..."
          value="${escapeAttr(line.matchQuery || '')}" autocomplete="off">
      </label>
      <div class="invoice-match-results" data-idx="${idx}">
        ${renderMatchResults(hits, line, idx, categories)}
      </div>
      <div class="invoice-match-actions">
        <button type="button" class="btn btn-secondary btn-sm invoice-action-btn${line.action === 'create' ? ' invoice-action-active' : ''}"
          data-idx="${idx}" data-action="create">צור חדש כ${escapeHtml(invoiceItemRoleLabel(line.itemRole))}</button>
        <button type="button" class="btn btn-secondary btn-sm invoice-action-btn${line.action === 'skip' ? ' invoice-action-active' : ''}"
          data-idx="${idx}" data-action="skip">דלג</button>
      </div>
      ${selected && line.action === 'link' ? `<p class="form-hint">משויך ל«${escapeHtml(selected.name)}»</p>` : ''}
      ${line.action === 'create' ? `<p class="form-hint">ייפתח ${escapeHtml(invoiceItemRoleLabel(line.itemRole))} חדש רק אם אין התאמה קיימת.</p>` : ''}
    </div>`;
}

function renderLineEditFields(line, idx) {
  const basis = line.priceBasis || 'per_kg';
  return `
    <div class="invoice-line-edit" data-idx="${idx}">
      <div class="invoice-edit-grid">
        <label>שם
          <input class="invoice-edit-name" data-idx="${idx}" data-field="name" value="${escapeAttr(line.name || '')}">
        </label>
        <label>מק״ט
          <input class="invoice-edit-sku" data-idx="${idx}" data-field="sku" value="${escapeAttr(line.sku || '')}">
        </label>
        <label>כמות
          <input type="number" step="any" class="invoice-edit-qty" data-idx="${idx}" data-field="quantity" value="${line.quantity || ''}">
        </label>
        <label>יחידה
          <input class="invoice-edit-unit" data-idx="${idx}" data-field="unit" value="${escapeAttr(line.unit || '')}">
        </label>
        <label>אריזה (ק״ג)
          <input type="number" step="any" class="invoice-edit-pack" data-idx="${idx}" data-field="packageWeightKg" value="${line.packageWeightKg || ''}">
        </label>
        <label>מחיר
          <input type="number" step="any" class="invoice-edit-price" data-idx="${idx}" data-field="unitPrice" value="${line.unitPrice || ''}">
        </label>
        <label>בסיס מחיר
          <select class="invoice-edit-basis" data-idx="${idx}" data-field="priceBasis">
            <option value="per_kg" ${basis === 'per_kg' ? 'selected' : ''}>לק״ג</option>
            <option value="per_package" ${basis === 'per_package' ? 'selected' : ''}>לאריזה</option>
            <option value="per_unit" ${basis === 'per_unit' ? 'selected' : ''}>ליחידה</option>
          </select>
        </label>
        <label>סה״כ שורה
          <input type="number" step="any" class="invoice-edit-total" data-idx="${idx}" data-field="lineTotal" value="${line.lineTotal || ''}">
        </label>
      </div>
    </div>`;
}

function renderLineCard(line, idx, materials, suppliers, categories, { hidden = false } = {}) {
  const mat = materials.find((m) => Number(m.id) === Number(line.materialId));
  const mismatch = line.price?.status === 'mismatch';
  return `
    <div class="invoice-line-card ${priceStatusClass(line.price?.status)}" data-idx="${idx}" ${hidden ? 'hidden' : ''}>
      <div class="invoice-line-title">${escapeHtml(line.name || 'בלי שם')}</div>
      ${renderLineEditFields(line, idx)}
      ${mismatch ? `<div class="invoice-price-mismatch invoice-price-mismatch-msg">מחיר לא תואם למה ששמור אצל הספק${line.price.direction === 'up' ? ' — עליית מחיר' : ''}</div>` : ''}
      ${mat ? `<div class="form-hint">שמור אצלנו: ${formatMoney(mat.unitPrice)}${mat.packageWeightGrams ? ` / ${formatKgWeight(mat.packageWeightGrams / 1000)}` : ''} · ${escapeHtml(invoiceItemRoleLabel(materialRole(mat, categories)))}</div>` : ''}
      ${renderRoleChips(line, idx)}
      ${renderMatchPicker(line, idx, materials, categories)}
      ${mismatch ? `<label class="invoice-update-price-row"><input type="checkbox" class="invoice-update-price" data-idx="${idx}" ${line.updatePrice ? 'checked' : ''}> עדכן מחיר (יישמר בהיסטוריה)</label>` : ''}
    </div>`;
}

function visibleLineIndexes(state) {
  return filterInvoiceDraftsByName(state.drafts, state.lineFilter);
}

function applyVisibleLineFilter(host, state) {
  const visible = new Set(visibleLineIndexes(state));
  host.querySelectorAll('.invoice-line-card[data-idx]').forEach((card) => {
    card.hidden = !visible.has(Number(card.dataset.idx));
  });
  const empty = host.querySelector('#invoice-line-search-empty');
  if (empty) empty.hidden = visible.size > 0;
  const count = host.querySelector('#invoice-line-search-count');
  if (count) {
    const total = state.drafts.length;
    count.textContent = state.lineFilter?.trim()
      ? `${visible.size} מתוך ${total} שורות`
      : `${total} שורות`;
  }
}

function refreshMatchResults(host, state, idx) {
  const line = state.drafts[idx];
  if (!line) return;
  const box = host.querySelector(`.invoice-match-results[data-idx="${idx}"]`);
  if (box) box.innerHTML = renderMatchResults(matchHitsForLine(line, state.materials), line, idx, state.categories);
}

function applyLineAction(state, idx, { action, materialId = null, role = null }) {
  const line = state.drafts[idx];
  if (!line) return;
  if (role) {
    line.itemRole = role;
    line.roleTouched = true;
  }
  if (action === 'create') {
    line.action = 'create';
    line.materialId = null;
    line.price = { status: 'unknown' };
    if (!line.itemRole) line.itemRole = guessInvoiceItemRole(line, null, state.categories);
    return;
  }
  if (action === 'skip') {
    line.action = 'skip';
    line.materialId = null;
    line.price = { status: 'unknown' };
    return;
  }
  if (materialId != null) {
    const mat = state.materials.find((m) => Number(m.id) === Number(materialId));
    line.action = 'link';
    line.materialId = Number(materialId);
    line.price = mat ? compareInvoicePrice(line, mat) : { status: 'unknown' };
    line.firstScan = mat ? isFirstMaterialScan(mat) : true;
    if (!line.roleTouched) line.itemRole = materialRole(mat, state.categories);
  }
}

function patchLineFields(state, idx, patch) {
  const line = state.drafts[idx];
  if (!line) return;
  const mat = state.materials.find((m) => Number(m.id) === Number(line.materialId));
  const next = applyInvoiceLineFieldPatch(line, patch, mat || null);
  Object.assign(line, next);
  if ('name' in patch || 'sku' in patch) {
    line.matches = searchMaterialsByName(line.name, state.materials, { limit: 8, minScore: 45 });
    if (!line.roleTouched) {
      const linked = mat || null;
      line.itemRole = guessInvoiceItemRole(line, linked, state.categories);
    }
  }
}

export async function renderInvoiceReview(host, ctx) {
  if (!host) return;
  const state = {
    parsed: ctx.parsed,
    drafts: ctx.drafts,
    suppliers: ctx.suppliers,
    materials: ctx.materials,
    categories: ctx.categories,
    files: ctx.files,
    supplierId: ctx.supplierId,
    lineFilter: ctx.lineFilter || '',
    wizardIndex: 0,
    onSaved: ctx.onSaved,
  };
  host._invoiceState = state;

  const paint = async ({ restoreFocus = null } = {}) => {
    const s = host._invoiceState || state;
    const { parsed, drafts, suppliers, materials, categories } = s;
    const supplierOpts = [`<option value="">לא זוהה / בחר ספק</option>`]
      .concat(suppliers.map((row) => `<option value="${row.id}" ${Number(row.id) === Number(s.supplierId) ? 'selected' : ''}>${escapeHtml(row.name)}</option>`))
      .join('');
    const firstQueue = drafts.filter((d) => d.action !== 'skip' && (d.firstScan || !d.materialId));
    if (s.wizardIndex > firstQueue.length) s.wizardIndex = firstQueue.length;
    const wizard = firstQueue[s.wizardIndex];
    const wizardMat = wizard ? materials.find((m) => Number(m.id) === Number(wizard.materialId)) : null;
    const wizardHist = wizardMat ? await getCombinedPriceHistory(wizardMat.id) : [];
    const wizardUnknown = wizard && !wizard.materialId;
    const wizardIdx = wizard ? drafts.indexOf(wizard) : -1;
    const visible = new Set(visibleLineIndexes(s));

    host.innerHTML = `
      <h3 class="card-title">בדיקה לפני שמירה</h3>
      <div class="form-group">
        <label>ספק (מהחשבונית: ${escapeHtml(parsed.supplierName || 'לא זוהה')})</label>
        <select id="invoice-supplier">${supplierOpts}</select>
      </div>
      <div class="invoice-header-edit">
        <label>מספר חשבונית
          <input id="invoice-number" value="${escapeAttr(parsed.invoiceNumber || '')}">
        </label>
        <label>תאריך
          <input id="invoice-date" value="${escapeAttr(parsed.invoiceDate || '')}" placeholder="YYYY-MM-DD">
        </label>
      </div>
      ${wizard && wizardIdx >= 0 ? `
        <div class="invoice-wizard">
          <h4>${wizardUnknown ? 'חומר לא מוכר' : 'סריקה ראשונה'} ${s.wizardIndex + 1} / ${firstQueue.length}</h4>
          ${wizardMat ? materialProfileHTML(wizardMat, { suppliers, history: wizardHist, categories }) : '<p class="form-hint">אין פרופיל קיים — חפשו לפי שם, שייכו לקטגוריה, או צרו חדש.</p>'}
          <div class="invoice-extracted">
            <div>מהחשבונית: <strong>${escapeHtml(wizard.name)}</strong></div>
            <div>מק״ט ${escapeHtml(wizard.sku || '—')} · ${wizard.quantity || ''} ${escapeHtml(wizard.unit || '')}</div>
            <div>אריזה ${wizard.packageWeightKg || extractPackageKgFromName(wizard.name) || '—'} ק״ג · מחיר ${formatMoney(wizard.unitPrice)} (${escapeHtml(wizard.priceBasis || '')})</div>
            ${wizard.price?.status === 'mismatch' ? `<div class="invoice-price-mismatch">המחיר לא תואם (${wizard.price.direction === 'up' ? 'יקר יותר אצל הספק' : 'זול יותר'})</div>` : ''}
          </div>
          ${renderRoleChips(wizard, wizardIdx)}
          ${renderMatchPicker(wizard, wizardIdx, materials, categories)}
          <div class="invoice-wizard-actions">
            <button type="button" class="btn btn-primary" id="wiz-confirm">${wizardUnknown ? 'המשך' : 'אשר ושדרג את הפרופיל'}</button>
            <button type="button" class="btn btn-secondary" id="wiz-skip">דלג</button>
          </div>
        </div>` : '<p class="form-hint">אין שורות ראשונות שממתינות לאישור פרופיל.</p>'}
      <div class="form-group invoice-line-search-wrap">
        <label for="invoice-line-search">חיפוש לפי שם חומר גלם בשורות שחולצו</label>
        <input type="search" id="invoice-line-search" placeholder="למשל קמח, שמן, קרטון..."
          value="${escapeAttr(s.lineFilter || '')}" autocomplete="off">
        <p class="form-hint" id="invoice-line-search-count"></p>
      </div>
      <div class="invoice-lines">
        ${drafts.map((line, idx) => renderLineCard(line, idx, materials, suppliers, categories, { hidden: !visible.has(idx) })).join('')}
      </div>
      <p class="form-hint" id="invoice-line-search-empty" hidden>אין שורות שמתאימות לחיפוש.</p>
      <button type="button" class="btn btn-primary" id="invoice-save" style="width:100%;margin-top:12px">שמור סריקה והחל שינויים</button>
    `;
    applyVisibleLineFilter(host, s);

    if (restoreFocus) {
      const el = host.querySelector(restoreFocus);
      if (el) {
        el.focus();
        if (typeof el.setSelectionRange === 'function' && el.value) {
          const len = el.value.length;
          try { el.setSelectionRange(len, len); } catch { /* ignore */ }
        }
      }
    }
  };

  const currentState = () => host._invoiceState || state;

  const bindOnce = () => {
    if (host._invoiceReviewBound) return;
    host._invoiceReviewBound = true;

    host.addEventListener('change', (e) => {
      const s = currentState();
      if (e.target.id === 'invoice-supplier') {
        s.supplierId = e.target.value ? Number(e.target.value) : null;
        s.drafts.forEach((d) => { d.supplierId = s.supplierId; });
        return;
      }
      if (e.target.classList.contains('invoice-update-price')) {
        const idx = Number(e.target.dataset.idx);
        if (s.drafts[idx]) s.drafts[idx].updatePrice = e.target.checked;
        return;
      }
      if (e.target.dataset?.field === 'priceBasis') {
        const idx = Number(e.target.dataset.idx);
        patchLineFields(s, idx, { priceBasis: e.target.value });
        (host._invoicePaint || paint)({ restoreFocus: `.invoice-edit-basis[data-idx="${idx}"]` });
      }
    });

    host.addEventListener('input', (e) => {
      const s = currentState();
      if (e.target.id === 'invoice-line-search') {
        s.lineFilter = e.target.value;
        applyVisibleLineFilter(host, s);
        return;
      }
      if (e.target.id === 'invoice-number') {
        s.parsed.invoiceNumber = e.target.value;
        return;
      }
      if (e.target.id === 'invoice-date') {
        s.parsed.invoiceDate = e.target.value;
        return;
      }
      if (e.target.classList.contains('invoice-match-search')) {
        const idx = Number(e.target.dataset.idx);
        if (!s.drafts[idx]) return;
        s.drafts[idx].matchQuery = e.target.value;
        refreshMatchResults(host, s, idx);
        return;
      }
      const field = e.target.dataset?.field;
      if (field && field !== 'priceBasis') {
        const idx = Number(e.target.dataset.idx);
        patchLineFields(s, idx, { [field]: e.target.value });
        if (field === 'name' || field === 'sku') {
          const title = host.querySelector(`.invoice-line-card[data-idx="${idx}"] .invoice-line-title`);
          if (title) title.textContent = s.drafts[idx].name || 'בלי שם';
          refreshMatchResults(host, s, idx);
        }
      }
    });

    host.addEventListener('click', async (e) => {
      const s = currentState();
      const roleBtn = e.target.closest('.invoice-role-chip');
      if (roleBtn) {
        const idx = Number(roleBtn.dataset.idx);
        applyLineAction(s, idx, { role: roleBtn.dataset.role });
        const restore = `.invoice-role-chip[data-idx="${idx}"][data-role="${roleBtn.dataset.role}"]`;
        await (host._invoicePaint || paint)({ restoreFocus: restore });
        return;
      }
      const hitBtn = e.target.closest('.invoice-match-hit');
      if (hitBtn) {
        const idx = Number(hitBtn.dataset.idx);
        applyLineAction(s, idx, { materialId: Number(hitBtn.dataset.materialId) });
        await (host._invoicePaint || paint)();
        return;
      }
      const actionBtn = e.target.closest('.invoice-action-btn');
      if (actionBtn) {
        const idx = Number(actionBtn.dataset.idx);
        applyLineAction(s, idx, { action: actionBtn.dataset.action });
        await (host._invoicePaint || paint)();
        return;
      }
      if (e.target.id === 'wiz-confirm') {
        const firstQueue = s.drafts.filter((d) => d.action !== 'skip' && (d.firstScan || !d.materialId));
        const wizard = firstQueue[s.wizardIndex];
        if (wizard && !wizard.materialId && wizard.action !== 'create') {
          showToast('חפשו חומר קיים לפי שם, או צרו חדש');
          return;
        }
        if (wizard && wizard.materialId && wizard.action !== 'skip' && wizard.action !== 'create') {
          wizard.action = 'link';
        }
        s.wizardIndex += 1;
        await (host._invoicePaint || paint)();
        return;
      }
      if (e.target.id === 'wiz-skip') {
        const firstQueue = s.drafts.filter((d) => d.action !== 'skip' && (d.firstScan || !d.materialId));
        const wizard = firstQueue[s.wizardIndex];
        if (wizard) wizard.action = 'skip';
        s.wizardIndex += 1;
        await (host._invoicePaint || paint)();
        return;
      }
      if (e.target.id === 'invoice-save') {
        try {
          for (const line of s.drafts) {
            const catId = await categoryIdForInvoiceRole(line.itemRole || 'raw', s.categories[0]?.id || null);
            await applyInvoiceLine(line, {
              supplierId: s.supplierId,
              supplierCategoryId: catId,
              recategorize: line.action === 'create' || !!line.roleTouched,
              updatePrice: line.updatePrice && line.price?.status === 'mismatch',
            });
          }
          let thumbnail = '';
          if (s.files?.[0] && String(s.files[0].type || '').startsWith('image/')) {
            try {
              const { compressInvoiceFile } = await import('../invoice-ai.js?v=553');
              const part = await compressInvoiceFile(s.files[0], { maxEdge: 480, quality: 0.5 });
              thumbnail = part.dataUrl;
            } catch { /* ignore */ }
          }
          await saveInvoiceScan({
            supplierId: s.supplierId,
            supplierName: s.parsed.supplierName,
            invoiceNumber: s.parsed.invoiceNumber,
            invoiceDate: s.parsed.invoiceDate,
            notes: s.parsed.notes,
            thumbnail,
            fileName: s.files?.[0]?.name || '',
            lines: s.drafts,
          });
          requestAutoBackupNow().catch(() => {});
          showToast('הסריקה נשמרה');
          if (typeof s.onSaved === 'function') await s.onSaved();
        } catch (err) {
          showToast(err.message || 'שמירה נכשלה');
        }
      }
    });
  };

  host._invoicePaint = paint;
  bindOnce();
  await paint();
}
