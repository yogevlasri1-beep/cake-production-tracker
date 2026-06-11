import {
  getProductsByCategory, addCategory, updateCategory, deleteCategory,
  addProduct, updateProduct, toggleProductActive, getProduct, resetAllData,
  importCatalogRows, importProductionRows,
} from '../db.js';
import { formatMoney, showToast, escapeHtml } from '../utils.js';
import { openModal, closeModal } from '../modal.js';
import { parseImportFile, importParsedRows, previewText, CSV_TEMPLATE_BLOCKS } from '../import.js';

function productPriceMeta(p) {
  const parts = [];
  if (p.unitPrice > 0) parts.push(`ללקוח: ${formatMoney(p.unitPrice)}`);
  const cost = (p.rawMaterialsCost || 0) + (p.packagingCost || 0) + (p.additionalCosts || 0);
  if (cost > 0) parts.push(`עלות: ${formatMoney(cost)}`);
  return parts.length ? parts.join(' · ') : 'ללא מחירים';
}

export async function renderProducts(container) {
  const data = await getProductsByCategory();

  container.innerHTML = `
    <div class="section-header">
      <h2>קטגוריות ומוצרים</h2>
      <button class="btn btn-primary btn-sm" id="add-category-btn">+ קטגוריה</button>
    </div>

    ${data.length === 0
      ? `<div class="empty-state">
          <div class="empty-state-icon">📦</div>
          <p>התחל מאפס — הוסף קטגוריה ראשונה<br>ואז הוסף מוצרים ידנית.</p>
          <button class="btn btn-primary" id="add-category-empty">+ הוסף קטגוריה</button>
        </div>`
      : data.map((cat) => `
        <div class="card" data-category-id="${cat.id}">
          <div class="section-header">
            <div>
              <span class="category-chip">${escapeHtml(cat.name)}</span>
              <span style="font-size:0.78rem;color:var(--text-muted);margin-right:8px">${cat.products.length} מוצרים</span>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-secondary btn-sm edit-cat" data-id="${cat.id}" data-name="${escapeHtml(cat.name)}">✏️</button>
              <button class="btn btn-danger btn-sm delete-cat" data-id="${cat.id}" data-name="${escapeHtml(cat.name)}" data-count="${cat.products.length}">🗑</button>
              <button class="btn btn-primary btn-sm add-product" data-cat="${cat.id}" data-catname="${escapeHtml(cat.name)}">+ מוצר</button>
            </div>
          </div>
          ${cat.products.length === 0
            ? '<p style="color:var(--text-muted);font-size:0.85rem;padding:8px 0">אין מוצרים — לחץ + מוצר</p>'
            : cat.products.map((p) => `
              <div class="list-item ${p.active ? '' : 'inactive-label'}">
                <div class="list-item-info">
                  <div class="list-item-name">${escapeHtml(p.name)}</div>
                  <div class="list-item-meta">${productPriceMeta(p)} ${p.active ? '' : '· לא פעיל'}</div>
                </div>
                <div class="list-item-actions">
                  <button class="btn btn-secondary btn-sm edit-product" data-id="${p.id}">✏️</button>
                  <button class="btn btn-secondary btn-sm toggle-product" data-id="${p.id}">
                    ${p.active ? '🚫' : '✅'}
                  </button>
                </div>
              </div>`).join('')}
        </div>`).join('')}

    <details class="card" style="margin-top:8px">
      <summary style="cursor:pointer;font-weight:600;font-size:0.9rem;color:var(--text-muted)">ייבוא מ-Google Sheets (אופציונלי)</summary>
      <p style="font-size:0.85rem;color:var(--text-muted);margin:12px 0;line-height:1.5">
        קובץ → הורדה → CSV. רק אם תרצה לייבא נתונים קיימים.
      </p>
      <input type="file" id="csv-import" accept=".csv,.xlsx,.xls,.txt" hidden>
      <button class="btn btn-secondary btn-sm" id="import-btn" style="width:100%;margin-bottom:8px">📥 בחר קובץ</button>
      <button class="btn btn-secondary btn-sm" id="template-btn" style="width:100%">הורד קובץ דוגמה</button>
    </details>

    <button class="btn btn-danger btn-sm" id="reset-all" style="width:100%;margin-top:12px">🔄 איפוס — התחלה מאפס</button>`;

  container.querySelector('#add-category-btn')?.addEventListener('click', () => showCategoryForm(container));
  container.querySelector('#add-category-empty')?.addEventListener('click', () => showCategoryForm(container));

  container.querySelectorAll('.delete-cat').forEach((btn) => {
    btn.addEventListener('click', () => confirmDeleteCategory(container, {
      id: Number(btn.dataset.id),
      name: btn.dataset.name,
      productCount: Number(btn.dataset.count),
    }));
  });

  document.getElementById('reset-all')?.addEventListener('click', () => {
    openModal({
      title: 'איפוס כל הנתונים',
      bodyHTML: `<p style="line-height:1.6">פעולה זו תמחק <strong>הכל</strong>: קטגוריות, מוצרים, רישומי ייצור ויעדים.<br><br>להמשיך?</p>`,
      footerHTML: `
        <button class="btn btn-secondary modal-cancel">ביטול</button>
        <button class="btn btn-danger" id="confirm-reset">מחק הכל</button>`,
    });
    document.querySelector('.modal-cancel').addEventListener('click', closeModal);
    document.getElementById('confirm-reset').addEventListener('click', async () => {
      await resetAllData();
      closeModal();
      showToast('הנתונים נמחקו — התחל מחדש');
      renderProducts(container);
    });
  });

  document.getElementById('import-btn')?.addEventListener('click', () => {
    document.getElementById('csv-import').click();
  });

  document.getElementById('csv-import')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const parsed = await parseImportFile(file);
      const { sample, total, categories } = previewText(parsed);
      openModal({
        title: 'אישור ייבוא',
        bodyHTML: `
          <p><strong>${total}</strong> רישומים · <strong>${categories.length}</strong> קטגוריות</p>
          <div style="background:var(--bg);border-radius:10px;padding:12px;font-size:0.82rem;white-space:pre-line;margin-top:10px">${escapeHtml(sample)}</div>`,
        footerHTML: `
          <button class="btn btn-secondary modal-cancel">ביטול</button>
          <button class="btn btn-primary" id="confirm-import">ייבא</button>`,
      });
      document.querySelector('.modal-cancel').addEventListener('click', closeModal);
      document.getElementById('confirm-import').addEventListener('click', async () => {
        const result = await importParsedRows(parsed, {
          importCatalog: importCatalogRows,
          importProduction: importProductionRows,
        });
        closeModal();
        showToast('יובא בהצלחה ✓');
        renderProducts(container);
      });
    } catch (err) {
      showToast(err.message || 'שגיאה בייבוא');
    }
  });

  document.getElementById('template-btn')?.addEventListener('click', () => {
    const blob = new Blob(['\ufeff' + CSV_TEMPLATE_BLOCKS], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dugma-yitzur.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  container.querySelectorAll('.edit-cat').forEach((btn) => {
    btn.addEventListener('click', () => showCategoryForm(container, { id: btn.dataset.id, name: btn.dataset.name }));
  });

  container.querySelectorAll('.add-product').forEach((btn) => {
    btn.addEventListener('click', () => showProductForm(container, { categoryId: Number(btn.dataset.cat), categoryName: btn.dataset.catname }));
  });

  container.querySelectorAll('.edit-product').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const p = await getProduct(Number(btn.dataset.id));
      if (p) showProductForm(container, { ...p });
    });
  });

  container.querySelectorAll('.toggle-product').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await toggleProductActive(Number(btn.dataset.id));
      showToast('עודכן');
      renderProducts(container);
    });
  });
}

