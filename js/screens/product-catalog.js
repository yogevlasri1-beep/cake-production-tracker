import { escapeHtml, showToast } from '../utils.js?v=458';
import { openModal, closeModal } from '../modal.js?v=458';
import {
  getProductsCatalogLayout,
  setProductCatalogVisibility,
  setProductCatalogImage,
  isProductInCatalog,
} from '../db.js?v=458';
import { getProductDetail } from '../kitchen-db.js?v=458';
import { getCurrentUserRole } from '../auth.js?v=458';
import { canManageProductCatalog } from '../permissions.js?v=458';
import {
  compressImageForCatalog,
  filterCatalogLayout,
  catalogProductMetaLines,
  catalogImageHtml,
  formatCatalogAllergens,
} from '../product-catalog.js?v=458';
import {
  exportProductCatalogHtml,
  exportProductCatalogExcel,
} from '../product-catalog-export.js?v=458';
import { describeDownloadMethod } from '../download.js?v=458';

const FILTER_KEY = 'yitzurProductCatalogFilter';
const SEARCH_KEY = 'yitzurProductCatalogSearch';

export function productCatalogMeta() {
  return {
    title: 'קטלוג מוצרים',
    subtitle: 'תצוגה לפי קטגוריות · מחיר, אלרגנים, אחסון ותמונה',
  };
}

function getFilter() {
  return sessionStorage.getItem(FILTER_KEY) || 'catalog';
}

function getSearch() {
  return sessionStorage.getItem(SEARCH_KEY) || '';
}

function toolbarHtml({ filter, search, canManage, productCount }) {
  return `
    <div class="card pcat-toolbar">
      <div class="card-title">קטלוג מוצרים</div>
      <p class="form-hint" style="margin:0 0 10px">
        מוצג לפי קטגוריות. ${canManage ? 'במצב ניהול אפשר לבחור מה יופיע בקטלוג ולהעלות תמונה.' : 'תצוגה לקריאה.'}
        · <strong>${productCount}</strong> מוצרים
      </p>
      <div class="pcat-toolbar-row">
        <input type="search" id="pcat-search" class="pcat-search" placeholder="חיפוש מוצר..." value="${escapeHtml(search)}" aria-label="חיפוש מוצר">
        <select id="pcat-filter" aria-label="סינון תצוגה">
          <option value="catalog" ${filter === 'catalog' ? 'selected' : ''}>בקטלוג</option>
          ${canManage ? `<option value="hidden" ${filter === 'hidden' ? 'selected' : ''}>מוסתרים מהקטלוג</option>` : ''}
          ${canManage ? `<option value="all" ${filter === 'all' ? 'selected' : ''}>הכל (ניהול)</option>` : ''}
        </select>
      </div>
      <div class="accounts-actions" style="margin-top:10px">
        <button type="button" class="btn btn-secondary btn-sm" id="pcat-export-html">ייצוא HTML</button>
        <button type="button" class="btn btn-secondary btn-sm" id="pcat-export-xlsx">ייצוא Excel</button>
        <button type="button" class="btn btn-secondary btn-sm" id="pcat-refresh">רענון</button>
      </div>
    </div>`;
}

function productCardHtml(product, { categoryName, groupName, canManage }) {
  const inCat = isProductInCatalog(product);
  const meta = catalogProductMetaLines(product).slice(0, 4);
  return `
    <article class="pcat-card ${inCat ? '' : 'pcat-card--hidden'}" data-product-id="${product.id}">
      <button type="button" class="pcat-card-main" data-pcat-open="${product.id}" aria-label="פרטי ${escapeHtml(product.name)}">
        ${catalogImageHtml(product)}
        <div class="pcat-card-body">
          <h3 class="pcat-card-title">${escapeHtml(product.name)}</h3>
          <p class="pcat-card-cat">${escapeHtml([groupName, categoryName].filter(Boolean).join(' · '))}</p>
          <ul class="pcat-card-meta">
            ${meta.map((m) => `<li><span>${escapeHtml(m.label)}</span> ${escapeHtml(m.value)}</li>`).join('')}
          </ul>
          ${!inCat ? '<span class="accounts-status accounts-status--warn">מוסתר מהקטלוג</span>' : ''}
        </div>
      </button>
      ${canManage ? `
        <div class="pcat-card-manage">
          <label class="pcat-toggle">
            <input type="checkbox" class="pcat-in-catalog" data-id="${product.id}" ${inCat ? 'checked' : ''}>
            <span>הצג בקטלוג</span>
          </label>
          <label class="btn btn-secondary btn-sm pcat-image-btn">
            תמונה
            <input type="file" accept="image/*" class="pcat-image-input" data-id="${product.id}" hidden>
          </label>
        </div>` : ''}
    </article>`;
}

