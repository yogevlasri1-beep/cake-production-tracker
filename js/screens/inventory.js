import { escapeHtml, showToast, formatDateTime } from '../utils.js?v=418';
import { openModal, closeModal } from '../modal.js?v=418';
import { requestAutoBackupNow } from '../backup-service.js?v=418';
import {
  getInventoryStockRows,
  adjustInventoryStock,
  addInventoryItemToShortages,
  inventoryLowCount,
} from '../inventory-db.js?v=418';
import { getSupplierCategories } from '../kitchen-db.js?v=418';

export function inventoryMeta() {
  return {
    title: 'מלאי',
    subtitle: 'יתרות חומרי גלם והתאמות מלאי',
  };
}

function stockBadge(row) {
  if (row.isLow) {
    return `<span class="accounts-status accounts-status--danger">מתחת למינימום</span>`;
  }
  if (!row.balance) {
    return `<span class="accounts-status accounts-status--warn">לא הוגדר</span>`;
  }
  return `<span class="accounts-status accounts-status--ok">תקין</span>`;
}

function formatQty(n, unit) {
  const q = Number(n);
  const s = Number.isFinite(q) ? String(q) : '0';
  return unit ? `${s} ${escapeHtml(unit)}` : s;
}

function stockCard(row) {
  const m = row.material;
  return `
    <div class="card inventory-card" data-material-id="${m.id}">
      <div class="accounts-card-head">
        <div>
          <div class="card-title" style="margin-bottom:4px">${escapeHtml(m.name)}</div>
          <p class="form-hint" style="margin:0">${escapeHtml(row.categoryName)}${row.supplierName ? ` · ${escapeHtml(row.supplierName)}` : ''}</p>
          <p class="form-hint" style="margin:4px 0 0">
            במלאי: <strong>${formatQty(row.qtyOnHand, row.unit)}</strong>
            ${row.minQty != null ? ` · מינימום: ${formatQty(row.minQty, row.unit)}` : ''}
          </p>
          ${row.lastAdjustedAt ? `<p class="form-hint" style="margin:4px 0 0">עודכן: ${escapeHtml(formatDateTime(row.lastAdjustedAt))}${row.lastAdjustmentReason ? ` · ${escapeHtml(row.lastAdjustmentReason)}` : ''}</p>` : ''}
        </div>
        ${stockBadge(row)}
      </div>
      <div class="accounts-actions">
        <button type="button" class="btn btn-primary inventory-adjust" data-material-id="${m.id}">התאם מלאי</button>
        <button type="button" class="btn btn-secondary inventory-to-shortage" data-material-id="${m.id}">הוסף לחוסרים</button>
      </div>
    </div>`;
}

function openAdjustModal(row, onDone) {
  const m = row.material;
  openModal({
    title: `התאמת מלאי — ${m.name}`,
    bodyHTML: `
      <p class="form-hint">נוכחי: <strong>${formatQty(row.qtyOnHand, row.unit)}</strong></p>
      <div class="form-group">
        <label for="inv-delta">שינוי (+/−)</label>
        <input type="number" id="inv-delta" step="any" placeholder="לדוגמה 5 או -2" dir="ltr">
      </div>
      <div class="form-group">
        <label for="inv-set">או הגדר כמות סופית</label>
        <input type="number" id="inv-set" step="any" min="0" placeholder="אופציונלי" dir="ltr" value="">
      </div>
      <div class="form-group">
        <label for="inv-min">כמות מינימום (התראה)</label>
        <input type="number" id="inv-min" step="any" min="0" dir="ltr" value="${row.minQty != null ? escapeHtml(String(row.minQty)) : ''}">
      </div>
      <div class="form-group">
        <label for="inv-reason">סיבה</label>
        <input type="text" id="inv-reason" maxlength="200" placeholder="ספירה / קבלה / תיקון">
      </div>
      <p class="form-hint inv-adjust-error" style="display:none;color:var(--danger)"></p>
    `,
    footerHTML: `
      <button type="button" class="btn btn-secondary" id="inv-cancel">ביטול</button>
      <button type="button" class="btn btn-primary" id="inv-save">שמור</button>
    `,
  });

  document.getElementById('inv-cancel')?.addEventListener('click', () => closeModal());
  document.getElementById('inv-save')?.addEventListener('click', async () => {
    const errEl = document.querySelector('.inv-adjust-error');
    const deltaVal = document.getElementById('inv-delta')?.value;
    const setVal = document.getElementById('inv-set')?.value;
    const minVal = document.getElementById('inv-min')?.value;
    const reason = document.getElementById('inv-reason')?.value || '';
    try {
      const hasSet = setVal !== '' && setVal != null;
      const hasDelta = deltaVal !== '' && deltaVal != null;
      if (!hasSet && !hasDelta) {
        throw new Error('הזן שינוי או כמות סופית');
      }
      await adjustInventoryStock({
        rawMaterialId: m.id,
        delta: hasSet ? undefined : deltaVal,
        setQty: hasSet ? setVal : null,
        minQty: minVal,
        reason,
        unit: row.unit || m.unit || '',
      });
      closeModal();
      showToast('המלאי עודכן');
      requestAutoBackupNow?.();
      onDone();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'שגיאה';
        errEl.style.display = 'block';
      } else {
        showToast(err.message || 'שגיאה');
      }
    }
  });
}

