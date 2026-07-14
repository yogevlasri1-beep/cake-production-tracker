import {
  getProducts, getCategories, getEntriesForDate,
  addProductionEntry, updateProductionEntry, deleteProductionEntry,
} from '../db.js?v=302';
import { todayISO, formatDate, showToast, escapeHtml, productUnitLabel, formatProductQuantity, productRecordUsesKg, formatDecimal } from '../utils.js?v=302';
import { openModal, closeModal } from '../modal.js?v=302';
import { renderSheetsStatusHTML, bindSheetsStatusEvents } from '../sheets-flow.js?v=302';

export async function renderRecord(container) {
  const date = container.dataset.selectedDate || todayISO();
  const selectedCategory = container.dataset.selectedCategory || '';
  const sheetsHTML = await renderSheetsStatusHTML();

  const [products, categories, entries] = await Promise.all([
    getProducts(true),
    getCategories(),
    getEntriesForDate(date),
  ]);

  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const productMap = new Map(products.map((p) => [p.id, p]));

  const categoryOptions = categories
    .map((c) => `<option value="${c.id}" ${String(c.id) === selectedCategory ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');

  const filteredProducts = selectedCategory
    ? products.filter((p) => String(p.categoryId) === selectedCategory)
    : [];

  const productOptions = filteredProducts
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join('');

  container.innerHTML = `
    <div class="card">
      <form id="record-form">
        <div class="form-group">
          <label for="record-date">תאריך</label>
          <input type="date" id="record-date" value="${date}" required>
        </div>
        <div class="form-group">
          <label for="record-category">קטגוריה</label>
          <select id="record-category" required ${categories.length === 0 ? 'disabled' : ''}>
            <option value="">בחר קטגוריה...</option>
            ${categoryOptions}
          </select>
        </div>
        <div class="form-group">
          <label for="record-product">מוצר</label>
          <select id="record-product" required ${!selectedCategory || filteredProducts.length === 0 ? 'disabled' : ''}>
            <option value="">${selectedCategory ? 'בחר מוצר...' : 'קודם בחר קטגוריה'}</option>
            ${productOptions}
          </select>
        </div>
        <div class="form-group">
          <label for="record-qty" id="record-qty-label">כמות (יח')</label>
          <input type="number" id="record-qty" min="1" step="1" placeholder="לדוגמה: 50" required>
          <p class="form-hint hidden" id="record-qty-hint"></p>
        </div>
        <button type="submit" class="btn btn-primary" ${categories.length === 0 ? 'disabled' : ''}>
          שמור רישום
        </button>
      </form>
    </div>

    <div class="card">
      <div class="card-title">רישומים ל-${formatDate(date)}</div>
      ${entries.length === 0
        ? '<p style="color:var(--text-muted);font-size:0.9rem;text-align:center;padding:12px">אין רישומים לתאריך זה</p>'
        : entries.map((e) => {
            const p = productMap.get(e.productId);
            return `<div class="list-item" data-entry-id="${e.id}">
              <div class="list-item-info">
                <div class="list-item-name">${escapeHtml(p?.name || '—')}</div>
                <div class="list-item-meta">${escapeHtml(catMap.get(p?.categoryId) || '')}</div>
              </div>
              <div class="list-item-actions">
                <strong style="margin-left:8px">${formatProductQuantity(p, e.quantity)}</strong>
                <button class="btn btn-secondary btn-sm btn-icon edit-entry" data-id="${e.id}" title="ערוך">✏️</button>
                <button class="btn btn-danger btn-sm btn-icon delete-entry" data-id="${e.id}" title="מחק">🗑</button>
              </div>
            </div>`;
          }).join('')}
    </div>

    <div class="card sheets-primary-card">
      <div class="card-title">📊 Google Sheets</div>
      <div id="sheets-status">${sheetsHTML}</div>
    </div>

    <details class="card import-card">
      <summary class="import-summary">ייבוא מקובץ Excel (גיבוי)</summary>
      <p class="import-hint">
        העלה קובץ Excel או CSV עם התיעוד שלך (סוג, תאריך, כמות).
        מוצרים וקטגוריות חדשים ייווצרו אוטומטית.
      </p>
      <input type="file" id="record-import-file" accept=".csv,.xlsx,.xls,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" hidden>
      <button type="button" class="btn btn-secondary" id="record-import-btn" style="width:100%;margin-bottom:8px">
        📥 בחר קובץ Excel / CSV
      </button>
      <button type="button" class="btn btn-secondary btn-sm" id="record-template-btn" style="width:100%">
        הורד קובץ דוגמה
      </button>
    </details>`;

  document.getElementById('record-date').addEventListener('change', (e) => {
    container.dataset.selectedDate = e.target.value;
    renderRecord(container);
  });

  bindSheetsStatusEvents(container, {
    onRefresh: () => renderRecord(container),
    onImportComplete: () => renderRecord(container),
  });

  document.getElementById('record-category').addEventListener('change', (e) => {
    container.dataset.selectedCategory = e.target.value;
    renderRecord(container);
  });

  function syncQtyField(productId) {
    const p = productMap.get(Number(productId));
    const qtyInput = document.getElementById('record-qty');
    const qtyLabel = document.getElementById('record-qty-label');
    if (!qtyInput || !qtyLabel) return;
    const isKg = productRecordUsesKg(p);
    qtyLabel.textContent = isKg ? 'משקל (ק"ג)' : "כמות (יח')";
    qtyInput.min = isKg ? '0.001' : '1';
    qtyInput.step = isKg ? '0.001' : '1';
    qtyInput.placeholder = isKg ? 'לדוגמה: 2.5' : 'לדוגמה: 50';
    const hint = document.getElementById('record-qty-hint');
    if (hint) {
      hint.textContent = p?.priceUnit === 'kg_with_units'
        ? `רישום בק"ג · מחיר לק"ג${p.unitWeightKg ? ` · ~${p.unitWeightKg} ק"ג ליחידה` : ''}`
        : p?.priceUnit === 'kg_units'
          ? `מחיר ללקוח לפי ק"ג${p.unitWeightKg ? ` · ~${p.unitWeightKg} ק"ג ליחידה` : ''}`
          : '';
      hint.classList.toggle('hidden', p?.priceUnit !== 'kg_units' && p?.priceUnit !== 'kg_with_units');
    }
  }

  document.getElementById('record-product')?.addEventListener('change', (e) => {
    syncQtyField(e.target.value);
  });
  syncQtyField(document.getElementById('record-product')?.value);

  document.getElementById('record-import-btn')?.addEventListener('click', () => {
    document.getElementById('record-import-file').click();
  });

  document.getElementById('record-template-btn')?.addEventListener('click', async () => {
    const { CSV_TEMPLATE_BLOCKS } = await import('../import.js');
    const blob = new Blob(['\ufeff' + CSV_TEMPLATE_BLOCKS], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dugma-yitzur.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById('record-import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await handleRecordImport(file, container);
  });

  document.getElementById('record-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = document.getElementById('record-date').value;
    const productId = document.getElementById('record-product').value;
    const quantity = document.getElementById('record-qty').value;
    if (!productId) return showToast('בחר קטגוריה ומוצר');
    try {
      await addProductionEntry({ date: d, productId, quantity });
      showToast('הרישום נשמר ✓');
      document.getElementById('record-qty').value = '';
      container.dataset.selectedDate = d;
      renderRecord(container);
    } catch (err) {
      showToast(err.message || 'שגיאה בשמירה');
    }
  });

  container.querySelectorAll('.edit-entry').forEach((btn) => {
    btn.addEventListener('click', () => editEntry(btn.dataset.id, entries, productMap, container));
  });

  container.querySelectorAll('.delete-entry').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('למחוק את הרישום?')) {
        await deleteProductionEntry(Number(btn.dataset.id));
        showToast('נמחק');
        renderRecord(container);
      }
    });
  });
}

