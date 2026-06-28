import {
  getSupplierCategories, getSuppliers, addSupplierCategory, updateSupplierCategory, deleteSupplierCategory,
  addSupplier, updateSupplier, deleteSupplier,
  getRawMaterials, addRawMaterial, updateRawMaterial, deleteRawMaterial,
  getWeeklyPlan, setWeeklyPlanItem, computeWeeklyMaterialNeeds, formatWhatsAppOrderText,
  getRecipeForProduct, setSupplierOrder, setRawMaterialOrder,
  getSuppliersBrowseLayout, getPriceHistory, setRawMaterialPrice, getMaterialsWithSameName,
  importSupplierExcelEntries,
  getSupplierImportUndo, undoSupplierImport,
  getMasterMaterialsList, getCombinedPriceHistory, assignMaterialToSupplier,
  getDuplicateMaterialGroups, mergeDuplicateMaterials, mergeDuplicateMaterialsKeeping, computePricePerKg,
} from '../kitchen-db.js';
import { getProducts } from '../db.js';
import { parseSupplierFile } from '../supplier-import.js';
import { escapeHtml, showToast, formatMoney, weekStartISO, formatDate, todayISO } from '../utils.js';
import { openModal, closeModal } from '../modal.js';
import { requestAutoBackupNow } from '../backup-service.js';
import { bindSupplierDragList, bindMaterialDragList } from '../product-drag.js';

const SUPPLIER_TAB_KEY = 'yitzurSupplierTab';

export const SUPPLIER_TABS = {
  catalog: { id: 'catalog', label: 'מחסן', subtitle: 'רשימת חומרי גלם כללית, שיוך לספקים' },
  browse: { id: 'browse', label: 'ספקים', subtitle: 'רשימת ספקים, תמחור והיסטוריית מחירים' },
  edit: { id: 'edit', label: 'עריכה', subtitle: 'עריכת ספקים, חומרי גלם, מחירים וייבוא Excel' },
  order: { id: 'order', label: 'הזמנה', subtitle: 'תוכנית שבועית ובניית הזמנה' },
};

function getSupplierTab(container) {
  const tab = container?.dataset?.supplierTab || sessionStorage.getItem(SUPPLIER_TAB_KEY) || 'browse';
  return SUPPLIER_TABS[tab] ? tab : 'browse';
}

export function syncSuppliersSubNav(activeTab) {
  document.querySelectorAll('.suppliers-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.supplierTab === activeTab);
  });
}

export function updateSuppliersHeader() {
  const tab = sessionStorage.getItem(SUPPLIER_TAB_KEY) || 'browse';
  const meta = SUPPLIER_TABS[tab];
  const el = document.getElementById('page-subtitle');
  if (el && meta) el.textContent = meta.subtitle;
}

export function switchSupplierTab(tab) {
  if (!SUPPLIER_TABS[tab]) return;
  const main = document.getElementById('main-content');
  main.dataset.supplierTab = tab;
  sessionStorage.setItem(SUPPLIER_TAB_KEY, tab);
  syncSuppliersSubNav(tab);
  updateSuppliersHeader();
  renderSuppliers(main);
}

export function initSuppliersSubNav() {
  document.querySelectorAll('.suppliers-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchSupplierTab(btn.dataset.supplierTab));
  });
}

export function suppliersMeta() {
  const tab = sessionStorage.getItem(SUPPLIER_TAB_KEY) || 'browse';
  const meta = SUPPLIER_TABS[tab];
  return { title: 'ספקים', subtitle: meta?.subtitle || '' };
}

export async function renderSuppliers(container) {
  const tab = getSupplierTab(container);
  container.dataset.supplierTab = tab;
  syncSuppliersSubNav(tab);
  updateSuppliersHeader();

  const weekStart = container.dataset.planWeek || weekStartISO();
  const selectedMatCat = container.dataset.matCat || '';
  const selectedSupCat = container.dataset.supCat || '';

  const [supCats, products] = await Promise.all([
    getSupplierCategories(),
    getProducts(true),
  ]);

  if (!selectedMatCat && supCats.length) container.dataset.matCat = String(supCats[0].id);
  if (!selectedSupCat && supCats.length) container.dataset.supCat = String(supCats[0].id);

  container.innerHTML = `<div id="supplier-tab-body"><p style="text-align:center;padding:24px;color:var(--text-muted)">טוען...</p></div>`;
  const body = document.getElementById('supplier-tab-body');

  if (tab === 'catalog') await renderCatalogTab(body, container, supCats, selectedMatCat || container.dataset.matCat);
  else if (tab === 'browse') await renderBrowseTab(body, container);
  else if (tab === 'edit') await renderEditTab(body, container, supCats, selectedMatCat || container.dataset.matCat, selectedSupCat || container.dataset.supCat);
  else await renderOrderTab(body, container, products, weekStart);
}

/* ── מחסן: קטלוג חומרי גלם ── */

async function renderCatalogTab(body, container, categories, selectedCatId) {
  const catId = selectedCatId ? Number(selectedCatId) : null;
  const search = (container.dataset.catalogSearch || '').trim().toLowerCase();
  const [catalog, suppliers, importUndo] = await Promise.all([
    getMasterMaterialsList(catId || undefined),
    getSuppliers(),
    getSupplierImportUndo(),
  ]);
  const supMap = new Map(suppliers.map((s) => [s.id, s.name]));

  let items = catalog;
  if (search) {
    items = items.filter((item) => item.name.toLocaleLowerCase('he').includes(search));
  }

  body.innerHTML = `
    ${importUndo ? renderImportUndoBanner(importUndo) : ''}
    <div class="card catalog-intro">
      <div class="filter-row" style="margin-bottom:8px">
        <div class="card-title" style="margin:0;flex:1">מחסן חומרי גלם</div>
        <button type="button" class="btn btn-secondary btn-sm" id="catalog-import-btn">📊 Excel</button>
        <button type="button" class="btn btn-secondary btn-sm" id="catalog-merge-dup">אחד כפילויות</button>
      </div>
      <p class="form-hint" style="margin:0">כל חומר מוצג פעם אחת · גיליון לכל ספק (עם או בלי כותרות — שם + מחיר לק"ג)</p>
    </div>
    <div class="card">
      <div class="workspace-chip-row catalog-cat-chips" style="margin-bottom:10px">
        <button type="button" class="workspace-chip${!catId ? ' active' : ''}" data-catalog-cat="">הכל</button>
        ${categories.map((c) => `
          <button type="button" class="workspace-chip${String(c.id) === String(catId) ? ' active' : ''}"
            data-catalog-cat="${c.id}">${escapeHtml(c.name)}</button>`).join('')}
      </div>
      <div class="form-group" style="margin-bottom:12px">
        <input type="search" id="catalog-search" class="catalog-search-input"
          placeholder="חיפוש לפי שם..." value="${escapeHtml(container.dataset.catalogSearch || '')}">
      </div>
      ${items.length === 0
    ? '<p class="form-hint">אין חומרי גלם — ייבא מ-Excel או הוסף בעריכה</p>'
    : `<div class="catalog-material-list">
        ${items.map((item) => {
    const best = pickBestOffer(item.offers);
    const ppk = computePricePerKg(best.unitPrice, best.packageWeightGrams);
    return `
          <button type="button" class="catalog-material-row" data-primary-id="${item.primaryId}">
            <span class="catalog-mat-name">${escapeHtml(item.name)}</span>
            <span class="catalog-mat-meta">
              ${item.supplierCount ? `${item.supplierCount} ספקים` : 'ללא ספק'}
              ${best.unitPrice > 0 ? ` · ${formatMoney(best.unitPrice)}` : ''}
              ${ppk != null ? ` · ${formatMoney(ppk)}/ק"ג` : ''}
            </span>
          </button>`;
  }).join('')}
      </div>`}
    </div>
    <input type="file" id="catalog-excel-file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden>`;

  bindImportUndoButton(body, container);
  document.getElementById('catalog-import-btn')?.addEventListener('click', () => {
    document.getElementById('catalog-excel-file')?.click();
  });
  document.getElementById('catalog-excel-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = await parseSupplierFile(file);
      openImportPreview(container, parsed, categories, catId || categories[0]?.id, file.name);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  body.querySelectorAll('[data-catalog-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.matCat = btn.dataset.catalogCat || '';
      renderSuppliers(container);
    });
  });

  document.getElementById('catalog-search')?.addEventListener('input', (e) => {
    container.dataset.catalogSearch = e.target.value;
    renderCatalogTab(body, container, categories, container.dataset.matCat);
  });

  body.querySelectorAll('.catalog-material-row').forEach((row) => {
    row.addEventListener('click', async () => {
      const primaryId = Number(row.dataset.primaryId);
      const item = catalog.find((c) => c.primaryId === primaryId);
      if (item) openCatalogMaterialDetailModal(container, item, categories, supMap);
    });
  });

  document.getElementById('catalog-merge-dup')?.addEventListener('click', () => {
    openMergeDuplicatesModal(container);
  });
}