function sectionHtml(title, categories, { groupName = '', canManage } = {}) {
  if (!categories?.length) return '';
  return `
    <section class="pcat-section">
      <h2 class="pcat-section-title">${escapeHtml(title)}</h2>
      ${categories.map((cat) => `
        <div class="pcat-category" data-category-id="${cat.id}">
          <h3 class="pcat-category-title">${escapeHtml(cat.name)}</h3>
          <div class="pcat-grid">
            ${cat.products.map((p) => productCardHtml(p, {
    categoryName: cat.name,
    groupName,
    canManage,
  })).join('')}
          </div>
        </div>`).join('')}
    </section>`;
}

function buildBodyHtml(filtered, { canManage }) {
  if (!filtered.productCount) {
    return `<div class="card"><p class="form-hint" style="margin:0">אין מוצרים להצגה לפי הסינון הנוכחי.</p></div>`;
  }
  const parts = [];
  if (filtered.ungrouped.length) {
    parts.push(sectionHtml('ללא קבוצה', filtered.ungrouped, { canManage }));
  }
  for (const g of filtered.groups) {
    parts.push(sectionHtml(g.name, g.categories, { groupName: g.name, canManage }));
  }
  return parts.join('');
}

async function buildAllergenMap(layout) {
  const map = new Map();
  const products = [
    ...(layout.ungrouped || []).flatMap((c) => c.products || []),
    ...(layout.groups || []).flatMap((g) => (g.categories || []).flatMap((c) => c.products || [])),
  ];
  await Promise.all(products.map(async (p) => {
    try {
      const detail = await getProductDetail(p.id);
      map.set(p.id, detail.allergenIds || []);
    } catch {
      map.set(p.id, Array.isArray(p.allergens) ? p.allergens : []);
    }
  }));
  return map;
}

