import {
  getSuppliers, getRawMaterials, getSupplierCategories, getCombinedPriceHistory,
  sanitizeSku, sanitizeMinOrderQty, getMaterialSynonyms, computePricePerKg,
  packageWeightKgFromGrams, formatKgWeight,
} from '../kitchen-db.js?v=542';
import { escapeHtml, showToast, formatMoney, formatDate, formatDateTime } from '../utils.js?v=542';
import { openModal, closeModal } from '../modal.js?v=542';
import {
  suggestMaterialMatches, suggestSupplierMatches, compareInvoicePrice,
  isFirstMaterialScan, extractPackageKgFromName,
} from '../invoice-match.js?v=542';
import { parseInvoiceFiles, getInvoiceAiKey, setInvoiceAiKey } from '../invoice-ai.js?v=542';
import { listInvoiceScans, getInvoiceScan, saveInvoiceScan, applyInvoiceLine } from '../invoice-scan-db.js?v=542';
import { requestAutoBackupNow } from '../backup-service.js?v=542';

export const invoiceScanMeta = {
  title: 'סריקת מסמכים',
  subtitle: 'חשבוניות ספקים → מחירים, מק״ט וכמות באריזה',
};

function priceStatusClass(status) {
  if (status === 'mismatch') return 'invoice-price-mismatch';
  if (status === 'match') return 'invoice-price-match';
  return '';
}