function pickBestOffer(offers) {
  if (!offers?.length) return { unitPrice: 0, packageWeightGrams: null };
  const priced = offers.filter((o) => (o.unitPrice || 0) > 0);
  if (priced.length) {
    return priced.reduce((best, o) => ((o.unitPrice < best.unitPrice) ? o : best), priced[0]);
  }
  return offers[0];
}

function formatWeightGrams(grams) {
  if (!grams) return '—';
  if (grams >= 1000) return `${(grams / 1000).toFixed(grams % 1000 === 0 ? 0 : 2)} ק"ג`;
  return `${grams} גרם`;
}

async function openCatalogMaterialDetailModal(container, catalogItem, categories, supMap) {
  const [history, suppliers] = await Promise.all([
    getCombinedPriceHistory(catalogItem.primaryId),
    getSuppliers(),
  ]);
  const selectedOffer = pickBestOffer(catalogItem.offers);
  const pricePerKg = computePricePerKg(selectedOffer.unitPrice, selectedOffer.packageWeightGrams);

  openModal({
    title: escapeHtml(catalogItem.name),
    modalClass: 'modal-catalog-material',
    bodyHTML: `
      <div class="material-pricing-grid">
        <div class="material-pricing-cell">
          <span class="material-pricing-label">מחיר למוצר</span>
          <strong>${formatMoney(selectedOffer.unitPrice)}</strong>
        </div>
        <div class="material-pricing-cell">
          <span class="material-pricing-label">משקל מוצר</span>
          <strong>${formatWeightGrams(selectedOffer.packageWeightGrams)}</strong>
        </div>
        <div class="material-pricing-cell">
          <span class="material-pricing-label">מחיר לקילו</span>
          <strong>${pricePerKg != null ? `${formatMoney(pricePerKg)}/ק"ג` : '—'}</strong>
        </div>
      </div>
      <div class="catalog-offers-section">
        <div class="filter-row" style="margin-bottom:8px">
          <h4 class="material-detail-subtitle" style="margin:0;flex:1">הצעות מספקים</h4>
          <button type="button" class="btn btn-secondary btn-sm" id="catalog-assign-sup">+ שייך לספק</button>
        </div>
        ${catalogItem.offers.length
    ? `<table class="catalog-offers-table">
          <thead><tr><th>ספק</th><th>מחיר</th><th>משקל</th><th>מחיר/ק"ג</th><th></th></tr></thead>
          <tbody>
            ${catalogItem.offers.map((o) => {
    const ppk = computePricePerKg(o.unitPrice, o.packageWeightGrams);
    return `
            <tr data-offer-id="${o.id}">
              <td>${escapeHtml(o.supplierId ? supMap.get(o.supplierId) || '—' : 'ללא ספק')}</td>
              <td>${formatMoney(o.unitPrice)}/${escapeHtml(o.unit)}</td>
              <td>${formatWeightGrams(o.packageWeightGrams)}</td>
              <td>${ppk != null ? formatMoney(ppk) : '—'}</td>
              <td><button type="button" class="btn btn-secondary btn-sm edit-catalog-offer" data-id="${o.id}">✏️</button></td>
            </tr>`;
  }).join('')}
          </tbody>
        </table>`
    : '<p class="form-hint">אין שיוך לספקים עדיין</p>'}
      </div>
      <div class="material-detail-history">
        <h4 class="material-detail-subtitle">היסטוריית מחירים</h4>
        ${history.length
    ? `<table class="price-history-table combined-history-table">
          <thead><tr><th>תאריך</th><th>ספק</th><th>מחיר</th><th>מחיר/ק"ג</th></tr></thead>
          <tbody>
            ${history.map((h, i) => `
            <tr class="${i === 0 ? 'is-current' : ''}">
              <td>${formatDate(h.effectiveDate)}</td>
              <td>${escapeHtml(h.supplierName || '—')}</td>
              <td><strong>${formatMoney(h.price)}</strong></td>
              <td>${h.pricePerKg != null ? formatMoney(h.pricePerKg) : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>`
    : '<p class="form-hint">אין היסטוריה</p>'}
      </div>`,
    footerHTML: `<button type="button" class="btn btn-secondary modal-cancel">סגור</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('catalog-assign-sup')?.addEventListener('click', () => {
    closeModal();
    setTimeout(() => openAssignMaterialModal(container, catalogItem, categories, suppliers), 200);
  });
  document.querySelectorAll('.edit-catalog-offer').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mat = catalogItem.offers.find((o) => o.id === Number(btn.dataset.id));
      if (mat) {
        closeModal();
        switchSupplierTab('edit');
        setTimeout(() => openEditMaterialModal(container, mat), 300);
      }
    });
  });
}

function openAssignMaterialModal(container, catalogItem, categories, suppliers) {
  const defaultCat = catalogItem.supplierCategoryId || categories[0]?.id;
  openModal({
    title: `שיוך «${escapeHtml(catalogItem.name)}» לספק`,
    bodyHTML: `
      <div class="form-group"><label>קטגוריה</label>
        <select id="assign-cat">
          ${categories.map((c) => `<option value="${c.id}"${c.id === defaultCat ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>ספק</label>
        <select id="assign-supplier">
          <option value="">— בחר ספק —</option>
          ${suppliers.map((s) => `<option value="${s.id}" data-cat="${s.categoryId}">${escapeHtml(s.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>מחיר (₪)</label><input type="number" id="assign-price" min="0" step="0.01"></div>
      <div class="form-group"><label>משקל מוצר (גרם)</label><input type="number" id="assign-weight" min="0" step="1" placeholder="למשל 1000"></div>
      <div class="form-group"><label>יחידה</label><input type="text" id="assign-unit" value="ק&quot;ג"></div>`,
    footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-assign">שמור</button>`,
  });

  const catSelect = document.getElementById('assign-cat');
  const supSelect = document.getElementById('assign-supplier');
  const filterSuppliers = () => {
    const catId = Number(catSelect?.value);
    supSelect?.querySelectorAll('option[data-cat]').forEach((opt) => {
      opt.hidden = Number(opt.dataset.cat) !== catId;
    });
  };
  catSelect?.addEventListener('change', filterSuppliers);
  filterSuppliers();

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-assign')?.addEventListener('click', async () => {
    try {
      const supplierId = Number(document.getElementById('assign-supplier')?.value);
      if (!supplierId) throw new Error('בחר ספק');
      await assignMaterialToSupplier({
        name: catalogItem.name,
        supplierCategoryId: Number(document.getElementById('assign-cat')?.value),
        supplierId,
        unitPrice: document.getElementById('assign-price')?.value,
        packageWeightGrams: document.getElementById('assign-weight')?.value,
        unit: document.getElementById('assign-unit')?.value,
      });
      closeModal();
      showToast('שויך לספק ✓');
      requestAutoBackupNow().catch(() => {});
      renderSuppliers(container);
    } catch (e) {
      showToast(e.message || 'שגיאה');
    }
  });
}

function renderMergeDupGroupsHTML(groups, supMap) {
  return groups.map((g, gi) => `
    <div class="merge-dup-group" data-group="${gi}">
      <div class="merge-dup-group-name">${escapeHtml(g.name)}</div>
      <p class="form-hint merge-dup-group-hint">סמן ספקים/רשומות לשמירה · לא מסומן יאוחד</p>
      ${g.materials.map((m) => `
        <label class="merge-dup-option">
          <input type="checkbox" class="merge-keep-cb" data-group="${gi}" value="${m.id}" checked>
          <span>${escapeHtml(m.supplierId ? supMap.get(m.supplierId) || 'ללא ספק' : 'ללא ספק')}
            · ${formatMoney(m.unitPrice)}/${escapeHtml(m.unit)}</span>
        </label>`).join('')}
      <button type="button" class="btn btn-primary btn-sm merge-group-btn" data-group="${gi}">אחד קבוצה זו</button>
    </div>`).join('');
}

async function refreshMergeDuplicatesModal(container) {
  const host = document.querySelector('.merge-dup-groups');
  if (!host) return;
  const groups = await getDuplicateMaterialGroups();
  if (!groups.length) {
    closeModal();
    showToast('כל הכפילויות אוחדו ✓');
    renderSuppliers(container);
    return;
  }
  const suppliers = await getSuppliers();
  const supMap = new Map(suppliers.map((s) => [s.id, s.name]));
  host.innerHTML = renderMergeDupGroupsHTML(groups, supMap);
  host.dataset.groupsJson = JSON.stringify(groups.map((g) => ({
    materials: g.materials.map((m) => m.id),
  })));
}

async function mergeDupGroupFromUI(gi, container) {
  const host = document.querySelector('.merge-dup-groups');
  const meta = JSON.parse(host?.dataset.groupsJson || '[]');
  const groupMeta = meta[gi];
  if (!groupMeta) return;

  const checked = [...document.querySelectorAll(`.merge-keep-cb[data-group="${gi}"]:checked`)]
    .map((el) => Number(el.value));
  const allIds = groupMeta.materials;
  const mergeIds = allIds.filter((id) => !checked.includes(id));

  if (!checked.length) {
    showToast('סמן לפחות רשומה אחת לשמירה');
    return;
  }
  if (!mergeIds.length) {
    showToast('בטל סימון של רשומות שברצונך לאחד');
    return;
  }

  await mergeDuplicateMaterialsKeeping(checked, mergeIds);
  showToast('אוחד ✓');
  requestAutoBackupNow().catch(() => {});
  renderSuppliers(container);
  await refreshMergeDuplicatesModal(container);
}

async function openMergeDuplicatesModal(container) {
  const groups = await getDuplicateMaterialGroups();
  if (!groups.length) {
    showToast('לא נמצאו כפילויות');
    return;
  }
  const suppliers = await getSuppliers();
  const supMap = new Map(suppliers.map((s) => [s.id, s.name]));

  openModal({
    title: 'איחוד כפילויות חומרי גלם',
    modalClass: 'modal-merge-dup',
    bodyHTML: `
      <p class="form-hint" style="margin-top:0">סמן את הספקים/רשומות שיישארו — השאר יאוחדו (החלון נשאר פתוח לקבוצה הבאה)</p>
      <div class="merge-dup-groups" data-groups-json='${JSON.stringify(groups.map((g) => ({ materials: g.materials.map((m) => m.id) })))}'>
        ${renderMergeDupGroupsHTML(groups, supMap)}
      </div>`,
    footerHTML: `
      <button type="button" class="btn btn-secondary" id="merge-dup-all">אחד את כל הקבוצות</button>
      <button class="btn btn-secondary modal-cancel">סגור</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  const host = document.querySelector('.merge-dup-groups');
  host?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.merge-group-btn');
    if (!btn) return;
    try {
      await mergeDupGroupFromUI(Number(btn.dataset.group), container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('merge-dup-all')?.addEventListener('click', async () => {
    const btn = document.getElementById('merge-dup-all');
    if (btn) btn.disabled = true;
    try {
      let remaining = await getDuplicateMaterialGroups();
      while (remaining.length) {
        const g = remaining[0];
        const bySupplier = new Map();
        for (const m of g.materials) {
          const key = m.supplierId || `id:${m.id}`;
          if (!bySupplier.has(key)) bySupplier.set(key, m.id);
        }
        const keepIds = [...bySupplier.values()];
        const mergeIds = g.materials.map((m) => m.id).filter((id) => !keepIds.includes(id));
        if (mergeIds.length) {
          await mergeDuplicateMaterialsKeeping(keepIds, mergeIds);
        } else {
          await mergeDuplicateMaterialsKeeping([g.materials[0].id], g.materials.slice(1).map((m) => m.id));
        }
        requestAutoBackupNow().catch(() => {});
        remaining = await getDuplicateMaterialGroups();
      }
      showToast('כל הכפילויות אוחדו ✓');
      closeModal();
      renderSuppliers(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
      await refreshMergeDuplicatesModal(container);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

/* ── צפייה: ספקים + תמחור ── */

function browseSearchMatch(text, search) {
  if (!search) return true;
  return String(text || '').toLocaleLowerCase('he').includes(search);
}

function filterBrowseLayout(layout, search) {
  if (!search) return layout;
  const categories = layout.categories
    .map((cat) => {
      const suppliers = cat.suppliers
        .map((sup) => {
          const supMatch = browseSearchMatch(sup.name, search);
          const materials = supMatch
            ? sup.materials
            : sup.materials.filter((m) => browseSearchMatch(m.name, search));
          if (!supMatch && !materials.length) return null;
          return { ...sup, materials, autoExpand: true };
        })
        .filter(Boolean);
      if (!suppliers.length) return null;
      return { ...cat, suppliers };
    })
    .filter(Boolean);
  return { ...layout, categories };
}

async function renderBrowseTab(body, container) {
  const layout = await getSuppliersBrowseLayout();
  const search = (container.dataset.browseSearch || '').trim().toLocaleLowerCase('he');
  const filtered = filterBrowseLayout(layout, search);
  const expandedIds = new Set(
    JSON.parse(container.dataset.browseExpanded || '[]').map(Number).filter(Boolean),
  );
  const hasData = layout.categories.some((c) => c.suppliers.length);

  body.innerHTML = `
    <div class="card supplier-browse-intro">
      <div class="card-title">ספקים ותמחור</div>
      <p class="form-hint" style="margin:0 0 10px">לחץ על ספק לפתיחה · לחץ על חומר גלם לצפייה בהיסטוריית מחירים</p>
      ${hasData ? `
      <div class="form-group" style="margin:0">
        <input type="search" id="browse-search" class="catalog-search-input"
          placeholder="חיפוש ספק או חומר גלם..." value="${escapeHtml(container.dataset.browseSearch || '')}">
      </div>` : ''}
    </div>
    ${hasData ? filtered.categories.map((cat) => renderBrowseCategoryBlock(cat, { search, expandedIds })).join('')
    : `
    <div class="empty-state">
      <div class="empty-state-icon">🚚</div>
      <p>אין ספקים עדיין</p>
      <button type="button" class="btn btn-primary btn-sm" id="browse-go-edit">עבור לעריכה</button>
    </div>`}
    ${search && hasData && !filtered.categories.length
    ? '<p class="form-hint" style="text-align:center;padding:16px">לא נמצאו תוצאות</p>' : ''}`;

  document.getElementById('browse-go-edit')?.addEventListener('click', () => switchSupplierTab('edit'));

  document.getElementById('browse-search')?.addEventListener('input', (e) => {
    container.dataset.browseSearch = e.target.value;
    renderBrowseTab(body, container);
  });

  body.querySelectorAll('.browse-material-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      openMaterialDetailModal(container, Number(row.dataset.materialId));
    });
  });

  body.querySelectorAll('.category-toggle-browse').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.supplier-browse-cat')?.classList.toggle('is-collapsed');
    });
  });

  body.querySelectorAll('.supplier-toggle-browse').forEach((btn) => {
    btn.addEventListener('click', () => {
      const block = btn.closest('.supplier-browse-block');
      const supId = Number(block?.dataset.supplierId);
      block?.classList.toggle('is-collapsed');
      if (supId) {
        if (block?.classList.contains('is-collapsed')) expandedIds.delete(supId);
        else expandedIds.add(supId);
        container.dataset.browseExpanded = JSON.stringify([...expandedIds]);
      }
    });
  });
}

function renderBrowseCategoryBlock(cat, { search, expandedIds } = {}) {
  if (!cat.suppliers.length) return '';
  const matCount = cat.suppliers.reduce((n, s) => n + s.materials.length, 0);
  return `
    <div class="card supplier-browse-cat">
      <button type="button" class="supplier-browse-cat-header category-toggle-browse">
        <span class="supplier-browse-cat-name">${escapeHtml(cat.name)}</span>
        <span class="supplier-browse-cat-meta">${cat.suppliers.length} ספקים · ${matCount} חומרים</span>
      </button>
      <div class="supplier-browse-cat-body">
        ${cat.suppliers.map((s) => renderBrowseSupplierBlock(s, { search, expandedIds })).join('')}
      </div>
    </div>`;
}

function renderBrowseSupplierBlock(supplier, { search, expandedIds } = {}) {
  const expanded = supplier.autoExpand || expandedIds.has(supplier.id);
  const collapsedClass = expanded ? '' : ' is-collapsed';
  return `
    <section class="supplier-browse-block${collapsedClass}" data-supplier-id="${supplier.id}">
      <button type="button" class="supplier-browse-sup-header supplier-toggle-browse">
        <span class="supplier-browse-sup-name">${escapeHtml(supplier.name)}</span>
        <span class="supplier-browse-sup-meta">${supplier.materials.length} חומרים</span>
      </button>
      ${supplier.materials.length
    ? `<div class="supplier-browse-mats">
        ${supplier.materials.map((m) => `
        <button type="button" class="browse-material-row" data-material-id="${m.id}">
          <span class="browse-mat-name">${escapeHtml(m.name)}</span>
          <span class="browse-mat-price">${formatMoney(m.unitPrice)}/${escapeHtml(m.unit)}</span>
        </button>`).join('')}
      </div>`
    : '<p class="form-hint supplier-browse-empty">אין חומרי גלם</p>'}
    </section>`;
}

async function openMaterialDetailModal(container, materialId) {
  const mat = (await getRawMaterials()).find((m) => m.id === materialId);
  if (!mat) return showToast('חומר לא נמצא');

  const [history, sameName, suppliers] = await Promise.all([
    getPriceHistory(materialId),
    getMaterialsWithSameName(materialId),
    getSuppliers(),
  ]);
  const supMap = new Map(suppliers.map((s) => [s.id, s.name]));
  const others = sameName.filter((m) => m.id !== materialId);

  openModal({
    title: escapeHtml(mat.name),
    modalClass: 'modal-material-detail',
    bodyHTML: `
      <div class="material-detail-current">
        <span class="material-detail-label">מחיר נוכחי</span>
        <strong class="material-detail-price">${formatMoney(mat.unitPrice)}/${escapeHtml(mat.unit)}</strong>
        ${mat.packageWeightGrams ? `<span class="form-hint">משקל: ${formatWeightGrams(mat.packageWeightGrams)}</span>` : ''}
        ${computePricePerKg(mat.unitPrice, mat.packageWeightGrams) != null
    ? `<span class="form-hint">מחיר/ק"ג: ${formatMoney(computePricePerKg(mat.unitPrice, mat.packageWeightGrams))}</span>` : ''}
        ${mat.supplierId ? `<span class="form-hint">ספק: ${escapeHtml(supMap.get(mat.supplierId) || '')}</span>` : ''}
      </div>
      ${others.length ? `
      <div class="material-detail-others">
        <h4 class="material-detail-subtitle">אותו מוצר אצל ספקים נוספים</h4>
        <ul class="material-others-list">
          ${others.map((m) => `
          <li>
            <button type="button" class="link-btn browse-other-sup" data-id="${m.id}">
              ${escapeHtml(supMap.get(m.supplierId) || 'ללא ספק')} — ${formatMoney(m.unitPrice)}/${escapeHtml(m.unit)}
            </button>
          </li>`).join('')}
        </ul>
      </div>` : ''}
      <div class="material-detail-history">
        <h4 class="material-detail-subtitle">היסטוריית מחירים</h4>
        ${history.length
    ? `<table class="price-history-table">
          <thead><tr><th>תאריך</th><th>מחיר</th></tr></thead>
          <tbody>
            ${history.map((h, i) => `
            <tr class="${i === 0 ? 'is-current' : ''}">
              <td>${formatDate(h.effectiveDate)}</td>
              <td><strong>${formatMoney(h.price)}</strong></td>
            </tr>`).join('')}
          </tbody>
        </table>`
    : '<p class="form-hint">אין היסטוריה — עדכן מחיר בעריכה</p>'}
      </div>`,
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">סגור</button>
      <button type="button" class="btn btn-primary" id="mat-detail-edit">✏️ עריכה</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('mat-detail-edit')?.addEventListener('click', () => {
    closeModal();
    switchSupplierTab('edit');
    setTimeout(() => openEditMaterialModal(container, mat), 300);
  });
  document.querySelectorAll('.browse-other-sup').forEach((btn) => {
    btn.addEventListener('click', () => openMaterialDetailModal(container, Number(btn.dataset.id)));
  });
}

/* ── עריכה ── */

async function renderEditTab(body, container, categories, selectedMatCat, selectedSupCat) {
  const importUndo = await getSupplierImportUndo();
  body.innerHTML = `
    ${importUndo ? renderImportUndoBanner(importUndo) : ''}
    <div class="card">
      <div class="filter-row" style="margin-bottom:8px">
        <div class="card-title" style="margin:0;flex:1">עריכת ספקים וחומרי גלם</div>
        <button type="button" class="btn btn-secondary btn-sm" id="supplier-import-btn">📊 Excel</button>
        <button type="button" class="btn btn-secondary btn-sm" id="add-sup-cat-edit">+ קטגוריה</button>
      </div>
      <p class="form-hint" style="margin:0">ייבוא Excel: גיליון לכל ספק — עם כותרות (מוצר | כמות | מחיר) או בלי (שם + מחיר לק"ג)</p>
    </div>
    <div class="supplier-edit-sections" id="supplier-edit-sections">טוען...</div>
    <input type="file" id="supplier-excel-file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden>`;

  bindImportUndoButton(body, container);

  document.getElementById('supplier-import-btn')?.addEventListener('click', () => {
    document.getElementById('supplier-excel-file')?.click();
  });

  document.getElementById('supplier-excel-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = await parseSupplierFile(file);
      openImportPreview(container, parsed, categories, selectedMatCat, file.name);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('add-sup-cat-edit')?.addEventListener('click', () => {
    const name = prompt('שם קטגוריית ספקים:');
    if (!name?.trim()) return;
    addSupplierCategory(name.trim())
      .then(() => { showToast('נוסף ✓'); renderSuppliers(container); })
      .catch((err) => showToast(err.message || 'שגיאה'));
  });

  await renderEditSections(document.getElementById('supplier-edit-sections'), container, categories, selectedMatCat);
}

async function renderEditSections(host, container, categories, selectedMatCat) {
  const [materials, allSuppliers] = await Promise.all([
    getRawMaterials(Number(selectedMatCat)),
    getSuppliers(),
  ]);
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const supMap = new Map(allSuppliers.map((s) => [s.id, s.name]));
  const suppliersByCat = new Map(categories.map((c) => [c.id, []]));
  const uncategorized = [];
  for (const s of allSuppliers) {
    const cid = Number(s.categoryId);
    if (suppliersByCat.has(cid)) suppliersByCat.get(cid).push(s);
    else uncategorized.push(s);
  }
  const expandedCatIds = new Set(
    JSON.parse(container.dataset.editExpandedCats || '[]').map(String),
  );
  const isCatExpanded = (id) => expandedCatIds.has(String(id));

  host.innerHTML = `
    <div class="card">
      <div class="card-title" style="margin-bottom:10px">ספקים לפי קטגוריה</div>
      <p class="form-hint" style="margin:0 0 12px">לחץ על קטגוריה לפתיחה · שנה קטגוריה מהרשימה · לחץ על שם לעריכה</p>
      ${categories.length === 0 && !uncategorized.length
    ? '<p class="form-hint">אין קטגוריות — הוסף קטגוריה למעלה</p>'
    : `${categories.map((cat) => renderEditSupplierCategoryBlock(
      cat,
      suppliersByCat.get(cat.id) || [],
      isCatExpanded(cat.id),
      categories,
    )).join('')}${uncategorized.length ? renderEditSupplierCategoryBlock(
      { id: 'none', name: 'ללא קטגוריה' },
      uncategorized,
      isCatExpanded('none'),
      categories,
      { uncategorized: true },
    ) : ''}`}
    </div>
    <div class="card">
      <div class="card-title" style="margin-bottom:10px">חומרי גלם</div>
      <div class="workspace-chip-row supplier-cat-chip-row" style="margin-bottom:12px">
        ${categories.map((c) => `
          <button type="button" class="workspace-chip${String(c.id) === String(selectedMatCat) ? ' active' : ''}"
            data-mat-cat="${c.id}">${escapeHtml(c.name)}</button>`).join('')}
      </div>
      <div class="filter-row" style="margin-bottom:12px">
        <div class="form-hint" style="margin:0;flex:1">${escapeHtml(catMap.get(Number(selectedMatCat)) || 'בחר קטגוריה')}</div>
        <button type="button" class="btn btn-primary btn-sm" id="add-material">+ חומר</button>
      </div>
      ${materials.length === 0
    ? '<p class="form-hint">אין חומרים — ייבא מ-Excel או הוסף ידנית</p>'
    : `<div class="material-list" data-cat-id="${selectedMatCat}">
        ${materials.map((m, i) => `
        <div class="list-item material-list-item" data-material-id="${m.id}">
          <button type="button" class="material-drag-handle" aria-label="גרור">☰</button>
          <span class="material-order-num">${i + 1}</span>
          <button type="button" class="list-item-info edit-mat-open" data-id="${m.id}" style="flex:1;border:none;background:none;text-align:right;padding:0;cursor:pointer">
            <div class="list-item-name">${escapeHtml(m.name)}</div>
            <div class="list-item-meta">
              ${formatMoney(m.unitPrice)}/${escapeHtml(m.unit)}
              ${m.supplierId ? ` · ${escapeHtml(supMap.get(m.supplierId) || '')}` : ''}
            </div>
          </button>
          <div class="list-item-actions">
            <button type="button" class="btn btn-secondary btn-sm dup-mat-sup" data-id="${m.id}" title="הוסף אצל ספק נוסף">+ספק</button>
            <button type="button" class="btn btn-danger btn-sm del-mat" data-id="${m.id}">🗑</button>
          </div>
        </div>`).join('')}
      </div>`}
    </div>`;

  host.querySelectorAll('[data-mat-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.matCat = btn.dataset.matCat;
      renderEditSections(host, container, categories, btn.dataset.matCat);
    });
  });

  host.querySelectorAll('.supplier-edit-cat').forEach((el) => {
    el.addEventListener('toggle', () => {
      const catId = el.dataset.catId;
      if (!catId) return;
      if (el.open) expandedCatIds.add(String(catId));
      else expandedCatIds.delete(String(catId));
      container.dataset.editExpandedCats = JSON.stringify([...expandedCatIds]);
    });
  });

  host.querySelectorAll('.supplier-edit-cat-actions').forEach((el) => {
    el.addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('mousedown', (e) => e.preventDefault());
  });

  host.querySelectorAll('.edit-sup-cat').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = prompt('שם קטגוריה:', btn.dataset.name || '');
      if (!name?.trim() || name.trim() === btn.dataset.name) return;
      updateSupplierCategory(Number(btn.dataset.id), { name: name.trim() })
        .then(() => { showToast('עודכן ✓'); renderSuppliers(container); })
        .catch((err) => showToast(err.message || 'שגיאה'));
    });
  });

  host.querySelectorAll('.del-sup-cat').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`למחוק קטגוריה "${btn.dataset.name}"?`)) return;
      deleteSupplierCategory(Number(btn.dataset.id))
        .then(() => { showToast('נמחק'); renderSuppliers(container); })
        .catch((err) => showToast(err.message || 'שגיאה'));
    });
  });

  document.getElementById('add-material')?.addEventListener('click', async () => {
    openAddMaterialModal(container, Number(selectedMatCat), await getSuppliers());
  });

  host.querySelectorAll('.edit-mat-open').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mat = materials.find((m) => m.id === Number(btn.dataset.id));
      if (mat) openEditMaterialModal(container, mat);
    });
  });

  host.querySelectorAll('.dup-mat-sup').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mat = materials.find((m) => m.id === Number(btn.dataset.id));
      if (mat) openDuplicateMaterialModal(container, mat, Number(selectedMatCat));
    });
  });

  host.querySelectorAll('.del-mat').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק חומר גלם?')) return;
      await deleteRawMaterial(Number(btn.dataset.id));
      showToast('נמחק');
      renderSuppliers(container);
    });
  });

  host.querySelectorAll('.sup-quick-cat').forEach((sel) => {
    sel.addEventListener('click', (e) => e.stopPropagation());
    sel.addEventListener('change', async () => {
      try {
        const supId = Number(sel.dataset.supId);
        const catId = Number(sel.value);
        await updateSupplier(supId, { categoryId: catId });
        expandedCatIds.add(String(catId));
        container.dataset.editExpandedCats = JSON.stringify([...expandedCatIds]);
        showToast('שויך לקטגוריה ✓');
        renderSuppliers(container);
      } catch (e) {
        showToast(e.message || 'שגיאה');
      }
    });
  });

  host.querySelectorAll('.add-supplier-cat').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openAddSupplierModal(container, Number(btn.dataset.catId), categories);
    });
  });

  host.querySelectorAll('.edit-sup-open').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = allSuppliers.find((x) => x.id === Number(btn.dataset.id));
      if (s) openEditSupplierModal(container, s, categories);
    });
  });

  host.querySelectorAll('.del-sup').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק ספק?')) return;
      await deleteSupplier(Number(btn.dataset.id));
      renderSuppliers(container);
    });
  });

  if (materials.length) {
    bindMaterialDragList(host, Number(selectedMatCat), async (orderedIds) => {
      await setRawMaterialOrder(Number(selectedMatCat), orderedIds);
    });
  }
  for (const cat of categories) {
    const list = host.querySelector(`.supplier-list[data-cat-id="${cat.id}"]`);
    const catSuppliers = suppliersByCat.get(cat.id) || [];
    if (list && catSuppliers.length) {
      bindSupplierDragList(list.closest('.supplier-edit-cat') || host, cat.id, async (orderedIds) => {
        await setSupplierOrder(cat.id, orderedIds);
      });
    }
  }
}