function confirmDeleteCategory(container, { id, name, productCount }) {
  openModal({
    title: 'מחיקת קטגוריה',
    bodyHTML: productCount > 0
      ? `<p style="line-height:1.6">למחוק את <strong>${escapeHtml(name)}</strong>?<br><br>יימחקו גם <strong>${productCount}</strong> מוצרים וכל רישומי הייצור שלהם.</p>`
      : `<p>למחוק את <strong>${escapeHtml(name)}</strong>?</p>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-danger" id="confirm-delete-cat">מחק</button>`,
  });

  document.querySelector('.modal-cancel').addEventListener('click', closeModal);
  document.getElementById('confirm-delete-cat').addEventListener('click', async () => {
    await deleteCategory(id, { cascade: true });
    closeModal();
    showToast('הקטגוריה נמחקה');
    renderProducts(container);
  });
}

function showCategoryForm(container, existing) {
  openModal({
    title: existing ? 'עריכת קטגוריה' : 'קטגוריה חדשה',
    bodyHTML: `
      <div class="form-group">
        <label for="cat-name">שם קטגוריה</label>
        <input type="text" id="cat-name" value="${existing ? escapeHtml(existing.name) : ''}" placeholder="לדוגמה: עוגות">
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-cat">שמור</button>`,
  });

  document.querySelector('.modal-cancel').addEventListener('click', closeModal);
  document.getElementById('save-cat').addEventListener('click', async () => {
    const name = document.getElementById('cat-name').value.trim();
    if (!name) return showToast('יש להזין שם');
    if (existing) await updateCategory(Number(existing.id), name);
    else await addCategory(name);
    closeModal();
    showToast('נשמר ✓');
    renderProducts(container);
  });
}