function materialProfileHTML(mat, { suppliers = [], history = [] } = {}) {
  if (!mat) return '<p class="form-hint">אין חומר מקושר</p>';
  const sup = suppliers.find((s) => Number(s.id) === Number(mat.supplierId));
  const syn = getMaterialSynonyms(mat);
  const perKg = computePricePerKg(mat.unitPrice, mat.packageWeightGrams);
  const hist = (history || []).slice(0, 5);
  return `
    <div class="invoice-profile">
      <div class="invoice-profile-name">${escapeHtml(mat.name)}</div>
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

function lineDraftFromParsed(line, materials, suppliers, supplierId) {
  const matches = suggestMaterialMatches(line, materials);
  const best = matches[0] || null;
  const material = best?.material || null;
  const price = material ? compareInvoicePrice(line, material) : { status: 'unknown' };
  return {
    ...line,
    packageWeightKg: line.packageWeightKg || extractPackageKgFromName(line.name),
    matches,
    materialId: material?.id || null,
    action: material ? 'link' : 'review',
    firstScan: material ? isFirstMaterialScan(material) : true,
    price,
    updatePrice: false,
    supplierId,
  };
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
      const parsed = await parseInvoiceFiles(chosenFiles, { suppliers, materials });
      const supplierHits = suggestSupplierMatches(parsed.supplierName, suppliers);
      const supplierId = supplierHits[0]?.supplier?.id || null;
      const drafts = parsed.lines.map((line) => lineDraftFromParsed(line, materials, suppliers, supplierId));
      await renderReview(container, {
        parsed, drafts, suppliers, materials, categories, supplierId, files: chosenFiles,
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
                <span>${line.quantity || ''} ${escapeHtml(line.unit || '')} · ${formatMoney(line.unitPrice)} · ${escapeHtml(line.action || '')}</span>
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

async function renderReview(container, ctx) {
  const host = document.getElementById('invoice-review-host');
  if (!host) return;
  const { parsed, drafts, suppliers, materials, categories, files } = ctx;
  let supplierId = ctx.supplierId;
  const firstQueue = drafts.filter((d) => d.action !== 'skip' && (d.firstScan || !d.materialId));
  let wizardIndex = 0;

  const paint = async () => {
    const supplierOpts = [`<option value="">לא זוהה / בחר ספק</option>`]
      .concat(suppliers.map((s) => `<option value="${s.id}" ${Number(s.id) === Number(supplierId) ? 'selected' : ''}>${escapeHtml(s.name)}</option>`))
      .join('');
    const wizard = firstQueue[wizardIndex];
    const wizardMat = wizard ? materials.find((m) => Number(m.id) === Number(wizard.materialId)) : null;
    const wizardHist = wizardMat ? await getCombinedPriceHistory(wizardMat.id) : [];
    const wizardUnknown = wizard && !wizard.materialId;

    host.innerHTML = `
      <h3 class="card-title">בדיקה לפני שמירה</h3>
      <div class="form-group">
        <label>ספק (מהחשבונית: ${escapeHtml(parsed.supplierName || 'לא זוהה')})</label>
        <select id="invoice-supplier">${supplierOpts}</select>
      </div>
      <p class="form-hint">חשבונית ${escapeHtml(parsed.invoiceNumber || '—')} · ${escapeHtml(parsed.invoiceDate || '—')}</p>
      ${wizard ? `
        <div class="invoice-wizard">
          <h4>${wizardUnknown ? 'חומר לא מוכר' : 'סריקה ראשונה'} ${wizardIndex + 1} / ${firstQueue.length}</h4>
          ${wizardMat ? materialProfileHTML(wizardMat, { suppliers, history: wizardHist }) : '<p class="form-hint">אין פרופיל קיים — בחר חומר דומה או צור חדש.</p>'}
          <div class="invoice-extracted">
            <div>מהחשבונית: <strong>${escapeHtml(wizard.name)}</strong></div>
            <div>מק״ט ${escapeHtml(wizard.sku || '—')} · ${wizard.quantity || ''} ${escapeHtml(wizard.unit || '')}</div>
            <div>אריזה ${wizard.packageWeightKg || '—'} ק״ג · מחיר ${formatMoney(wizard.unitPrice)} (${escapeHtml(wizard.priceBasis || '')})</div>
            ${wizard.price?.status === 'mismatch' ? `<div class="invoice-price-mismatch">המחיר לא תואם (${wizard.price.direction === 'up' ? 'יקר יותר אצל הספק' : 'זול יותר'})</div>` : ''}
          </div>
          ${wizardUnknown ? `
            <label class="form-hint">שייך לחומר קיים עם שם דומה</label>
            <select class="invoice-match-select" data-idx="${drafts.indexOf(wizard)}">
              ${renderMatchOptions(wizard, materials)}
            </select>` : ''}
          <div class="invoice-wizard-actions">
            <button type="button" class="btn btn-primary" id="wiz-confirm">${wizardUnknown ? 'המשך' : 'אשר ושדרג את הפרופיל'}</button>
            <button type="button" class="btn btn-secondary" id="wiz-skip">דלג</button>
          </div>
        </div>` : '<p class="form-hint">אין שורות ראשונות שממתינות לאישור פרופיל.</p>'}
      <div class="invoice-lines">
        ${drafts.map((line, idx) => renderLineCard(line, idx, materials, suppliers)).join('')}
      </div>
      <button type="button" class="btn btn-primary" id="invoice-save" style="width:100%;margin-top:12px">שמור סריקה והחל שינויים</button>
    `;

    host.querySelector('#invoice-supplier')?.addEventListener('change', (e) => {
      supplierId = e.target.value ? Number(e.target.value) : null;
      drafts.forEach((d) => { d.supplierId = supplierId; });
    });
    host.querySelector('#wiz-confirm')?.addEventListener('click', () => {
      if (wizardUnknown && (!wizard.action || wizard.action === 'review')) {
        showToast('בחר חומר קיים עם שם דומה, או צור חדש');
        return;
      }
      if (wizard && wizard.materialId && wizard.action !== 'skip' && wizard.action !== 'create') {
        wizard.action = 'link';
      }
      wizardIndex += 1;
      paint();
    });
    host.querySelector('#wiz-skip')?.addEventListener('click', () => {
      if (wizard) wizard.action = 'skip';
      wizardIndex += 1;
      paint();
    });

    host.querySelectorAll('.invoice-match-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const idx = Number(sel.dataset.idx);
        const val = sel.value;
        const line = drafts[idx];
        if (val === 'create') {
          line.action = 'create';
          line.materialId = null;
        } else if (val === 'skip') {
          line.action = 'skip';
          line.materialId = null;
        } else {
          line.action = 'link';
          line.materialId = Number(val);
          const mat = materials.find((m) => Number(m.id) === Number(val));
          line.price = mat ? compareInvoicePrice(line, mat) : { status: 'unknown' };
          line.firstScan = mat ? isFirstMaterialScan(mat) : true;
        }
        paint();
      });
    });
    host.querySelectorAll('.invoice-update-price').forEach((box) => {
      box.addEventListener('change', () => {
        drafts[Number(box.dataset.idx)].updatePrice = box.checked;
      });
    });
    host.querySelector('#invoice-save')?.addEventListener('click', async () => {
      const catId = categories[0]?.id || null;
      try {
        for (const line of drafts) {
          await applyInvoiceLine(line, {
            supplierId,
            supplierCategoryId: catId,
            updatePrice: line.updatePrice && line.price?.status === 'mismatch',
          });
        }
        let thumbnail = '';
        if (files?.[0] && String(files[0].type || '').startsWith('image/')) {
          try {
            const { compressInvoiceFile } = await import('../invoice-ai.js?v=542');
            const part = await compressInvoiceFile(files[0], { maxEdge: 480, quality: 0.5 });
            thumbnail = part.dataUrl;
          } catch { /* ignore */ }
        }
        await saveInvoiceScan({
          supplierId,
          supplierName: parsed.supplierName,
          invoiceNumber: parsed.invoiceNumber,
          invoiceDate: parsed.invoiceDate,
          notes: parsed.notes,
          thumbnail,
          fileName: files?.[0]?.name || '',
          lines: drafts,
        });
        requestAutoBackupNow().catch(() => {});
        showToast('הסריקה נשמרה');
        await renderInvoiceScan(container);
      } catch (err) {
        showToast(err.message || 'שמירה נכשלה');
      }
    });
  };

  await paint();
}

function renderMatchOptions(line, materials) {
  return [
    `<option value="skip" ${line.action === 'skip' ? 'selected' : ''}>דלג</option>`,
    `<option value="create" ${line.action === 'create' ? 'selected' : ''}>צור חומר גלם חדש</option>`,
    ...(line.matches || []).map((hit) => `
      <option value="${hit.material.id}" ${Number(line.materialId) === Number(hit.material.id) ? 'selected' : ''}>
        שייך ל«${escapeHtml(hit.material.name)}» (${hit.reason})
      </option>`),
    ...materials.filter((m) => !(line.matches || []).some((h) => Number(h.material.id) === Number(m.id)))
      .slice(0, 40)
      .map((m) => `<option value="${m.id}" ${Number(line.materialId) === Number(m.id) ? 'selected' : ''}>שייך ל«${escapeHtml(m.name)}»</option>`),
  ].join('');
}

function renderLineCard(line, idx, materials, suppliers) {
  const mat = materials.find((m) => Number(m.id) === Number(line.materialId));
  const options = renderMatchOptions(line, materials);
  const mismatch = line.price?.status === 'mismatch';
  return `
    <div class="invoice-line-card ${priceStatusClass(line.price?.status)}">
      <div class="invoice-line-title">${escapeHtml(line.name)}</div>
      <div class="form-hint">
        מק״ט ${escapeHtml(line.sku || '—')} · ${line.quantity || ''} ${escapeHtml(line.unit || '')}
        · אריזה ${line.packageWeightKg || '—'} ק״ג
        · ${formatMoney(line.unitPrice)} (${escapeHtml(line.priceBasis || '')})
      </div>
      ${mismatch ? `<div class="invoice-price-mismatch">מחיר לא תואם למה ששמור אצל הספק${line.price.direction === 'up' ? ' — עליית מחיר' : ''}</div>` : ''}
      ${mat ? `<div class="form-hint">שמור אצלנו: ${formatMoney(mat.unitPrice)}${mat.packageWeightGrams ? ` / ${formatKgWeight(mat.packageWeightGrams / 1000)}` : ''}</div>` : ''}
      <label class="form-hint">שיוך</label>
      <select class="invoice-match-select" data-idx="${idx}">${options}</select>
      ${mismatch ? `<label class="invoice-update-price-row"><input type="checkbox" class="invoice-update-price" data-idx="${idx}" ${line.updatePrice ? 'checked' : ''}> עדכן מחיר חומר גלם (יישמר בהיסטוריה)</label>` : ''}
      ${line.action === 'create' ? '<p class="form-hint">ייפתח חומר חדש רק אם אין התאמה קיימת.</p>' : ''}
    </div>`;
}