function renderEditSupplierCategoryBlock(cat, suppliers, expanded, categories, { uncategorized = false } = {}) {
  const catKey = uncategorized ? 'none' : cat.id;
  return `
    <details class="supplier-edit-cat" data-cat-id="${catKey}"${expanded ? ' open' : ''}>
      <summary class="supplier-edit-cat-summary">
        <span class="supplier-edit-cat-summary-text">
          <span class="supplier-browse-cat-name">${escapeHtml(cat.name)}</span>
          <span class="supplier-browse-cat-meta">${suppliers.length} ספקים</span>
        </span>
        ${uncategorized ? '' : `
        <span class="supplier-edit-cat-actions">
          <button type="button" class="btn btn-primary btn-sm add-supplier-cat" data-cat-id="${cat.id}" title="ספק חדש">+</button>
          <button type="button" class="btn btn-secondary btn-sm btn-icon edit-sup-cat" data-id="${cat.id}" data-name="${escapeHtml(cat.name)}" title="שינוי שם">✏️</button>
          <button type="button" class="btn btn-danger btn-sm btn-icon del-sup-cat" data-id="${cat.id}" data-name="${escapeHtml(cat.name)}" title="מחיקה">🗑</button>
        </span>`}
      </summary>
      <div class="supplier-edit-cat-body">
        ${suppliers.length === 0
    ? '<p class="form-hint">אין ספקים — לחץ + להוספה</p>'
    : `<div class="supplier-list" data-cat-id="${catKey}">
        ${suppliers.map((s, i) => renderEditSupplierRow(s, categories, i)).join('')}
      </div>`}
      </div>
    </details>`;
}

