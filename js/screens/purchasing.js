import {
  getPurchaseCategoryByKey, getPurchaseItems,
  addPurchaseItem, updatePurchaseItem, deletePurchaseItem,
  PURCHASE_CATEGORY_KEYS, PURCHASE_STATUS, PURCHASE_STATUS_LABELS, isPurchaseDone,
} from '../purchasing-db.js?v=335';
import { escapeHtml, showToast, formatMoney, formatDecimal } from '../utils.js?v=335';
import { openModal, closeModal } from '../modal.js?v=335';
import { requestAutoBackupNow } from '../backup-service.js?v=335';

const PURCHASING_TAB_KEY = 'yitzurPurchasingTab';

export const PURCHASING_TABS = {
  accessories: {
    id: 'accessories',
    catKey: PURCHASE_CATEGORY_KEYS.accessories,
    label: 'אביזרים',
    icon: '🔧',
    subtitle: 'ניהול רכש אביזרים למפעל',
  },
  machines: {
    id: 'machines',
    catKey: PURCHASE_CATEGORY_KEYS.machines,
    label: 'מכונות',
    icon: '⚙️',
    subtitle: 'ניהול רכש מכונות וציוד',
  },
};

function getPurchasingTab(container) {
  const tab = container?.dataset?.purchasingTab || sessionStorage.getItem(PURCHASING_TAB_KEY) || 'accessories';
  return PURCHASING_TABS[tab] ? tab : 'accessories';
}

function purchasingCategoryChipsHTML(activeTab) {
  return `
    <div class="workspace-chip-row purchasing-cat-chips" style="margin-bottom:12px">
      ${Object.values(PURCHASING_TABS).map((t) => `
        <button type="button" class="workspace-chip${activeTab === t.id ? ' active' : ''}" data-purchasing-cat="${t.id}">
          ${t.icon} ${escapeHtml(t.label)}
        </button>`).join('')}
    </div>`;
}

function statusBadge(status) {
  const label = PURCHASE_STATUS_LABELS[status] || PURCHASE_STATUS_LABELS.needed;
  const cls = status === PURCHASE_STATUS.received
    ? 'purchase-status--received'
    : status === PURCHASE_STATUS.ordered
      ? 'purchase-status--ordered'
      : 'purchase-status--needed';
  return `<span class="purchase-status ${cls}">${label}</span>`;
}

function renderPurchaseItemRow(item) {
  const done = isPurchaseDone(item);
  const qtyLine = item.quantity != null
    ? `${formatDecimal(item.quantity)}${item.unit ? ` ${escapeHtml(item.unit)}` : ''}`
    : '';
  const priceLine = item.unitPrice != null ? formatMoney(item.unitPrice) : '';
  return `
    <div class="purchase-item${done ? ' purchase-item--done' : ''}" data-id="${item.id}">
      <label class="purchase-done-toggle" title="${done ? 'בטל סימון בוצע' : 'סמן כבוצע'}">
        <input type="checkbox" class="purchase-done-cb" data-id="${item.id}" ${done ? 'checked' : ''}>
        <span class="purchase-done-label">בוצע</span>
      </label>
      <div class="purchase-item-main">
        <div class="purchase-item-title-row">
          <strong class="purchase-item-name">${escapeHtml(item.name)}</strong>
          ${statusBadge(item.status)}
        </div>
        <div class="purchase-item-meta">
          ${item.supplier ? `<span>🏭 ${escapeHtml(item.supplier)}</span>` : ''}
          ${qtyLine ? `<span>📦 ${qtyLine}</span>` : ''}
          ${priceLine ? `<span>💰 ${priceLine}</span>` : ''}
        </div>
        ${item.notes ? `<p class="purchase-item-notes form-hint">${escapeHtml(item.notes)}</p>` : ''}
      </div>
      <div class="purchase-item-actions">
        <button type="button" class="btn btn-secondary btn-sm purchase-edit" data-id="${item.id}" title="עריכה">✏️</button>
        <button type="button" class="btn btn-danger btn-sm purchase-del" data-id="${item.id}" title="מחק">🗑</button>
      </div>
    </div>`;
}