function optionalPriceInput(id, label, value) {
  return `
    <div class="form-group">
      <label for="${id}">${label} <span style="font-weight:400;color:var(--text-muted)">(רשות)</span></label>
      <input type="number" id="${id}" min="0" step="0.5" value="${value != null && value !== '' ? value : ''}" placeholder="—">
    </div>`;
}

async function showProductForm(container, opts) {
  const categories = (await getProductsByCategory()).map((c) => ({ id: c.id, name: c.name }));

  openModal({
    title: opts.id ? 'עריכת מוצר' : `מוצר חדש — ${opts.categoryName || ''}`,
    bodyHTML: `
      <div class="form-group">
        <label for="prod-name">שם מוצר *</label>
        <input type="text" id="prod-name" value="${opts.name ? escapeHtml(opts.name) : ''}" placeholder="לדוגמה: עוגת שוקולד">
      </div>
      <div class="form-group">
        <label for="prod-cat">קטגוריה</label>
        <select id="prod-cat">
          ${categories.map((c) => `<option value="${c.id}" ${c.id === opts.categoryId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      ${optionalPriceInput('prod-price', 'מחיר משוער ללקוח (₪)', opts.unitPrice)}
      ${optionalPriceInput('prod-raw', 'מחיר חומרי גלם (₪)', opts.rawMaterialsCost)}
      ${optionalPriceInput('prod-pack', 'מחיר אריזה (₪)', opts.packagingCost)}
      ${optionalPriceInput('prod-extra', 'עלויות נוספות (₪)', opts.additionalCosts)}`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-prod">שמור</button>`,
  });

  document.querySelector('.modal-cancel').addEventListener('click', closeModal);
  document.getElementById('save-prod').addEventListener('click', async () => {
    const name = document.getElementById('prod-name').value.trim();
    if (!name) return showToast('יש להזין שם מוצר');

    const data = {
      name,
      categoryId: Number(document.getElementById('prod-cat').value),
      unitPrice: document.getElementById('prod-price').value,
      rawMaterialsCost: document.getElementById('prod-raw').value,
      packagingCost: document.getElementById('prod-pack').value,
      additionalCosts: document.getElementById('prod-extra').value,
    };

    if (opts.id) await updateProduct(opts.id, data);
    else await addProduct(data);
    closeModal();
    showToast('נשמר ✓');
    renderProducts(container);
  });
}

export function productsMeta() {
  return { title: 'מוצרים', subtitle: 'הוסף קטגוריות ומוצרים ידנית' };
}