function renderEditSupplierRow(s, categories, index) {
  const catOptions = categories.map((c) => `
    <option value="${c.id}"${Number(c.id) === Number(s.categoryId) ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  return `
    <div class="list-item supplier-list-item" data-supplier-id="${s.id}">
      <button type="button" class="supplier-drag-handle" aria-label="גרור">☰</button>
      <span class="supplier-order-num">${index + 1}</span>
      <button type="button" class="list-item-info edit-sup-open" data-id="${s.id}" style="flex:1;border:none;background:none;text-align:right;padding:0;cursor:pointer;min-width:0">
        <div class="list-item-name">${escapeHtml(s.name)}</div>
        <div class="list-item-meta">${s.whatsapp ? `📱 ${escapeHtml(s.whatsapp)}` : (s.phone ? `📞 ${escapeHtml(s.phone)}` : 'ללא טלפון')}</div>
      </button>
      <select class="sup-quick-cat" data-sup-id="${s.id}" aria-label="קטגוריה">${catOptions}</select>
      <div class="list-item-actions">
        <button type="button" class="btn btn-danger btn-sm del-sup" data-id="${s.id}">🗑</button>
      </div>
    </div>`;
}

function openAddMaterialModal(container, categoryId, suppliers) {
  openModal({
    title: 'חומר גלם חדש',
    bodyHTML: materialFormHTML(null, suppliers),
    footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-mat">שמור</button>`,
  });
  bindMaterialForm(container, categoryId, null);
}