function renderPurchaseListHTML(items) {
  const pending = items.filter((i) => !isPurchaseDone(i));
  const done = items.filter((i) => isPurchaseDone(i));
  const sections = [];

  if (pending.length) {
    sections.push(`
      <div class="purchase-list-section">
        ${pending.length && done.length ? '<div class="purchase-list-section-label">פתוחות</div>' : ''}
        ${pending.map((item) => renderPurchaseItemRow(item)).join('')}
      </div>`);
  }
  if (done.length) {
    if (pending.length) {
      sections.push('<div class="purchase-list-divider" role="separator" aria-hidden="true"></div>');
    }
    sections.push(`
      <div class="purchase-list-section purchase-list-section--done">
        <div class="purchase-list-section-label">בוצעו (${done.length})</div>
        ${done.map((item) => renderPurchaseItemRow(item)).join('')}
      </div>`);
  }
  return sections.join('');
}

function openPurchaseItemModal({ categoryId, item = null, onSave }) {
  const isEdit = !!item;
  openModal({
    title: isEdit ? 'עריכת פריט' : 'פריט חדש',
    bodyHTML: `
      <div class="form-group">
        <label for="purchase-name">שם פריט</label>
        <input type="text" id="purchase-name" value="${escapeHtml(item?.name || '')}" maxlength="120">
      </div>
      <div class="form-group">
        <label for="purchase-supplier">ספק / יצרן</label>
        <input type="text" id="purchase-supplier" value="${escapeHtml(item?.supplier || '')}" maxlength="80">
      </div>
      <div class="filter-row">
        <div class="form-group" style="flex:1">
          <label for="purchase-qty">כמות</label>
          <input type="number" id="purchase-qty" min="0" step="any" inputmode="decimal" value="${item?.quantity ?? ''}">
        </div>
        <div class="form-group" style="flex:1">
          <label for="purchase-unit">יחידה</label>
          <input type="text" id="purchase-unit" placeholder="יח', ק״ג..." value="${escapeHtml(item?.unit || '')}" maxlength="20">
        </div>
      </div>
      <div class="form-group">
        <label for="purchase-price">מחיר משוער (₪)</label>
        <input type="number" id="purchase-price" min="0" step="0.01" inputmode="decimal" value="${item?.unitPrice ?? ''}">
      </div>
      <div class="form-group">
        <label for="purchase-status">סטטוס</label>
        <select id="purchase-status">
          ${Object.entries(PURCHASE_STATUS_LABELS).map(([k, label]) =>
    `<option value="${k}" ${item?.status === k ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label for="purchase-notes">הערות</label>
        <textarea id="purchase-notes" rows="2" maxlength="500">${escapeHtml(item?.notes || '')}</textarea>
      </div>`,
    footerHTML: `
      <button type="button" class="btn btn-secondary" id="purchase-modal-cancel">ביטול</button>
      <button type="button" class="btn btn-primary" id="purchase-modal-save">${isEdit ? 'שמור' : 'הוסף'}</button>`,
  });

  document.getElementById('purchase-modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('purchase-modal-save')?.addEventListener('click', async () => {
    const payload = {
      categoryId,
      name: document.getElementById('purchase-name').value,
      supplier: document.getElementById('purchase-supplier').value,
      quantity: document.getElementById('purchase-qty').value,
      unit: document.getElementById('purchase-unit').value,
      unitPrice: document.getElementById('purchase-price').value,
      status: document.getElementById('purchase-status').value,
      notes: document.getElementById('purchase-notes').value,
    };
    try {
      await onSave(payload, item?.id);
      closeModal();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

async function renderCategoryTab(body, rootContainer, tabMeta, refresh) {
  const category = await getPurchaseCategoryByKey(tabMeta.catKey);
  if (!category) {
    body.innerHTML = '<p class="form-hint">קטגוריה לא נמצאה</p>';
    return;
  }
  const items = await getPurchaseItems(category.id);
  const needed = items.filter((i) => i.status === PURCHASE_STATUS.needed).length;
  const ordered = items.filter((i) => i.status === PURCHASE_STATUS.ordered).length;
  const doneCount = items.filter((i) => isPurchaseDone(i)).length;

  body.innerHTML = `
    <div class="card">
      <div class="card-title">${tabMeta.icon} ${escapeHtml(tabMeta.label)}</div>
      <p class="form-hint" style="margin-bottom:10px">
        ${items.length} פריטים · ${needed} לרכישה · ${ordered} בהזמנה${doneCount ? ` · ${doneCount} בוצעו` : ''}
      </p>
      <button type="button" class="btn btn-primary btn-sm" id="purchase-add-btn" style="width:100%">+ הוסף פריט</button>
    </div>
    <div class="card purchase-list-card">
      ${items.length
    ? renderPurchaseListHTML(items)
    : '<p class="form-hint" style="text-align:center;padding:16px">אין פריטים — לחץ «הוסף פריט»</p>'}
    </div>`;

  document.getElementById('purchase-add-btn')?.addEventListener('click', () => {
    openPurchaseItemModal({
      categoryId: category.id,
      onSave: async (payload) => {
        await addPurchaseItem(payload);
        requestAutoBackupNow().catch(() => {});
        showToast('נוסף ✓');
        await refresh();
      },
    });
  });

  body.querySelectorAll('.purchase-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = items.find((i) => i.id === Number(btn.dataset.id));
      if (!item) return;
      openPurchaseItemModal({
        categoryId: category.id,
        item,
        onSave: async (payload, id) => {
          await updatePurchaseItem(id, payload);
          requestAutoBackupNow().catch(() => {});
          showToast('נשמר ✓');
          await refresh();
        },
      });
    });
  });

  body.querySelectorAll('.purchase-done-cb').forEach((cb) => {
    cb.addEventListener('change', async () => {
      try {
        await updatePurchaseItem(cb.dataset.id, { done: cb.checked });
        requestAutoBackupNow().catch(() => {});
        showToast(cb.checked ? 'סומן כבוצע ✓' : 'הוחזר לרשימה');
        await refresh();
      } catch (err) {
        showToast(err.message || 'שגיאה');
        cb.checked = !cb.checked;
      }
    });
  });

  body.querySelectorAll('.purchase-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק את הפריט?')) return;
      await deletePurchaseItem(btn.dataset.id);
      requestAutoBackupNow().catch(() => {});
      showToast('נמחק');
      await refresh();
    });
  });
}

export async function renderPurchasingInManager(embedContainer, { rootContainer, refresh } = {}) {
  const root = rootContainer || embedContainer.closest('#main-content') || embedContainer.parentElement;
  const tab = getPurchasingTab(root);
  root.dataset.purchasingTab = tab;
  sessionStorage.setItem(PURCHASING_TAB_KEY, tab);
  const tabMeta = PURCHASING_TABS[tab];

  const doRefresh = refresh || (() => renderPurchasingInManager(embedContainer, { rootContainer: root, refresh }));

  embedContainer.innerHTML = `
    ${purchasingCategoryChipsHTML(tab)}
    <div id="purchasing-tab-body"><p style="text-align:center;padding:24px;color:var(--text-muted)">טוען...</p></div>`;

  embedContainer.querySelectorAll('[data-purchasing-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextTab = btn.dataset.purchasingCat;
      if (!PURCHASING_TABS[nextTab] || nextTab === tab) return;
      root.dataset.purchasingTab = nextTab;
      sessionStorage.setItem(PURCHASING_TAB_KEY, nextTab);
      doRefresh();
    });
  });

  const body = embedContainer.querySelector('#purchasing-tab-body');
  await renderCategoryTab(body, root, tabMeta, doRefresh);
}

export function purchasingMeta() {
  const tab = sessionStorage.getItem(PURCHASING_TAB_KEY) || 'accessories';
  const meta = PURCHASING_TABS[tab];
  return { title: 'רכישות לשיפור העסק', subtitle: meta?.subtitle || '' };
}