async function handleRecordImport(file, container) {
  const { handleProductionImportFile } = await import('../import-flow.js');
  await handleProductionImportFile(file, {
    onComplete: async () => renderRecord(container),
  });
}

function editEntry(id, entries, productMap, container) {
  const entry = entries.find((e) => e.id === Number(id));
  const p = productMap.get(entry.productId);
  const isKg = productRecordUsesKg(p);
  openModal({
    title: 'עריכת רישום',
    bodyHTML: `
      <div class="form-group">
        <label>מוצר</label>
        <input type="text" value="${escapeHtml(p?.name || '')}" disabled>
      </div>
      <div class="form-group">
        <label for="edit-qty">${isKg ? 'משקל (ק"ג)' : 'כמות (יח\')'}</label>
        <input type="number" id="edit-qty" min="${isKg ? '0.001' : '1'}" step="${isKg ? '0.001' : '1'}" value="${formatDecimal(entry.quantity)}">
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="edit-save">שמור</button>`,
  });

  document.querySelector('.modal-cancel').addEventListener('click', closeModal);
  document.getElementById('edit-save').addEventListener('click', async () => {
    try {
      await updateProductionEntry(entry.id, { quantity: document.getElementById('edit-qty').value });
      closeModal();
      showToast('עודכן ✓');
      renderRecord(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

export function recordMeta() {
  return { title: 'רישום ייצור', subtitle: 'רישום ידני' };
}