function openEditMaterialModal(container, mat) {
  getSuppliers().then((suppliers) => {
    openModal({
      title: `עריכה · ${escapeHtml(mat.name)}`,
      bodyHTML: `${materialFormHTML(mat, suppliers)}
        <div class="form-group" style="margin-top:12px">
          <label>עדכון מחיר (שומר היסטוריה)</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input type="number" id="mat-new-price" min="0" step="0.01" placeholder="מחיר חדש" style="flex:1">
            <input type="date" id="mat-price-date" value="${todayISO()}" style="flex:1">
          </div>
        </div>
        <div id="mat-history-host"></div>`,
      footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-mat">שמור</button>`,
    });
    bindMaterialForm(container, mat.supplierCategoryId, mat.id);
    loadMaterialHistory(mat.id);
  });
}

async function loadMaterialHistory(materialId) {
  const host = document.getElementById('mat-history-host');
  if (!host) return;
  const history = await getPriceHistory(materialId);
  host.innerHTML = history.length
    ? `<div class="form-group"><label>היסטוריה</label>
        <ul class="price-history-mini">${history.slice(0, 8).map((h) => `
          <li>${formatDate(h.effectiveDate)} — <strong>${formatMoney(h.price)}</strong></li>`).join('')}
        </ul></div>`
    : '';
}