export async function renderInventory(container) {
  const search = container.dataset.invSearch || '';
  const categoryId = container.dataset.invCategory || '';
  const lowOnly = container.dataset.invLowOnly === '1';

  container.innerHTML = `<div class="card"><p class="form-hint">טוען מלאי...</p></div>`;

  let cats = [];
  let rows = [];
  try {
    [cats, rows] = await Promise.all([
      getSupplierCategories(),
      getInventoryStockRows({ search, categoryId: categoryId || null, lowOnly }),
    ]);
  } catch (err) {
    container.innerHTML = `
      <div class="card" style="border:2px solid var(--danger)">
        <div class="card-title">שגיאה בטעינת מלאי</div>
        <p>${escapeHtml(err.message || err)}</p>
      </div>`;
    return;
  }

  const lowCount = inventoryLowCount(rows);
  const catOptions = [
    `<option value="">כל הקטגוריות</option>`,
    ...cats.map((c) => `<option value="${c.id}" ${String(c.id) === String(categoryId) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`),
  ].join('');

  container.innerHTML = `
    <div class="card">
      <div class="card-title">מלאי חומרי גלם</div>
      <p class="form-hint">יתרות מקושרות לחומרים מעמדת ספקים. התאם מלאי אחרי ספירה או קבלה. חומר מתחת למינימום — אפשר להוסיף לחוסרים.</p>
      <p class="form-hint" style="margin:0">מוצגים: <strong>${rows.length}</strong>${lowCount ? ` · מתחת למינימום: <strong style="color:var(--danger)">${lowCount}</strong>` : ''}</p>
      <form id="inv-filter-form" class="lots-search-form" style="margin-top:12px">
        <div class="form-group">
          <label for="inv-search">חיפוש</label>
          <input type="search" id="inv-search" value="${escapeHtml(search)}" placeholder="שם חומר">
        </div>
        <div class="form-group">
          <label for="inv-category">קטגוריית ספק</label>
          <select id="inv-category">${catOptions}</select>
        </div>
        <label class="form-hint" style="display:flex;gap:8px;align-items:center;margin:8px 0">
          <input type="checkbox" id="inv-low-only" ${lowOnly ? 'checked' : ''}>
          הצג רק מתחת למינימום
        </label>
        <button type="submit" class="btn btn-primary">סנן</button>
      </form>
    </div>
    ${rows.length ? rows.map(stockCard).join('') : '<div class="card"><p class="form-hint">אין חומרי גלם להצגה. הוסף במחסן שבעמדת ספקים.</p></div>'}
  `;

  container.querySelector('#inv-filter-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    container.dataset.invSearch = container.querySelector('#inv-search')?.value || '';
    container.dataset.invCategory = container.querySelector('#inv-category')?.value || '';
    container.dataset.invLowOnly = container.querySelector('#inv-low-only')?.checked ? '1' : '0';
    renderInventory(container);
  });

  container.querySelectorAll('.inventory-adjust').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.materialId);
      const row = rows.find((r) => r.material.id === id);
      if (!row) return;
      openAdjustModal(row, () => renderInventory(container));
    });
  });

  container.querySelectorAll('.inventory-to-shortage').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await addInventoryItemToShortages(Number(btn.dataset.materialId));
        showToast('נוסף לחוסרים');
        requestAutoBackupNow?.();
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });
}