async function openProductCatalogModal(productId, { canManage, onChanged }) {
  let detail;
  try {
    detail = await getProductDetail(productId);
  } catch (err) {
    showToast(err.message || 'לא ניתן לטעון מוצר');
    return;
  }
  const product = detail.product;
  const allergens = formatCatalogAllergens(detail.allergenIds);
  const meta = catalogProductMetaLines(product, { allergenIds: detail.allergenIds });
  const path = detail.category?.name || '';

  openModal({
    title: product.name,
    modalClass: 'modal-product-catalog',
    bodyHTML: `
      <div class="pcat-detail">
        <div class="pcat-detail-media">
          ${catalogImageHtml(product, { className: 'pcat-detail-img' })}
        </div>
        ${path ? `<p class="form-hint" style="margin:0 0 8px">${escapeHtml(path)}</p>` : ''}
        <ul class="pcat-detail-list">
          ${meta.map((m) => `<li><strong>${escapeHtml(m.label)}</strong><span>${escapeHtml(m.value)}</span></li>`).join('')}
        </ul>
        ${canManage ? `
          <div class="pcat-detail-manage">
            <label class="pcat-toggle">
              <input type="checkbox" id="pcat-detail-in-catalog" ${isProductInCatalog(product) ? 'checked' : ''}>
              <span>הצג בקטלוג</span>
            </label>
            <label class="btn btn-secondary btn-sm">
              החלף תמונה
              <input type="file" accept="image/*" id="pcat-detail-image" hidden>
            </label>
            ${product.imageDataUrl ? '<button type="button" class="btn btn-secondary btn-sm" id="pcat-detail-remove-image">הסר תמונה</button>' : ''}
          </div>` : ''}
        <p class="form-hint" style="margin:12px 0 0">אלרגנים: ${escapeHtml(allergens)}</p>
      </div>`,
    footerHTML: `<button type="button" class="btn btn-secondary modal-cancel">סגור</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  if (!canManage) return;

  document.getElementById('pcat-detail-in-catalog')?.addEventListener('change', async (e) => {
    try {
      await setProductCatalogVisibility(productId, e.target.checked);
      showToast(e.target.checked ? 'מוצג בקטלוג' : 'הוסתר מהקטלוג');
      onChanged?.();
    } catch (err) {
      showToast(err.message || 'שגיאה');
      e.target.checked = !e.target.checked;
    }
  });

  document.getElementById('pcat-detail-image')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await compressImageForCatalog(file);
      await setProductCatalogImage(productId, dataUrl);
      showToast('התמונה נשמרה');
      closeModal();
      onChanged?.();
    } catch (err) {
      showToast(err.message || 'שגיאה בשמירת תמונה');
    }
  });

  document.getElementById('pcat-detail-remove-image')?.addEventListener('click', async () => {
    try {
      await setProductCatalogImage(productId, null);
      showToast('התמונה הוסרה');
      closeModal();
      onChanged?.();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

function wireHandlers(container, { layout, filtered, canManage }) {
  const rerender = () => renderProductCatalog(container);

  container.querySelector('#pcat-refresh')?.addEventListener('click', rerender);

  container.querySelector('#pcat-search')?.addEventListener('input', (e) => {
    sessionStorage.setItem(SEARCH_KEY, e.target.value || '');
  });
  container.querySelector('#pcat-search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sessionStorage.setItem(SEARCH_KEY, e.target.value || '');
      rerender();
    }
  });
  container.querySelector('#pcat-search')?.addEventListener('change', (e) => {
    sessionStorage.setItem(SEARCH_KEY, e.target.value || '');
    rerender();
  });

  container.querySelector('#pcat-filter')?.addEventListener('change', (e) => {
    sessionStorage.setItem(FILTER_KEY, e.target.value || 'catalog');
    rerender();
  });

  container.querySelectorAll('[data-pcat-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openProductCatalogModal(Number(btn.dataset.pcatOpen), { canManage, onChanged: rerender });
    });
  });

  container.querySelectorAll('.pcat-in-catalog').forEach((cb) => {
    cb.addEventListener('change', async () => {
      try {
        await setProductCatalogVisibility(Number(cb.dataset.id), cb.checked);
        showToast(cb.checked ? 'מוצג בקטלוג' : 'הוסתר מהקטלוג');
        if (getFilter() !== 'all') rerender();
        else cb.closest('.pcat-card')?.classList.toggle('pcat-card--hidden', !cb.checked);
      } catch (err) {
        showToast(err.message || 'שגיאה');
        cb.checked = !cb.checked;
      }
    });
  });

  container.querySelectorAll('.pcat-image-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      const id = Number(input.dataset.id);
      input.value = '';
      if (!file || !id) return;
      try {
        const dataUrl = await compressImageForCatalog(file);
        await setProductCatalogImage(id, dataUrl);
        showToast('התמונה נשמרה');
        rerender();
      } catch (err) {
        showToast(err.message || 'שגיאה בשמירת תמונה');
      }
    });
  });

  const runExport = async (kind) => {
    try {
      showToast('מכין ייצוא...');
      const allergenMap = await buildAllergenMap(filtered);
      const method = kind === 'xlsx'
        ? await exportProductCatalogExcel(filtered, { allergenMap })
        : await exportProductCatalogHtml(filtered, {
          allergenMap,
          title: 'קטלוג מוצרים',
          subtitle: `${filtered.productCount} מוצרים · לפי קטגוריות`,
        });
      const tip = describeDownloadMethod(method);
      if (method === 'cancelled') showToast('בוטל');
      else showToast(tip || 'הייצוא מוכן');
    } catch (err) {
      showToast(err.message || 'ייצוא נכשל');
    }
  };

  container.querySelector('#pcat-export-html')?.addEventListener('click', () => runExport('html'));
  container.querySelector('#pcat-export-xlsx')?.addEventListener('click', () => runExport('xlsx'));

  // silence unused
  void layout;
}

export async function renderProductCatalog(container) {
  const role = getCurrentUserRole();
  const canManage = canManageProductCatalog(role);
  const filter = getFilter();
  const search = getSearch();

  container.innerHTML = `<div class="card"><p class="form-hint">טוען קטלוג...</p></div>`;

  let layout;
  try {
    layout = await getProductsCatalogLayout();
  } catch (err) {
    container.innerHTML = `
      <div class="card" style="border:2px solid var(--danger)">
        <div class="card-title">לא ניתן לטעון קטלוג</div>
        <p>${escapeHtml(err.message || err)}</p>
      </div>`;
    return;
  }

  const filtered = filterCatalogLayout(layout, {
    search,
    visibility: canManage ? filter : 'catalog',
    activeOnly: true,
  });

  container.innerHTML = `
    ${toolbarHtml({ filter, search, canManage, productCount: filtered.productCount })}
    ${buildBodyHtml(filtered, { canManage })}
  `;

  wireHandlers(container, { layout, filtered, canManage });
}