function materialFormHTML(mat, suppliers) {
  return `
    <div class="form-group"><label>שם</label><input type="text" id="mat-name" value="${mat ? escapeHtml(mat.name) : ''}"></div>
    <div class="form-group"><label>יחידה</label><input type="text" id="mat-unit" value="${mat ? escapeHtml(mat.unit) : 'ק&quot;ג'}"></div>
    <div class="form-group"><label>מחיר נוכחי (₪)</label><input type="number" id="mat-price" min="0" step="0.01" value="${mat?.unitPrice ?? ''}"></div>
    <div class="form-group"><label>משקל מוצר (גרם)</label><input type="number" id="mat-weight" min="0" step="1" value="${mat?.packageWeightGrams ?? ''}" placeholder="לחישוב מחיר/ק&quot;ג"></div>
    <div class="form-group"><label>ספק</label>
      <select id="mat-supplier"><option value="">—</option>
        ${suppliers.map((s) => `<option value="${s.id}"${mat?.supplierId === s.id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
      </select>
    </div>`;
}

function bindMaterialForm(container, categoryId, materialId) {
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-mat')?.addEventListener('click', async () => {
    try {
      const payload = {
        name: document.getElementById('mat-name')?.value,
        unit: document.getElementById('mat-unit')?.value,
        supplierId: document.getElementById('mat-supplier')?.value || null,
        packageWeightGrams: document.getElementById('mat-weight')?.value,
      };
      if (materialId) {
        await updateRawMaterial(materialId, payload);
        const newPrice = document.getElementById('mat-new-price')?.value;
        const priceDate = document.getElementById('mat-price-date')?.value;
        if (newPrice !== '' && newPrice != null) {
          await setRawMaterialPrice(materialId, newPrice, priceDate || todayISO());
        } else {
          const basePrice = document.getElementById('mat-price')?.value;
          const current = await getRawMaterials();
          const m = current.find((x) => x.id === materialId);
          if (m && basePrice !== '' && Number(basePrice) !== Number(m.unitPrice)) {
            await setRawMaterialPrice(materialId, basePrice, todayISO());
          }
        }
      } else {
        await addRawMaterial({
          supplierCategoryId: categoryId,
          ...payload,
          unitPrice: document.getElementById('mat-price')?.value,
        });
      }
      closeModal();
      showToast('נשמר ✓');
      requestAutoBackupNow().catch(() => {});
      renderSuppliers(container);
    } catch (e) {
      showToast(e.message || 'שגיאה');
    }
  });
}

function openDuplicateMaterialModal(container, mat, categoryId) {
  getSuppliers().then((suppliers) => {
    const others = suppliers.filter((s) => s.id !== mat.supplierId);
    openModal({
      title: `אותו מוצר אצל ספק נוסף`,
      bodyHTML: `
        <p class="form-hint">ייווצר «${escapeHtml(mat.name)}» אצל ספק אחר — מחיר נפרד לכל ספק</p>
        <div class="form-group"><label>ספק</label>
          <select id="dup-supplier">${others.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>מחיר (₪)</label><input type="number" id="dup-price" min="0" step="0.01" value="${mat.unitPrice || ''}"></div>
        <div class="form-group"><label>תאריך מחיר</label><input type="date" id="dup-date" value="${todayISO()}"></div>`,
      footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-dup">שמור</button>`,
    });
    document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('save-dup')?.addEventListener('click', async () => {
      try {
        const sid = Number(document.getElementById('dup-supplier')?.value);
        const mid = await addRawMaterial({
          supplierCategoryId: categoryId,
          name: mat.name,
          unit: mat.unit,
          unitPrice: 0,
          supplierId: sid,
        });
        const price = document.getElementById('dup-price')?.value;
        if (price !== '') {
          await setRawMaterialPrice(mid, price, document.getElementById('dup-date')?.value || todayISO());
        }
        closeModal();
        showToast('נוסף אצל ספק נוסף ✓');
        renderSuppliers(container);
      } catch (e) {
        showToast(e.message || 'שגיאה');
      }
    });
  });
}

