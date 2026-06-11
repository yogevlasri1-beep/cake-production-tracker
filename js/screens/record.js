import {
  getProducts, getCategories, getEntriesForDate,
  addProductionEntry, updateProductionEntry, deleteProductionEntry,
} from '../db.js';
import { todayISO, formatDate, showToast, escapeHtml } from '../utils.js';
import { openModal, closeModal } from '../modal.js';

export async function renderRecord(container) {
  const date = container.dataset.selectedDate || todayISO();
  const selectedCategory = container.dataset.selectedCategory || '';

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
          <label for="record-qty">כמות</label>
          <input type="number" id="record-qty" min="1" step="1" placeholder="לדוגמה: 50" required>
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
                <strong style="margin-left:8px">${e.quantity}</strong>
                <button class="btn btn-secondary btn-sm btn-icon edit-entry" data-id="${e.id}" title="ערוך">✏️</button>
                <button class="btn btn-danger btn-sm btn-icon delete-entry" data-id="${e.id}" title="מחק">🗑</button>
              </div>
            </div>`;
          }).join('')}
    </div>`;

  document.getElementById('record-date').addEventListener('change', (e) => {
    container.dataset.selectedDate = e.target.value;
    renderRecord(container);
  });

  document.getElementById('record-category').addEventListener('change', (e) => {
    container.dataset.selectedCategory = e.target.value;
    renderRecord(container);
  });

  document.getElementById('record-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = document.getElementById('record-date').value;
    const productId = document.getElementById('record-product').value;
    const quantity = document.getElementById('record-qty').value;
    if (!productId) return showToast('בחר קטגוריה ומוצר');
    await addProductionEntry({ date: d, productId, quantity });
    showToast('הרישום נשמר ✓');
    document.getElementById('record-qty').value = '';
    container.dataset.selectedDate = d;
    renderRecord(container);
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

function editEntry(id, entries, productMap, container) {
  const entry = entries.find((e) => e.id === Number(id));
  const p = productMap.get(entry.productId);
  openModal({
    title: 'עריכת רישום',
    bodyHTML: `
      <div class="form-group">
        <label>מוצר</label>
        <input type="text" value="${escapeHtml(p?.name || '')}" disabled>
      </div>
      <div class="form-group">
        <label for="edit-qty">כמות</label>
        <input type="number" id="edit-qty" min="1" value="${entry.quantity}">
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="edit-save">שמור</button>`,
  });

  document.querySelector('.modal-cancel').addEventListener('click', closeModal);
  document.getElementById('edit-save').addEventListener('click', async () => {
    await updateProductionEntry(entry.id, { quantity: Number(document.getElementById('edit-qty').value) });
    closeModal();
    showToast('עודכן ✓');
    renderRecord(container);
  });
}

export function recordMeta() {
  return { title: 'רישום ייצור', subtitle: 'בחר קטגוריה ואז מוצר' };
}