function openAddSupplierModal(container, categoryId, categories) {
  openModal({
    title: 'ספק חדש',
    bodyHTML: supplierFormHTML(null, categories, categoryId),
    footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-sup">שמור</button>`,
  });
  bindSupplierForm(container, categoryId, null);
}

function openEditSupplierModal(container, supplier, categories) {
  openModal({
    title: `עריכה · ${escapeHtml(supplier.name)}`,
    bodyHTML: supplierFormHTML(supplier, categories, supplier.categoryId),
    footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-sup">שמור</button>`,
  });
  bindSupplierForm(container, supplier.categoryId, supplier.id);
}

function supplierFormHTML(s, categories, defaultCategoryId) {
  const selectedCat = s?.categoryId ?? defaultCategoryId;
  const catOptions = (categories || []).map((c) => `
    <option value="${c.id}"${String(c.id) === String(selectedCat) ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  return `
    <div class="form-group"><label>שם</label><input type="text" id="sup-name" value="${s ? escapeHtml(s.name) : ''}"></div>
    <div class="form-group">
      <label>קטגוריה</label>
      <select id="sup-cat"${catOptions ? '' : ' disabled'}>${catOptions || '<option value="">— אין קטגוריות —</option>'}</select>
    </div>
    <div class="form-group"><label>וואטסאפ / טלפון</label><input type="tel" id="sup-wa" value="${s ? escapeHtml(s.whatsapp || s.phone || '') : ''}"></div>
    <div class="form-group"><label>הערות</label><input type="text" id="sup-notes" value="${s ? escapeHtml(s.notes || '') : ''}"></div>`;
}

function bindSupplierForm(container, categoryId, supplierId) {
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-sup')?.addEventListener('click', async () => {
    try {
      const payload = {
        name: document.getElementById('sup-name')?.value,
        whatsapp: document.getElementById('sup-wa')?.value,
        notes: document.getElementById('sup-notes')?.value,
        categoryId: Number(document.getElementById('sup-cat')?.value) || categoryId,
      };
      if (supplierId) await updateSupplier(supplierId, payload);
      else await addSupplier({ categoryId, ...payload });
      closeModal();
      showToast('נשמר ✓');
      renderSuppliers(container);
    } catch (e) {
      showToast(e.message || 'שגיאה');
    }
  });
}

function importFormatLabel(format) {
  if (format === 'supplier_sheets') return 'גיליון לכל ספק';
  if (format === 'wide') return 'טבלת ספקים';
  if (format === 'long') return 'רשימה';
  return format || 'לא ידוע';
}

function renderImportUndoBanner(undo) {
  const when = undo.createdAt ? formatDate(undo.createdAt.slice(0, 10)) : '';
  const hint = undo.fileHint ? ` · ${escapeHtml(undo.fileHint)}` : '';
  return `
    <div class="card import-undo-banner">
      <div class="filter-row" style="margin:0;align-items:center">
        <span class="form-hint" style="margin:0;flex:1">
          ייבוא אחרון${when ? ` (${when})` : ''}${hint} — ניתן לבטל. חומרים שמקושרים למתכונים לא יימחקו.
        </span>
        <button type="button" class="btn btn-danger btn-sm" id="undo-sup-import-btn">בטל ייבוא</button>
      </div>
    </div>`;
}

function bindImportUndoButton(host, container) {
  host.querySelector('#undo-sup-import-btn')?.addEventListener('click', async () => {
    if (!confirm('לבטל את הייבוא האחרון? מחירים וחומרים חדשים יוסרו — מתכונים לא ייפגעו.')) return;
    try {
      const { keptForRecipes } = await undoSupplierImport();
      showToast(
        keptForRecipes > 0
          ? `הייבוא בוטל · ${keptForRecipes} חומרים נשארו כי הם במתכונים`
          : 'הייבוא בוטל ✓',
      );
      requestAutoBackupNow().catch(() => {});
      renderSuppliers(container);
    } catch (e) {
      showToast(e.message || 'שגיאה');
    }
  });
}

function openImportPreview(container, parsed, categories, defaultCatId, fileName = '') {
  const { entries, format, sheets } = parsed;
  const preview = entries.slice(0, 12);
  const uniqueMaterials = new Set(entries.map((e) => e.materialName)).size;
  const uniqueSuppliers = new Set(entries.map((e) => e.supplierName)).size;
  const sheetsBlock = format === 'supplier_sheets' && sheets?.length
    ? `<p class="form-hint" style="margin-top:8px">גיליונות (${sheets.length}): ${sheets.map((s) => `${escapeHtml(s.name)} (${s.entries})`).join(' · ')}</p>`
    : '';

  openModal({
    title: `ייבוא ${entries.length} רשומות · ${importFormatLabel(format)}`,
    bodyHTML: `
      <p class="form-hint">${uniqueMaterials} חומרים · ${uniqueSuppliers} ספקים · ייווצרו/יעודכנו מחירים והיסטוריה</p>
      ${sheetsBlock}
      <div class="form-group">
        <label>קטגוריית ברירת מחדל לספקים חדשים</label>
        <select id="import-sup-cat">
          ${categories.map((c) => `<option value="${c.id}"${String(c.id) === String(defaultCatId) ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <ul class="import-supplier-preview">
        ${preview.map((e) => `
          <li><strong>${escapeHtml(e.materialName)}</strong> · ${escapeHtml(e.supplierName)} · ${formatMoney(e.price || 0)}${e.effectiveDate ? ` · ${formatDate(e.effectiveDate)}` : ''}</li>`).join('')}
        ${entries.length > preview.length ? `<li class="form-hint">+ עוד ${entries.length - preview.length}...</li>` : ''}
      </ul>
      <p class="form-hint" style="margin-top:10px">אחרי הייבוא תוכל לבטל דרך «בטל ייבוא» — בלי לפגוע במתכונים.</p>`,
    footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="confirm-sup-import">ייבוא ✓</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('confirm-sup-import')?.addEventListener('click', async () => {
    try {
      const catId = Number(document.getElementById('import-sup-cat')?.value);
      const { stats } = await importSupplierExcelEntries(entries, {
        defaultCategoryId: catId,
        fileHint: fileName || '',
      });
      closeModal();
      showToast(`יובאו: ${stats.suppliersAdded} ספקים · ${stats.materialsAdded} חומרים · ${stats.priceEntries} מחירים ✓`);
      requestAutoBackupNow().catch(() => {});
      renderSuppliers(container);
    } catch (e) {
      showToast(e.message || 'שגיאה');
    }
  });
}

/* ── הזמנה ── */

async function renderOrderTab(body, container, products, weekStart) {
  const plan = await getWeeklyPlan(weekStart);
  const planMap = new Map(plan.items.map((i) => [i.productId, i.plannedPortions]));
  const { categories } = await computeWeeklyMaterialNeeds(weekStart);
  const text = formatWhatsAppOrderText({ weekStart, categories });

  body.innerHTML = `
    <div class="card">
      <div class="card-title">תוכנית ייצור שבועית</div>
      <p class="form-hint" style="margin-bottom:10px">שבוע שמתחיל ב-${formatDate(weekStart)}</p>
      <div class="form-group">
        <label>תחילת שבוע</label>
        <input type="date" id="plan-week" value="${weekStart}">
      </div>
      ${products.length === 0
    ? '<p class="form-hint">אין מוצרים — הוסף במסך מוצרים</p>'
    : products.slice(0, 40).map((p) => `
        <div class="list-item plan-product-row">
          <div class="list-item-info">
            <div class="list-item-name">${escapeHtml(p.name)}</div>
            <div class="list-item-meta plan-recipe-hint" data-pid="${p.id}">...</div>
          </div>
          <input type="number" class="plan-portions-input" data-pid="${p.id}" min="0" step="1"
            value="${planMap.get(p.id) ?? ''}" placeholder="0">
        </div>`).join('')}
    </div>
    <div class="card">
      <div class="card-title">רשימת הזמנה</div>
      ${categories.length === 0
    ? '<p class="form-hint">מלא תוכנית שבועית וקשר מתכונים למוצרים</p>'
    : categories.map((cat) => `
        <div class="order-category-block">
          <h3 class="order-category-title">${escapeHtml(cat.categoryName)}</h3>
          <ul class="order-items-list">
            ${cat.items.map((item) => `<li><strong>${escapeHtml(item.name)}</strong>: ${item.totalQty} ${escapeHtml(item.unit)}</li>`).join('')}
          </ul>
        </div>`).join('')}
      <textarea id="wa-order-text" class="wa-order-text" rows="8" readonly>${escapeHtml(text)}</textarea>
      <button type="button" class="btn btn-primary" id="copy-wa-order" style="width:100%;margin-top:8px">📋 העתק לוואטסאפ</button>
    </div>`;

  document.getElementById('plan-week')?.addEventListener('change', (e) => {
    container.dataset.planWeek = e.target.value;
    renderSuppliers(container);
  });

  for (const el of body.querySelectorAll('.plan-recipe-hint')) {
    const r = await getRecipeForProduct(Number(el.dataset.pid));
    el.textContent = r ? `📒 ${r.name}` : '⚠️ אין מתכון';
  }

  body.querySelectorAll('.plan-portions-input').forEach((input) => {
    input.addEventListener('change', async () => {
      try {
        await setWeeklyPlanItem(plan.id, Number(input.dataset.pid), input.value);
        requestAutoBackupNow().catch(() => {});
        showToast('נשמר ✓');
        renderSuppliers(container);
      } catch (e) {
        showToast(e.message || 'שגיאה');
      }
    });
  });

  document.getElementById('copy-wa-order')?.addEventListener('click', async () => {
    const ta = document.getElementById('wa-order-text');
    try {
      await navigator.clipboard.writeText(ta.value);
      showToast('הועתק ✓');
    } catch {
      ta.select();
      document.execCommand('copy');
      showToast('הועתק ✓');
    }
  });
}
