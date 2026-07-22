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
  getDuplicateMaterialGroups, mergeDuplicateMaterials, mergeDuplicateMaterialsKeeping, mergeSelectedRawMaterials,
  buildMergedMaterialSynonyms, computePricePerKg,
  computePackagePrice, packageWeightKgFromGrams, packageWeightGramsFromKg, rawMaterialPricingFromPerKg,
  getMaterialPurchasePricePerKg, getMaterialEffectivePricePerKg, sanitizeProcessedPricePerKg,
  getSupplierShortagesGrouped, addSupplierShortage, updateSupplierShortage, deleteSupplierShortage,
  clearDoneSupplierShortages, formatSupplierShortagesText,
  PACKAGING_KIND_CARTON, PACKAGING_KIND_PLASTIC,
  getPackagingKindLabel, isPackagingSupplierCategory, computePackagingCostPerProduct,
  getMaterialSynonyms, sanitizeMaterialSynonyms, materialMatchesSearch,
  setRawMaterialRecipeDefault,
  setRawMaterialAsPortion,
} from '../kitchen-db.js?v=344';
import { getProducts } from '../db.js?v=344';
import { parseSupplierFile } from '../supplier-import.js?v=344';
import { escapeHtml, showToast, formatMoney, weekStartISO, formatDate, todayISO } from '../utils.js?v=344';
import { openModal, closeModal } from '../modal.js?v=344';
import { requestAutoBackupNow } from '../backup-service.js?v=344';
import { bindSupplierDragList, bindMaterialDragList } from '../product-drag.js?v=344';

const SUPPLIER_TAB_KEY = 'yitzurSupplierTab';

export const SUPPLIER_TABS = {
  catalog: { id: 'catalog', label: 'מחסן', subtitle: 'רשימת חומרי גלם כללית, שיוך לספקים' },
  browse: { id: 'browse', label: 'ספקים', subtitle: 'רשימת ספקים, תמחור והיסטוריית מחירים' },
  edit: { id: 'edit', label: 'עריכה', subtitle: 'עריכת ספקים, חומרי גלם, מחירים וייבוא Excel' },
  order: { id: 'order', label: 'הזמנה', subtitle: 'תוכנית שבועית ובניית הזמנה' },
  shortages: { id: 'shortages', label: 'חוסרים', subtitle: 'רשימת חוסרים לפי ספק עם כמות הזמנה' },
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
  else if (tab === 'shortages') await renderShortagesTab(body, container);
  else await renderOrderTab(body, container, products, weekStart);
}

/* ── מחסן: קטלוג חומרי גלם ── */

function renderSupplierCategoryChipLabel(cat) {
  const prefix = cat?.isPackaging ? '📦 ' : '';
  return `${prefix}${escapeHtml(cat.name)}`;
}

function renderPackagingMetaLine(material) {
  if (!material?.packagingKind) return '';
  const kind = getPackagingKindLabel(material.packagingKind);
  const units = material.packUnitsCount > 1 ? `${material.packUnitsCount} בחבילה` : '';
  const products = material.packagingKind === PACKAGING_KIND_CARTON && material.packProductsPerUnit > 1
    ? `${material.packProductsPerUnit} מוצרים/קרטון`
    : '';
  const cost = computePackagingCostPerProduct(material);
  const parts = [kind, units, products, cost != null ? `${formatMoney(cost)}/מוצר` : ''].filter(Boolean);
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

/** מטא־דאטה לתצוגה ברשימות — באריזות בלי מחיר/ק״ג מטעה */
function formatMaterialPriceMeta(m) {
  if (m?.packagingKind) {
    return (Number(m.unitPrice) || 0) > 0 ? formatMoney(m.unitPrice) : '—';
  }
  const ppk = getMaterialPurchasePricePerKg(m);
  const parts = [];
  if (ppk != null) parts.push(`${formatMoney(ppk)}/ק"ג`);
  if ((m.unitPrice || 0) > 0 && m.packageWeightGrams) {
    parts.push(`אריזה ${formatMoney(m.unitPrice)} (${formatWeightGrams(m.packageWeightGrams)})`);
  } else if ((m.unitPrice || 0) > 0) {
    parts.push(formatMoney(m.unitPrice));
  }
  return parts.join(' · ') || '—';
}

function filterCatalogItems(catalog, search) {
  if (!search) return catalog;
  return catalog.filter((item) => {
    if (String(item.name || '').toLocaleLowerCase('he').includes(search)) return true;
    return (item.offers || []).some((o) => materialMatchesSearch(o, search));
  });
}

function renderCatalogResultsHTML(items) {
  if (items.length === 0) {
    return '<p class="form-hint">אין חומרי גלם — ייבא מ-Excel או הוסף בעריכה</p>';
  }
  return `<div class="catalog-material-list">
    ${items.map((item) => {
    const best = pickBestOffer(item.offers);
    const ppk = getMaterialPurchasePricePerKg(best);
    const packMeta = renderPackagingMetaLine(best);
    const defaultMeta = item.recipeDefaultId
      ? ' <span class="recipe-default-badge" title="ברירת מחדל למתכונים">★ ברירת מחדל</span>'
      : '';
    return `
      <button type="button" class="catalog-material-row" data-primary-id="${item.primaryId}">
        <span class="catalog-mat-name">${escapeHtml(item.name)}${defaultMeta}</span>
        <span class="catalog-mat-meta">
          ${item.supplierCount ? `${item.supplierCount} ספקים` : 'ללא ספק'}
          ${best.packagingKind
    ? ((Number(best.unitPrice) || 0) > 0 ? ` · ${formatMoney(best.unitPrice)}` : '')
    : `${ppk != null ? ` · ${formatMoney(ppk)}/ק"ג` : ''}${best.unitPrice > 0 && best.packageWeightGrams ? ` · אריזה ${formatMoney(best.unitPrice)}` : ''}`}
        </span>
        ${packMeta ? `<span class="catalog-mat-pack">${packMeta.replace(/^\s·\s*/, '')}</span>` : ''}
      </button>`;
  }).join('')}
  </div>`;
}

function bindCatalogMaterialRows(body, container) {
  const { catalog, categories, supMap } = container._catalogState || {};
  body.querySelectorAll('#catalog-results .catalog-material-row').forEach((row) => {
    row.addEventListener('click', async () => {
      const primaryId = Number(row.dataset.primaryId);
      const item = catalog.find((c) => c.primaryId === primaryId);
      if (item) openCatalogMaterialDetailModal(container, item, categories, supMap);
    });
  });
}

function updateCatalogResults(body, container) {
  const { catalog } = container._catalogState || {};
  if (!catalog) return;
  const search = (container.dataset.catalogSearch || '').trim().toLowerCase();
  const items = filterCatalogItems(catalog, search);
  const resultsEl = body.querySelector('#catalog-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = renderCatalogResultsHTML(items);
  bindCatalogMaterialRows(body, container);
}

async function renderCatalogTab(body, container, categories, selectedCatId) {
  const catId = selectedCatId ? Number(selectedCatId) : null;
  const search = (container.dataset.catalogSearch || '').trim().toLowerCase();
  const [catalog, suppliers, importUndo] = await Promise.all([
    getMasterMaterialsList(catId || undefined),
    getSuppliers(),
    getSupplierImportUndo(),
  ]);
  const supMap = new Map(suppliers.map((s) => [s.id, s.name]));
  container._catalogState = { catalog, categories, supMap };

  const items = filterCatalogItems(catalog, search);

  body.innerHTML = `
    ${importUndo ? renderImportUndoBanner(importUndo) : ''}
    <div class="card catalog-intro">
      <div class="filter-row" style="margin-bottom:8px">
        <div class="card-title" style="margin:0;flex:1">מחסן חומרי גלם</div>
        <button type="button" class="btn btn-secondary btn-sm" id="catalog-import-btn">📊 Excel</button>
        <button type="button" class="btn btn-secondary btn-sm" id="catalog-merge-dup">אחד כפילויות</button>
        <button type="button" class="btn btn-secondary btn-sm" id="catalog-merge-selected">איחוד נבחרים</button>
      </div>
      <p class="form-hint" style="margin:0">כל חומר מוצג פעם אחת · גיליון לכל ספק (עם או בלי כותרות — שם + מחיר לק"ג)</p>
    </div>
    <div class="card">
      <div class="workspace-chip-row catalog-cat-chips" style="margin-bottom:10px">
        <button type="button" class="workspace-chip${!catId ? ' active' : ''}" data-catalog-cat="">הכל</button>
        ${categories.map((c) => `
          <button type="button" class="workspace-chip${String(c.id) === String(catId) ? ' active' : ''}"
            data-catalog-cat="${c.id}">${renderSupplierCategoryChipLabel(c)}</button>`).join('')}
      </div>
      <div class="form-group" style="margin-bottom:12px">
        <input type="search" id="catalog-search" class="catalog-search-input"
          placeholder="חיפוש לפי שם..." value="${escapeHtml(container.dataset.catalogSearch || '')}">
      </div>
      <div id="catalog-results">${renderCatalogResultsHTML(items)}</div>
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
    updateCatalogResults(body, container);
  });

  bindCatalogMaterialRows(body, container);

  document.getElementById('catalog-merge-dup')?.addEventListener('click', () => {
    openMergeDuplicatesModal(container);
  });
  document.getElementById('catalog-merge-selected')?.addEventListener('click', () => {
    openMergeSelectedMaterialsModal(container);
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

function readMaterialPricingFromForm() {
  return rawMaterialPricingFromPerKg({
    pricePerKg: document.getElementById('mat-price-per-kg')?.value,
    packageWeightKg: document.getElementById('mat-package-qty')?.value,
  });
}

function renderMaterialPricingDetailsHTML(mat) {
  const purchasePerKg = getMaterialPurchasePricePerKg(mat);
  const processedPerKg = sanitizeProcessedPricePerKg(mat?.processedPricePerKg);
  const effectivePerKg = getMaterialEffectivePricePerKg(mat);
  return `
    <div class="material-pricing-grid material-pricing-grid-4">
      <div class="material-pricing-cell">
        <span class="material-pricing-label">מחיר לקילו</span>
        <strong>${purchasePerKg != null ? `${formatMoney(purchasePerKg)}/ק"ג` : '—'}</strong>
      </div>
      <div class="material-pricing-cell">
        <span class="material-pricing-label">כמות באריזה</span>
        <strong>${formatWeightGrams(mat.packageWeightGrams)}</strong>
      </div>
      <div class="material-pricing-cell">
        <span class="material-pricing-label">מחיר לאריזה</span>
        <strong>${formatMoney(mat.unitPrice || 0)}</strong>
      </div>
      <div class="material-pricing-cell${processedPerKg ? ' is-processed' : ''}">
        <span class="material-pricing-label">מחיר לאחר עיבוד</span>
        <strong>${processedPerKg != null ? `${formatMoney(processedPerKg)}/ק"ג` : '—'}</strong>
      </div>
    </div>
    ${processedPerKg && effectivePerKg != null
    ? `<p class="form-hint material-effective-hint">לחישוב במתכונים: <strong>${formatMoney(effectivePerKg)}/ק"ג</strong></p>`
    : ''}`;
}

function updateMaterialPricePreview() {
  const preview = document.getElementById('mat-package-price-preview');
  if (!preview) return;
  const { unitPrice, packageWeightGrams } = readMaterialPricingFromForm();
  const perKg = getMaterialPurchasePricePerKg({ unitPrice, packageWeightGrams });
  const parts = [];
  if (unitPrice > 0 && packageWeightGrams) {
    parts.push(`מחיר לאריזה: ${formatMoney(unitPrice)}`);
  }
  if (perKg != null && packageWeightGrams) {
    parts.push(`${formatMoney(perKg)}/ק"ג`);
  }
  preview.textContent = parts.join(' · ');
}

function bindMaterialPricePreviewFields() {
  ['mat-price-per-kg', 'mat-package-qty'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', updateMaterialPricePreview);
  });
  updateMaterialPricePreview();
}

async function openCatalogMaterialDetailModal(container, catalogItem, categories, supMap) {
  const [history, suppliers] = await Promise.all([
    getCombinedPriceHistory(catalogItem.primaryId),
    getSuppliers(),
  ]);
  const selectedOffer = pickBestOffer(catalogItem.offers);

  openModal({
    title: escapeHtml(catalogItem.name),
    modalClass: 'modal-catalog-material',
    bodyHTML: `
      ${renderMaterialPricingDetailsHTML(selectedOffer)}
      <div class="catalog-offers-section">
        <div class="filter-row" style="margin-bottom:8px">
          <h4 class="material-detail-subtitle" style="margin:0;flex:1">הצעות מספקים</h4>
          <button type="button" class="btn btn-secondary btn-sm" id="catalog-assign-sup">+ שייך לספק</button>
        </div>
        ${catalogItem.offers.length
    ? `<table class="catalog-offers-table">
          <thead><tr><th>ספק</th><th>מחיר/ק"ג</th><th>כמות באריזה</th><th>מחיר לאריזה</th><th>לאחר עיבוד</th><th>מתכונים</th><th></th></tr></thead>
          <tbody>
            ${catalogItem.offers.map((o) => {
    const ppk = getMaterialPurchasePricePerKg(o);
    const processed = sanitizeProcessedPricePerKg(o.processedPricePerKg);
    const isDefault = !!o.isRecipeDefault;
    return `
            <tr data-offer-id="${o.id}" class="${isDefault ? 'is-recipe-default' : ''}">
              <td>${escapeHtml(o.supplierId ? supMap.get(o.supplierId) || '—' : 'ללא ספק')}${isDefault ? ' <span class="recipe-default-badge">★</span>' : ''}</td>
              <td>${ppk != null ? formatMoney(ppk) : '—'}</td>
              <td>${formatWeightGrams(o.packageWeightGrams)}</td>
              <td>${formatMoney(o.unitPrice)}</td>
              <td>${processed != null ? formatMoney(processed) : '—'}</td>
              <td>
                <button type="button" class="btn btn-sm ${isDefault ? 'btn-primary' : 'btn-secondary'} set-recipe-default" data-id="${o.id}" data-on="${isDefault ? '1' : '0'}" title="${isDefault ? 'הסר ברירת מחדל' : 'סמן כברירת מחדל למתכונים'}">
                  ${isDefault ? '★ ברירת מחדל' : 'סמן ברירת מחדל'}
                </button>
              </td>
              <td><button type="button" class="btn btn-secondary btn-sm edit-catalog-offer" data-id="${o.id}">✏️</button></td>
            </tr>`;
  }).join('')}
          </tbody>
        </table>`
    : '<p class="form-hint">אין שיוך לספקים עדיין</p>'}
      </div>
      <p class="form-hint">ברירת מחדל למתכונים — ההצעה והמחיר יופיעו אוטומטית בכל המתכונים עם החומר הזה (אפשר לעקוף בכל מתכון)</p>
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
  document.querySelectorAll('.set-recipe-default').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const id = Number(btn.dataset.id);
        const currentlyOn = btn.dataset.on === '1';
        await setRawMaterialRecipeDefault(id, !currentlyOn);
        showToast(currentlyOn ? 'בוטלה ברירת המחדל' : 'סומן כברירת מחדל למתכונים ✓');
        requestAutoBackupNow().catch(() => {});
        closeModal();
        await renderSuppliers(container);
        const catalog = await getMasterMaterialsList();
        const nextItem = catalog.find((c) => c.offers.some((o) => o.id === id))
          || catalog.find((c) => c.primaryId === catalogItem.primaryId);
        if (nextItem) openCatalogMaterialDetailModal(container, nextItem, categories, supMap);
      } catch (e) {
        showToast(e.message || 'שגיאה');
      }
    });
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
      <div class="form-group"><label>מחיר לקילו (₪)</label><input type="number" id="assign-price-per-kg" min="0" step="0.01"></div>
      <div class="form-group"><label>כמות באריזה (ק&quot;ג)</label><input type="number" id="assign-package-qty" min="0" step="0.001" placeholder="למשל 1"></div>
      <p class="form-hint" id="assign-package-price-preview"></p>
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

  const updateAssignPricePreview = () => {
    const preview = document.getElementById('assign-package-price-preview');
    if (!preview) return;
    const { unitPrice, packageWeightGrams } = rawMaterialPricingFromPerKg({
      pricePerKg: document.getElementById('assign-price-per-kg')?.value,
      packageWeightKg: document.getElementById('assign-package-qty')?.value,
    });
    preview.textContent = unitPrice > 0 && packageWeightGrams
      ? `מחיר לאריזה: ${formatMoney(unitPrice)}`
      : '';
  };
  ['assign-price-per-kg', 'assign-package-qty'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', updateAssignPricePreview);
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-assign')?.addEventListener('click', async () => {
    try {
      const supplierId = Number(document.getElementById('assign-supplier')?.value);
      if (!supplierId) throw new Error('בחר ספק');
      const pricing = rawMaterialPricingFromPerKg({
        pricePerKg: document.getElementById('assign-price-per-kg')?.value,
        packageWeightKg: document.getElementById('assign-package-qty')?.value,
      });
      await assignMaterialToSupplier({
        name: catalogItem.name,
        supplierCategoryId: Number(document.getElementById('assign-cat')?.value),
        supplierId,
        unitPrice: pricing.unitPrice,
        packageWeightGrams: pricing.packageWeightGrams,
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
            · ${formatMaterialPriceMeta(m)}</span>
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
  await refreshMergeDuplicatesModal(container);
}

async function openMergeSelectedMaterialsModal(container) {
  const [materials, suppliers] = await Promise.all([getRawMaterials(), getSuppliers()]);
  if (materials.length < 2) {
    showToast('צריך לפחות 2 חומרי גלם לאיחוד');
    return;
  }
  const supMap = new Map(suppliers.map((s) => [s.id, s.name]));
  const sorted = [...materials].sort((a, b) => a.name.localeCompare(b.name, 'he') || a.id - b.id);

  function renderOptions(search = '') {
    const q = search.trim().toLocaleLowerCase('he');
    const list = sorted.filter((m) => materialMatchesSearch(m, q, {
      supplierName: m.supplierId ? (supMap.get(m.supplierId) || '') : '',
    }));
    if (!list.length) return '<p class="form-hint">אין תוצאות</p>';
    return list.map((m) => `
      <div class="merge-product-option manual-merge-option manual-mat-merge-option">
        <label class="manual-mat-merge-select">
          <input type="checkbox" class="manual-mat-merge-check" value="${m.id}">
          <span class="manual-mat-merge-option-body">
            <strong>${escapeHtml(m.name)}</strong>
            <span class="merge-product-meta">
              ${escapeHtml(m.supplierId ? (supMap.get(m.supplierId) || 'ספק') : 'ללא ספק')}
              · ${formatMaterialPriceMeta(m)}
              ${m.isRecipeDefault ? ' · ★ ברירת מחדל' : ''}
            </span>
          </span>
        </label>
        <label class="manual-mat-merge-keep" title="רשומה שתישאר">
          <input type="radio" name="manual-mat-keep" class="manual-mat-keep-radio" value="${m.id}" disabled>
          <span>יעד</span>
        </label>
      </div>`).join('');
  }

  openModal({
    title: 'איחוד חומרי גלם נבחרים',
    modalClass: 'modal-merge-selected-mats',
    bodyHTML: `
      <p class="form-hint" style="margin-top:0;line-height:1.5">
        בחר 2 חומרים או יותר — גם עם שמות שונים. הרשומה המסומנת כ«יעד» נשארת;
        השאר מאוחדים אליה (מחירים, היסטוריה, מתכונים). שמות שונים מתווספים למילים נרדפות.
      </p>
      <div class="form-group" style="margin-bottom:8px">
        <input type="search" id="manual-mat-merge-search" placeholder="חיפוש לפי שם / מילה נרדפת / ספק..." autocomplete="off">
      </div>
      <div class="manual-merge-list" id="manual-mat-merge-list">
        ${renderOptions()}
      </div>
      <p class="form-hint" id="manual-mat-merge-preview" style="margin-top:10px"></p>`,
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">ביטול</button>
      <button type="button" class="btn btn-primary" id="confirm-manual-mat-merge">אחד חומרים</button>`,
  });

  const listEl = document.getElementById('manual-mat-merge-list');
  const previewEl = document.getElementById('manual-mat-merge-preview');

  function selectedMats() {
    const ids = [...document.querySelectorAll('.manual-mat-merge-check:checked')].map((el) => Number(el.value));
    return ids.map((id) => sorted.find((m) => m.id === id)).filter(Boolean);
  }

  function syncKeepRadios() {
    const checked = new Set(
      [...document.querySelectorAll('.manual-mat-merge-check:checked')].map((el) => el.value),
    );
    listEl.querySelectorAll('.manual-mat-merge-option').forEach((row) => {
      const cb = row.querySelector('.manual-mat-merge-check');
      const radio = row.querySelector('.manual-mat-keep-radio');
      if (!cb || !radio) return;
      const on = checked.has(cb.value);
      radio.disabled = !on;
      if (!on) radio.checked = false;
    });
    const enabledRadios = [...listEl.querySelectorAll('.manual-mat-keep-radio:not(:disabled)')];
    if (enabledRadios.length && !enabledRadios.some((r) => r.checked)) {
      enabledRadios[0].checked = true;
    }
    updatePreview();
  }

  function updatePreview() {
    if (!previewEl) return;
    const mats = selectedMats();
    if (mats.length < 2) {
      previewEl.textContent = 'יש לבחור לפחות 2 חומרים';
      return;
    }
    const keepId = Number(document.querySelector('.manual-mat-keep-radio:checked')?.value);
    const keep = mats.find((m) => m.id === keepId) || mats[0];
    const others = mats.filter((m) => m.id !== keep.id);
    const syns = buildMergedMaterialSynonyms(keep, others);
    const synText = syns.length ? syns.join(' · ') : '—';
    previewEl.innerHTML = `יעד: <strong>${escapeHtml(keep.name)}</strong>
      · מאוחדים: ${others.length}
      · מילים נרדפות אחרי איחוד: ${escapeHtml(synText)}`;
  }

  function bindList() {
    listEl.querySelectorAll('.manual-mat-merge-check').forEach((cb) => {
      cb.addEventListener('change', syncKeepRadios);
    });
    listEl.querySelectorAll('.manual-mat-keep-radio').forEach((radio) => {
      radio.addEventListener('change', updatePreview);
    });
  }

  bindList();
  syncKeepRadios();

  document.getElementById('manual-mat-merge-search')?.addEventListener('input', (e) => {
    const checked = new Set(
      [...document.querySelectorAll('.manual-mat-merge-check:checked')].map((el) => el.value),
    );
    const keepId = document.querySelector('.manual-mat-keep-radio:checked')?.value;
    listEl.innerHTML = renderOptions(e.target.value);
    listEl.querySelectorAll('.manual-mat-merge-check').forEach((cb) => {
      if (checked.has(cb.value)) cb.checked = true;
    });
    bindList();
    syncKeepRadios();
    if (keepId) {
      const radio = listEl.querySelector(`.manual-mat-keep-radio[value="${keepId}"]`);
      if (radio && !radio.disabled) radio.checked = true;
    }
    updatePreview();
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  document.getElementById('confirm-manual-mat-merge')?.addEventListener('click', async () => {
    const mats = selectedMats();
    if (mats.length < 2) {
      showToast('יש לבחור לפחות 2 חומרים');
      return;
    }
    const keepId = Number(document.querySelector('.manual-mat-keep-radio:checked')?.value);
    if (!keepId || !mats.some((m) => m.id === keepId)) {
      showToast('בחר רשומת יעד');
      return;
    }
    const mergeIds = mats.map((m) => m.id).filter((id) => id !== keepId);
    const btn = document.getElementById('confirm-manual-mat-merge');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'מאחד...';
    }
    try {
      await mergeSelectedRawMaterials(keepId, mergeIds);
      closeModal();
      showToast('חומרים אוחדו ✓');
      requestAutoBackupNow().catch(() => {});
      renderSuppliers(container);
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'אחד חומרים';
      }
      showToast(err.message || 'שגיאה באיחוד');
    }
  });
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
      <div class="merge-dup-groups">
        ${renderMergeDupGroupsHTML(groups, supMap)}
      </div>`,
    footerHTML: `
      <button type="button" class="btn btn-secondary" id="merge-dup-all">אחד את כל הקבוצות</button>
      <button class="btn btn-secondary modal-cancel">סגור</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', () => {
    closeModal();
    renderSuppliers(container);
  });

  const host = document.querySelector('.merge-dup-groups');
  if (host) {
    host.dataset.groupsJson = JSON.stringify(groups.map((g) => ({
      materials: g.materials.map((m) => m.id),
    })));
  }
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
            : sup.materials.filter((m) => materialMatchesSearch(m, search));
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

function renderBrowseResultsHTML(filtered, search, expandedIds, hasData) {
  if (!hasData) {
    return `
    <div class="empty-state">
      <div class="empty-state-icon">🚚</div>
      <p>אין ספקים עדיין</p>
      <button type="button" class="btn btn-primary btn-sm" id="browse-go-edit">עבור לעריכה</button>
    </div>`;
  }
  return `${filtered.categories.map((cat) => renderBrowseCategoryBlock(cat, { search, expandedIds })).join('')}
    ${search && !filtered.categories.length
    ? '<p class="form-hint" style="text-align:center;padding:16px">לא נמצאו תוצאות</p>' : ''}`;
}

function bindBrowseResultsHandlers(body, container) {
  const expandedIds = new Set(
    JSON.parse(container.dataset.browseExpanded || '[]').map(Number).filter(Boolean),
  );

  document.getElementById('browse-go-edit')?.addEventListener('click', () => switchSupplierTab('edit'));

  body.querySelectorAll('#browse-results .browse-material-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      openMaterialDetailModal(container, Number(row.dataset.materialId));
    });
  });

  body.querySelectorAll('#browse-results .category-toggle-browse').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.supplier-browse-cat')?.classList.toggle('is-collapsed');
    });
  });

  body.querySelectorAll('#browse-results .supplier-toggle-browse').forEach((btn) => {
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

function updateBrowseResults(body, container) {
  const layout = container._browseLayout;
  if (!layout) return;
  const search = (container.dataset.browseSearch || '').trim().toLocaleLowerCase('he');
  const filtered = filterBrowseLayout(layout, search);
  const expandedIds = new Set(
    JSON.parse(container.dataset.browseExpanded || '[]').map(Number).filter(Boolean),
  );
  const hasData = layout.categories.some((c) => c.suppliers.length);
  const resultsEl = body.querySelector('#browse-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = renderBrowseResultsHTML(filtered, search, expandedIds, hasData);
  bindBrowseResultsHandlers(body, container);
}

async function renderBrowseTab(body, container) {
  const layout = await getSuppliersBrowseLayout();
  container._browseLayout = layout;
  const search = (container.dataset.browseSearch || '').trim().toLocaleLowerCase('he');
  const filtered = filterBrowseLayout(layout, search);
  const expandedIds = new Set(
    JSON.parse(container.dataset.browseExpanded || '[]').map(Number).filter(Boolean),
  );
  const hasData = layout.categories.some((c) => c.suppliers.length);

  body.innerHTML = `
    <div class="card supplier-browse-intro">
      <div class="card-title">ספקים ותמחור</div>
      <p class="form-hint" style="margin:0 0 10px">לחץ על ספק לפתיחה · לחץ על חומר גלם לצפייה בהיסטוריית מחירים · <span class="browse-legend-active">ירוק = פעיל במתכונים</span> · <span class="browse-legend-inactive">אדום = לא במתכונים</span></p>
      ${hasData ? `
      <div class="form-group" style="margin:0">
        <input type="search" id="browse-search" class="catalog-search-input"
          placeholder="חיפוש ספק או חומר גלם..." value="${escapeHtml(container.dataset.browseSearch || '')}">
      </div>` : ''}
    </div>
    <div id="browse-results">${renderBrowseResultsHTML(filtered, search, expandedIds, hasData)}</div>`;

  document.getElementById('browse-search')?.addEventListener('input', (e) => {
    container.dataset.browseSearch = e.target.value;
    updateBrowseResults(body, container);
  });

  bindBrowseResultsHandlers(body, container);
}

function renderBrowseCategoryBlock(cat, { search, expandedIds } = {}) {
  if (!cat.suppliers.length) return '';
  const matCount = cat.suppliers.reduce((n, s) => n + s.materials.length, 0);
  const isPackaging = isPackagingSupplierCategory(cat);
  return `
    <div class="card supplier-browse-cat">
      <button type="button" class="supplier-browse-cat-header category-toggle-browse">
        <span class="supplier-browse-cat-name">${isPackaging ? '📦 ' : ''}${escapeHtml(cat.name)}</span>
        <span class="supplier-browse-cat-meta">${cat.suppliers.length} ספקים · ${matCount} ${isPackaging ? 'אריזות' : 'חומרים'}</span>
      </button>
      <div class="supplier-browse-cat-body">
        ${cat.suppliers.map((s) => renderBrowseSupplierBlock(s, { search, expandedIds, isPackaging })).join('')}
      </div>
    </div>`;
}

function renderBrowseMaterialRow(m, { forceActive = false } = {}) {
  const isActive = forceActive || m.active === true;
  const rowClass = isActive ? 'browse-material-row--active' : 'browse-material-row--inactive';
  const defaultBadge = m.isRecipeDefault
    ? ' <span class="recipe-default-badge" title="ברירת מחדל למתכונים">★</span>'
    : '';
  const packMeta = renderPackagingMetaLine(m).replace(/^\s·\s*/, '');
  return `
        <button type="button" class="browse-material-row ${rowClass}" data-material-id="${m.id}">
          <span class="browse-mat-main">
            <span class="browse-mat-name">${escapeHtml(m.name)}${defaultBadge}</span>
            <span class="browse-mat-price">${formatMaterialPriceMeta(m)}</span>
            ${packMeta ? `<span class="browse-mat-pack">${packMeta}</span>` : ''}
          </span>
        </button>`;
}

function renderBrowseSupplierMaterialsHTML(materials, { isPackaging = false } = {}) {
  if (isPackaging) {
    if (!materials.length) return '';
    return `
      <div class="browse-mats-section browse-mats-section--active">
        <div class="browse-mats-section-label">אריזות (${materials.length})</div>
        ${materials.map((m) => renderBrowseMaterialRow(m, { forceActive: true })).join('')}
      </div>`;
  }
  const activeMats = materials.filter((m) => m.active === true);
  const inactiveMats = materials.filter((m) => m.active !== true);
  const sections = [];

  if (activeMats.length) {
    sections.push(`
      <div class="browse-mats-section browse-mats-section--active">
        <div class="browse-mats-section-label">פעילים — במתכונים (${activeMats.length})</div>
        ${activeMats.map((m) => renderBrowseMaterialRow(m)).join('')}
      </div>`);
  }
  if (inactiveMats.length) {
    if (activeMats.length) {
      sections.push('<div class="browse-mats-divider" role="separator" aria-hidden="true"></div>');
    }
    sections.push(`
      <div class="browse-mats-section browse-mats-section--inactive">
        <div class="browse-mats-section-label">לא פעילים — לא במתכונים (${inactiveMats.length})</div>
        ${inactiveMats.map((m) => renderBrowseMaterialRow(m)).join('')}
      </div>`);
  }
  return sections.join('');
}

function renderBrowseSupplierBlock(supplier, { search, expandedIds, isPackaging = false } = {}) {
  const expanded = supplier.autoExpand || expandedIds.has(supplier.id);
  const collapsedClass = expanded ? '' : ' is-collapsed';
  const activeCount = supplier.materials.filter((m) => m.active === true).length;
  const inactiveCount = supplier.materials.length - activeCount;
  const metaParts = [];
  if (isPackaging) {
    metaParts.push(`${supplier.materials.length} אריזות`);
  } else {
    if (activeCount) metaParts.push(`${activeCount} פעילים`);
    if (inactiveCount) metaParts.push(`${inactiveCount} לא פעילים`);
  }
  const metaText = metaParts.length ? metaParts.join(' · ') : '0 חומרים';
  return `
    <section class="supplier-browse-block${collapsedClass}" data-supplier-id="${supplier.id}">
      <button type="button" class="supplier-browse-sup-header supplier-toggle-browse">
        <span class="supplier-browse-sup-name">${escapeHtml(supplier.name)}</span>
        <span class="supplier-browse-sup-meta">${metaText}</span>
      </button>
      ${supplier.materials.length
    ? `<div class="supplier-browse-mats">
        ${renderBrowseSupplierMaterialsHTML(supplier.materials, { isPackaging })}
      </div>`
    : `<p class="form-hint supplier-browse-empty">${isPackaging ? 'אין אריזות' : 'אין חומרי גלם'}</p>`}
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
      ${renderMaterialPricingDetailsHTML(mat)}
      <div class="material-detail-meta">
        ${mat.supplierId ? `<span class="form-hint">ספק: ${escapeHtml(supMap.get(mat.supplierId) || '')}</span>` : ''}
        ${mat.unit ? `<span class="form-hint">יחידת רכישה: ${escapeHtml(mat.unit)}</span>` : ''}
        ${mat.isRecipeDefault ? '<span class="recipe-default-badge">★ ברירת מחדל למתכונים</span>' : ''}
        ${mat.isPortion ? `<span class="recipe-default-badge">מנה · ${mat.portionWeightKg != null ? `${mat.portionWeightKg} ק"ג` : ''}</span>` : ''}
        ${mat.packagingKind ? `<span class="form-hint">${escapeHtml(getPackagingKindLabel(mat.packagingKind))}${mat.packUnitsCount > 1 ? ` · ${mat.packUnitsCount} בחבילה` : ''}${mat.packagingKind === PACKAGING_KIND_CARTON && mat.packProductsPerUnit ? ` · ${mat.packProductsPerUnit} מוצרים/קרטון` : ''}</span>` : ''}
        ${computePackagingCostPerProduct(mat) != null ? `<span class="form-hint packaging-cost-hint">עלות אריזה למוצר: <strong>${formatMoney(computePackagingCostPerProduct(mat))}</strong></span>` : ''}
      </div>
      <div class="form-group" style="margin-top:12px">
        <button type="button" class="btn ${mat.isRecipeDefault ? 'btn-primary' : 'btn-secondary'} btn-sm" id="mat-detail-recipe-default" style="width:100%">
          ${mat.isRecipeDefault ? '★ ברירת מחדל למתכונים — לחץ לביטול' : '★ סמן כברירת מחדל למתכונים'}
        </button>
        <p class="form-hint">כשמסומן — ההצעה והמחיר יופיעו אוטומטית בכל המתכונים עם החומר הזה</p>
      </div>
      ${mat.isPortion ? `
      <div class="form-group" style="margin-top:8px">
        <p class="form-hint" style="margin:0">מסומן כמנה — ערוך שיוך למוצר ומשקל בטופס העריכה</p>
      </div>` : ''}
      ${others.length ? `
      <div class="material-detail-others">
        <h4 class="material-detail-subtitle">אותו מוצר אצל ספקים נוספים</h4>
        <ul class="material-others-list">
          ${others.map((m) => `
          <li>
            <button type="button" class="link-btn browse-other-sup" data-id="${m.id}">
              ${escapeHtml(supMap.get(m.supplierId) || 'ללא ספק')} — ${formatMaterialPriceMeta(m)}
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
  document.getElementById('mat-detail-recipe-default')?.addEventListener('click', async () => {
    try {
      await setRawMaterialRecipeDefault(mat.id, !mat.isRecipeDefault);
      showToast(mat.isRecipeDefault ? 'בוטלה ברירת המחדל' : 'סומן כברירת מחדל למתכונים ✓');
      requestAutoBackupNow().catch(() => {});
      closeModal();
      await renderSuppliers(container);
      openMaterialDetailModal(container, mat.id);
    } catch (e) {
      showToast(e.message || 'שגיאה');
    }
  });
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
    openSupplierCategoryForm(container, null);
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

  const selectedCategory = categories.find((c) => String(c.id) === String(selectedMatCat));
  const isPackagingCat = isPackagingSupplierCategory(selectedCategory);
  const matSearch = container.dataset.editMatSearch || '';
  const filteredMaterials = filterEditMaterials(materials, matSearch, supMap);

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
            data-mat-cat="${c.id}">${renderSupplierCategoryChipLabel(c)}</button>`).join('')}
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <input type="search" id="edit-mat-search" class="edit-mat-search-input"
          placeholder="חיפוש לפי שם / מילה נרדפת / ספק..."
          value="${escapeHtml(matSearch)}" autocomplete="off">
      </div>
      <div class="filter-row" style="margin-bottom:12px">
        <div class="form-hint" style="margin:0;flex:1" id="edit-mat-list-hint">
          ${escapeHtml(catMap.get(Number(selectedMatCat)) || 'בחר קטגוריה')}
          ${isPackagingCat ? ' · קטגוריית אריזות' : ''}
          <span id="edit-mat-search-count">${matSearch.trim() ? ` · ${filteredMaterials.length} מתוך ${materials.length}` : ''}</span>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="edit-mat-cat-settings" title="הגדרות קטגוריה">⚙️</button>
        <button type="button" class="btn btn-primary btn-sm" id="add-material">+ ${isPackagingCat ? 'אריזה' : 'חומר'}</button>
      </div>
      <div id="edit-mat-results">
        ${renderEditMaterialsListHTML(filteredMaterials, materials, supMap, selectedMatCat)}
      </div>
    </div>`;

  host._editMatState = { materials, filteredMaterials, selectedMatCat, supMap };

  host.querySelectorAll('[data-mat-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.matCat = btn.dataset.matCat;
      renderEditSections(host, container, categories, btn.dataset.matCat);
    });
  });

  document.getElementById('edit-mat-search')?.addEventListener('input', (e) => {
    container.dataset.editMatSearch = e.target.value;
    updateEditMaterialsResults(host, container);
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

  document.getElementById('edit-mat-cat-settings')?.addEventListener('click', () => {
    if (selectedCategory) openSupplierCategoryForm(container, selectedCategory);
  });

  document.getElementById('add-material')?.addEventListener('click', async () => {
    openAddMaterialModal(container, Number(selectedMatCat), await getSuppliers(), selectedCategory);
  });

  bindEditMaterialListHandlers(host, container, materials, selectedMatCat);

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

function filterEditMaterials(materials, search, supMap) {
  const q = String(search || '').trim();
  if (!q) return materials;
  return materials.filter((m) => materialMatchesSearch(m, q, {
    supplierName: m.supplierId ? (supMap.get(m.supplierId) || '') : '',
  }));
}

function renderEditMaterialsListHTML(filtered, allMaterials, supMap, selectedMatCat) {
  if (!allMaterials.length) {
    return '<p class="form-hint">אין חומרים — ייבא מ-Excel או הוסף ידנית</p>';
  }
  if (!filtered.length) {
    return '<p class="form-hint">אין תוצאות לחיפוש</p>';
  }
  const searching = filtered.length !== allMaterials.length;
  return `<div class="material-list" data-cat-id="${selectedMatCat}">
    ${filtered.map((m, i) => {
    const orderIdx = allMaterials.findIndex((x) => x.id === m.id);
    return `
      <div class="list-item material-list-item" data-material-id="${m.id}">
        <button type="button" class="material-drag-handle" aria-label="גרור"${searching ? ' disabled title="גרור ללא חיפוש"' : ''}>☰</button>
        <span class="material-order-num">${(orderIdx >= 0 ? orderIdx : i) + 1}</span>
        <button type="button" class="list-item-info edit-mat-open" data-id="${m.id}" style="flex:1;border:none;background:none;text-align:right;padding:0;cursor:pointer;min-width:0">
          <div class="list-item-name">${escapeHtml(m.name)}${m.isRecipeDefault ? ' <span class="recipe-default-badge">★ ברירת מחדל</span>' : ''}</div>
          <div class="list-item-meta">
            ${formatMaterialPriceMeta(m)}
            ${m.supplierId ? ` · ${escapeHtml(supMap.get(m.supplierId) || '')}` : ''}
          </div>
          ${m.packagingKind ? `<div class="list-item-pack-meta">${renderPackagingMetaLine(m).replace(/^\s·\s*/, '')}</div>` : ''}
        </button>
        <div class="list-item-actions">
          <button type="button" class="btn btn-secondary btn-sm dup-mat-sup" data-id="${m.id}" title="הוסף אצל ספק נוסף">+ספק</button>
          <button type="button" class="btn btn-danger btn-sm del-mat" data-id="${m.id}">🗑</button>
        </div>
      </div>`;
  }).join('')}
  </div>`;
}

function updateEditMaterialsResults(host, container) {
  const state = host._editMatState;
  if (!state) return;
  const search = container.dataset.editMatSearch || '';
  const filtered = filterEditMaterials(state.materials, search, state.supMap);
  state.filteredMaterials = filtered;
  const resultsEl = host.querySelector('#edit-mat-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = renderEditMaterialsListHTML(
    filtered,
    state.materials,
    state.supMap,
    state.selectedMatCat,
  );
  const countEl = host.querySelector('#edit-mat-search-count');
  if (countEl) {
    countEl.textContent = search.trim()
      ? ` · ${filtered.length} מתוך ${state.materials.length}`
      : '';
  }
  bindEditMaterialListHandlers(host, container, state.materials, state.selectedMatCat);
}

function bindEditMaterialListHandlers(host, container, materials, selectedMatCat) {
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

  const searching = !!(container.dataset.editMatSearch || '').trim();
  if (materials.length && !searching) {
    bindMaterialDragList(host, Number(selectedMatCat), async (orderedIds) => {
      await setRawMaterialOrder(Number(selectedMatCat), orderedIds);
    });
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

function openSupplierCategoryForm(container, category) {
  const isEdit = !!category;
  openModal({
    title: isEdit ? `קטגוריה · ${escapeHtml(category.name)}` : 'קטגוריה חדשה',
    bodyHTML: `
      <div class="form-group">
        <label for="sup-cat-name">שם קטגוריה</label>
        <input type="text" id="sup-cat-name" maxlength="40" value="${category ? escapeHtml(category.name) : ''}">
      </div>
      <label class="packaging-cat-toggle">
        <input type="checkbox" id="sup-cat-packaging"${category?.isPackaging ? ' checked' : ''}>
        קטגוריה אריזות
      </label>
      <p class="form-hint">בקטגוריה אריזות: סוג (קרטון/פלסטיק), כמה אריזות בחבילה, ולקרטון — כמה מוצרים נכנסים</p>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-sup-cat">${isEdit ? 'שמור' : 'הוסף'}</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-sup-cat')?.addEventListener('click', async () => {
    const name = document.getElementById('sup-cat-name')?.value.trim();
    const isPackaging = document.getElementById('sup-cat-packaging')?.checked;
    if (!name) return showToast('הזן שם');
    try {
      if (isEdit) await updateSupplierCategory(category.id, { name, isPackaging });
      else await addSupplierCategory(name, { isPackaging });
      closeModal();
      showToast('נשמר ✓');
      renderSuppliers(container);
    } catch (e) {
      showToast(e.message || 'שגיאה');
    }
  });
}

function readPackagingFieldsFromForm() {
  const kind = document.querySelector('input[name="mat-pack-kind"]:checked')?.value || PACKAGING_KIND_CARTON;
  return {
    packagingKind: kind,
    packUnitsCount: document.getElementById('mat-pack-units')?.value,
    packProductsPerUnit: kind === PACKAGING_KIND_CARTON
      ? document.getElementById('mat-pack-products')?.value
      : null,
  };
}

function updatePackagingCostPreview() {
  const preview = document.getElementById('mat-pack-cost-preview');
  if (!preview) return;
  const price = Number(document.getElementById('mat-price')?.value) || 0;
  const material = { unitPrice: price, ...readPackagingFieldsFromForm() };
  const cost = computePackagingCostPerProduct(material);
  preview.textContent = cost != null && price > 0
    ? `עלות אריזה למוצר: ${formatMoney(cost)}`
    : '';
}

function bindPackagingFormFields() {
  const productsField = document.getElementById('mat-pack-products-field');
  const syncProductsField = () => {
    const kind = document.querySelector('input[name="mat-pack-kind"]:checked')?.value;
    if (productsField) productsField.style.display = kind === PACKAGING_KIND_PLASTIC ? 'none' : '';
    updatePackagingCostPreview();
  };
  document.querySelectorAll('input[name="mat-pack-kind"]').forEach((radio) => {
    radio.addEventListener('change', syncProductsField);
  });
  ['mat-pack-units', 'mat-pack-products', 'mat-price'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', updatePackagingCostPreview);
  });
  syncProductsField();
}

async function openAddMaterialModal(container, categoryId, suppliers, category) {
  const isPackaging = isPackagingSupplierCategory(category);
  const products = await getProducts(true);
  openModal({
    title: isPackaging ? 'אריזה חדשה' : 'חומר גלם חדש',
    bodyHTML: materialFormHTML(null, suppliers, { isPackaging, products }),
    footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-mat">שמור</button>`,
  });
  bindMaterialForm(container, categoryId, null, { isPackaging });
}

function openEditMaterialModal(container, mat) {
  Promise.all([getSuppliers(), getSupplierCategories(), getProducts(true)]).then(([suppliers, categories, products]) => {
    const category = categories.find((c) => c.id === mat.supplierCategoryId);
    const isPackaging = isPackagingSupplierCategory(category);
    openModal({
      title: `עריכה · ${escapeHtml(mat.name)}`,
      bodyHTML: `${materialFormHTML(mat, suppliers, { isPackaging, products })}
        ${isPackaging ? `
        <div class="form-group" style="margin-top:12px">
          <label>עדכון מחיר (שומר היסטוריה)</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input type="number" id="mat-new-price" min="0" step="0.01" placeholder="מחיר חדש" style="flex:1">
            <input type="date" id="mat-price-date" value="${todayISO()}" style="flex:1">
          </div>
        </div>` : `
        <div class="form-group" style="margin-top:12px">
          <label>עדכון מחיר (שומר היסטוריה)</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input type="number" id="mat-new-price-per-kg" min="0" step="0.01" placeholder="מחיר לקילו חדש" style="flex:1">
            <input type="date" id="mat-price-date" value="${todayISO()}" style="flex:1">
          </div>
          <p class="form-hint">מחושב למחיר אריזה לפי כמות באריזה בטופס</p>
        </div>`}
        <div id="mat-history-host"></div>`,
      footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-mat">שמור</button>`,
    });
    bindMaterialForm(container, mat.supplierCategoryId, mat.id, {
      isPackaging,
      synonyms: getMaterialSynonyms(mat),
    });
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

function materialFormHTML(mat, suppliers, { isPackaging = false, products = [] } = {}) {
  const defaultUnit = isPackaging ? 'חבילה' : 'ק&quot;ג';
  const packKind = mat?.packagingKind || PACKAGING_KIND_CARTON;
  const pricePerKg = mat ? (getMaterialPurchasePricePerKg(mat) ?? '') : '';
  const packageWeightKg = mat ? (packageWeightKgFromGrams(mat.packageWeightGrams) ?? '') : '';
  const isPortion = !!mat?.isPortion;
  const portionProductId = mat?.portionProductId ? Number(mat.portionProductId) : '';
  const portionWeightKg = mat?.portionWeightKg != null ? mat.portionWeightKg : '';
  const productOptions = (products || [])
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'he'))
    .map((p) => `<option value="${p.id}"${portionProductId === Number(p.id) ? ' selected' : ''}>${escapeHtml(p.name)}</option>`)
    .join('');
  return `
    <div class="form-group"><label>שם</label><input type="text" id="mat-name" value="${mat ? escapeHtml(mat.name) : ''}"></div>
    <div class="form-group mat-synonyms-group">
      <label>מילים נרדפות</label>
      <div class="mat-synonyms-add-row">
        <input type="text" id="mat-synonym-input" placeholder="הוסף מילה נרדפת..." autocomplete="off">
        <button type="button" class="btn btn-secondary btn-sm mat-synonym-add-btn" id="mat-synonym-add" title="הוסף מילה נרדפת">+</button>
      </div>
      <ul class="mat-synonyms-list" id="mat-synonyms-list"></ul>
      <p class="form-hint">חיפוש לפי מילה נרדפת ימצא את החומר גלם</p>
    </div>
    ${isPackaging ? `
    <div class="form-group"><label>יחידה</label><input type="text" id="mat-unit" value="${mat ? escapeHtml(mat.unit) : defaultUnit}"></div>
    <div class="form-group"><label>מחיר לחבילה (₪)</label><input type="number" id="mat-price" min="0" step="0.01" value="${mat?.unitPrice ?? ''}"></div>
    <div class="form-group">
      <label>סוג אריזה</label>
      <div class="packaging-kind-row" role="radiogroup">
        <label class="packaging-kind-option"><input type="radio" name="mat-pack-kind" value="${PACKAGING_KIND_CARTON}"${packKind === PACKAGING_KIND_CARTON ? ' checked' : ''}> קרטון</label>
        <label class="packaging-kind-option"><input type="radio" name="mat-pack-kind" value="${PACKAGING_KIND_PLASTIC}"${packKind === PACKAGING_KIND_PLASTIC ? ' checked' : ''}> פלסטיק</label>
      </div>
    </div>
    <div class="form-group">
      <label>אריזות בחבילה</label>
      <input type="number" id="mat-pack-units" min="1" step="1" value="${mat?.packUnitsCount ?? 1}" placeholder="כמה יחידות בכל רכישה">
    </div>
    <div class="form-group" id="mat-pack-products-field">
      <label>מוצרים בקרטון</label>
      <input type="number" id="mat-pack-products" min="1" step="1" value="${mat?.packProductsPerUnit ?? 1}" placeholder="כמה מוצרים נכנסים בקרטון">
    </div>
    <p class="form-hint mat-pack-cost-preview" id="mat-pack-cost-preview"></p>` : `
    <div class="form-group"><label>מחיר לקילו (₪)</label><input type="number" id="mat-price-per-kg" min="0" step="0.01" value="${pricePerKg !== '' ? pricePerKg : ''}"></div>
    <div class="form-group"><label>כמות באריזה (ק&quot;ג)</label><input type="number" id="mat-package-qty" min="0" step="0.001" value="${packageWeightKg !== '' ? packageWeightKg : ''}" placeholder="למשל: 1"></div>
    <p class="form-hint" id="mat-package-price-preview"></p>
    <div class="form-group"><label>מחיר לאחר עיבוד (₪/ק&quot;ג)</label><input type="number" id="mat-processed-price" min="0" step="0.01" value="${mat?.processedPricePerKg ?? ''}" placeholder="אופציונלי">
      <p class="form-hint">אם מולא — במתכונים יחושב לפי מחיר זה במקום מחיר הרכישה</p>
    </div>
    <div class="form-group"><label>יחידת רכישה</label><input type="text" id="mat-unit" value="${mat ? escapeHtml(mat.unit) : defaultUnit}"></div>`}
    <div class="form-group"><label>ספק</label>
      <select id="mat-supplier"><option value="">—</option>
        ${suppliers.map((s) => `<option value="${s.id}"${mat?.supplierId === s.id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="checkbox-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="mat-as-portion"${isPortion ? ' checked' : ''}>
        <span>סמן כמנה</span>
      </label>
      <p class="form-hint">החומר יופיע כמנה בתזרים של המוצר המשויך</p>
    </div>
    <div id="mat-portion-fields" style="${isPortion ? '' : 'display:none'}">
      <div class="form-group">
        <label for="mat-portion-product">שיוך למוצר</label>
        <select id="mat-portion-product">
          <option value="">בחר מוצר...</option>
          ${productOptions}
        </select>
      </div>
      <div class="form-group">
        <label for="mat-portion-weight">משקל מנה (ק&quot;ג)</label>
        <input type="number" id="mat-portion-weight" min="0.001" step="0.001" inputmode="decimal"
          value="${portionWeightKg !== '' ? portionWeightKg : ''}" placeholder="למשל: 0.12">
      </div>
    </div>
    ${mat ? `
    <div class="form-group">
      <label class="checkbox-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="mat-recipe-default"${mat.isRecipeDefault ? ' checked' : ''}>
        <span>ברירת מחדל למתכונים</span>
      </label>
      <p class="form-hint">כשמסומן — ההצעה והמחיר יופיעו אוטומטית בכל המתכונים עם החומר הזה (רק הצעה אחת לשם חומר)</p>
    </div>` : ''}`;
}

function readMaterialSynonymsFromForm() {
  const list = document.getElementById('mat-synonyms-list');
  if (!list) return [];
  try {
    return sanitizeMaterialSynonyms(JSON.parse(list.dataset.synonyms || '[]'));
  } catch {
    return [];
  }
}

function renderMaterialSynonymsList() {
  const list = document.getElementById('mat-synonyms-list');
  if (!list) return;
  const synonyms = readMaterialSynonymsFromForm();
  list.dataset.synonyms = JSON.stringify(synonyms);
  if (!synonyms.length) {
    list.innerHTML = '<li class="mat-synonyms-empty form-hint">אין מילים נרדפות עדיין</li>';
    return;
  }
  list.innerHTML = synonyms.map((s, index) => `
    <li class="mat-synonym-item">
      <button type="button" class="mat-synonym-chip" data-index="${index}" title="הסר">
        <span class="mat-synonym-chip-text">${escapeHtml(s)}</span>
        <span class="mat-synonym-chip-x" aria-hidden="true">×</span>
      </button>
    </li>`).join('');
}

function bindMaterialSynonymsUI(initialSynonyms = []) {
  const list = document.getElementById('mat-synonyms-list');
  const input = document.getElementById('mat-synonym-input');
  const addBtn = document.getElementById('mat-synonym-add');
  if (!list || !input || !addBtn) return;

  list.dataset.synonyms = JSON.stringify(sanitizeMaterialSynonyms(initialSynonyms));
  renderMaterialSynonymsList();

  const addSynonym = () => {
    const next = String(input.value || '').trim();
    if (!next) return;
    const synonyms = readMaterialSynonymsFromForm();
    const key = next.toLocaleLowerCase('he');
    if (synonyms.some((s) => s.toLocaleLowerCase('he') === key)) {
      showToast('המילה כבר ברשימה');
      return;
    }
    synonyms.push(next);
    list.dataset.synonyms = JSON.stringify(sanitizeMaterialSynonyms(synonyms));
    input.value = '';
    renderMaterialSynonymsList();
    input.focus();
  };

  addBtn.addEventListener('click', addSynonym);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSynonym();
    }
  });
  list.addEventListener('click', (e) => {
    const chip = e.target.closest('.mat-synonym-chip');
    if (!chip) return;
    const index = Number(chip.dataset.index);
    const synonyms = readMaterialSynonymsFromForm();
    if (index < 0 || index >= synonyms.length) return;
    synonyms.splice(index, 1);
    list.dataset.synonyms = JSON.stringify(synonyms);
    renderMaterialSynonymsList();
  });
}

function bindMaterialForm(container, categoryId, materialId, { isPackaging = false, synonyms = [] } = {}) {
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  if (isPackaging) bindPackagingFormFields();
  else bindMaterialPricePreviewFields();
  bindMaterialSynonymsUI(synonyms);

  const portionCb = document.getElementById('mat-as-portion');
  const portionFields = document.getElementById('mat-portion-fields');
  const syncPortionFields = () => {
    if (portionFields) portionFields.style.display = portionCb?.checked ? '' : 'none';
  };
  portionCb?.addEventListener('change', syncPortionFields);
  syncPortionFields();

  document.getElementById('save-mat')?.addEventListener('click', async () => {
    try {
      const pricing = isPackaging
        ? { unitPrice: document.getElementById('mat-price')?.value, packageWeightGrams: null }
        : readMaterialPricingFromForm();
      const payload = {
        name: document.getElementById('mat-name')?.value,
        unit: document.getElementById('mat-unit')?.value,
        supplierId: document.getElementById('mat-supplier')?.value || null,
        packageWeightGrams: isPackaging ? null : pricing.packageWeightGrams,
        processedPricePerKg: isPackaging ? null : document.getElementById('mat-processed-price')?.value,
        synonyms: readMaterialSynonymsFromForm(),
        ...(isPackaging ? readPackagingFieldsFromForm() : {}),
      };
      const portionEnabled = !!document.getElementById('mat-as-portion')?.checked;
      const portionProductId = document.getElementById('mat-portion-product')?.value || null;
      const portionWeightKg = document.getElementById('mat-portion-weight')?.value;

      let savedId = materialId;
      if (materialId) {
        await updateRawMaterial(materialId, payload);
        const recipeDefaultEl = document.getElementById('mat-recipe-default');
        if (recipeDefaultEl) {
          await setRawMaterialRecipeDefault(materialId, !!recipeDefaultEl.checked);
        }
        const newPricePerKg = document.getElementById('mat-new-price-per-kg')?.value;
        const priceDate = document.getElementById('mat-price-date')?.value;
        if (!isPackaging && newPricePerKg !== '' && newPricePerKg != null) {
          const historyPricing = rawMaterialPricingFromPerKg({
            pricePerKg: newPricePerKg,
            packageWeightKg: document.getElementById('mat-package-qty')?.value,
          });
          await setRawMaterialPrice(materialId, historyPricing.unitPrice, priceDate || todayISO());
        } else if (!isPackaging) {
          const current = await getRawMaterials();
          const m = current.find((x) => x.id === materialId);
          if (m && pricing.unitPrice !== '' && Number(pricing.unitPrice) !== Number(m.unitPrice)) {
            await setRawMaterialPrice(materialId, pricing.unitPrice, todayISO());
          }
        } else {
          const newPrice = document.getElementById('mat-price')?.value;
          const priceDate = document.getElementById('mat-price-date')?.value;
          if (newPrice !== '' && newPrice != null) {
            await setRawMaterialPrice(materialId, newPrice, priceDate || todayISO());
          }
        }
      } else {
        savedId = await addRawMaterial({
          supplierCategoryId: categoryId,
          ...payload,
          unitPrice: isPackaging
            ? document.getElementById('mat-price')?.value
            : pricing.unitPrice,
        });
      }

      await setRawMaterialAsPortion(savedId, {
        enabled: portionEnabled,
        productId: portionProductId,
        weightKg: portionWeightKg,
      });

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
        <div class="form-group"><label>מחיר לקילו (₪)</label><input type="number" id="dup-price-per-kg" min="0" step="0.01" value="${getMaterialPurchasePricePerKg(mat) ?? ''}"></div>
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
          packageWeightGrams: mat.packageWeightGrams,
          processedPricePerKg: mat.processedPricePerKg,
          packagingKind: mat.packagingKind,
          packUnitsCount: mat.packUnitsCount,
          packProductsPerUnit: mat.packProductsPerUnit,
          synonyms: getMaterialSynonyms(mat),
        });
        const pricePerKg = document.getElementById('dup-price-per-kg')?.value;
        if (pricePerKg !== '') {
          const pricing = rawMaterialPricingFromPerKg({
            pricePerKg,
            packageWeightKg: packageWeightKgFromGrams(mat.packageWeightGrams),
          });
          await setRawMaterialPrice(mid, pricing.unitPrice, document.getElementById('dup-date')?.value || todayISO());
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

/* ── חוסרים ── */

async function renderShortagesTab(body, container) {
  const [grouped, suppliers, materials] = await Promise.all([
    getSupplierShortagesGrouped(),
    getSuppliers(),
    getRawMaterials(),
  ]);
  const supMap = new Map(suppliers.map((s) => [s.id, s.name]));
  const totalItems = grouped.reduce((n, g) => n + g.items.length, 0);
  const openItems = grouped.reduce((n, g) => n + g.items.filter((i) => !i.done).length, 0);
  const waText = formatSupplierShortagesText(grouped);

  const materialOptions = materials
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'he'))
    .map((m) => {
      const supName = m.supplierId ? supMap.get(m.supplierId) : '';
      const suffix = supName ? ` · ${supName}` : '';
      return `<option value="${m.id}" data-unit="${escapeHtml(m.unit || '')}">${escapeHtml(m.name)}${escapeHtml(suffix)}</option>`;
    })
    .join('');

  body.innerHTML = `
    <div class="card">
      <div class="card-title">הוסף חוסר</div>
      <div class="form-group">
        <label for="shortage-supplier">ספק</label>
        <select id="shortage-supplier">
          <option value="">בחר ספק...</option>
          ${suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label for="shortage-material">חומר מהמחסן (אופציונלי)</label>
        <select id="shortage-material">
          <option value="">— הזן שם ידנית למטה —</option>
          ${materialOptions}
        </select>
      </div>
      <div class="form-group">
        <label for="shortage-name">שם חומר (אם לא נבחר מהמחסן)</label>
        <input type="text" id="shortage-name" placeholder="למשל: קמח מספר 1">
      </div>
      <div class="filter-row">
        <div class="form-group" style="flex:1;margin-bottom:0">
          <label for="shortage-qty">כמות להזמנה</label>
          <input type="number" id="shortage-qty" min="0.001" step="0.001" inputmode="decimal" placeholder="אופציונלי">
        </div>
        <div class="form-group" style="flex:1;margin-bottom:0">
          <label for="shortage-unit">יחידה</label>
          <input type="text" id="shortage-unit" placeholder="ק&quot;ג, יח', ...">
        </div>
      </div>
      <div class="form-group">
        <label for="shortage-notes">הערה (אופציונלי)</label>
        <input type="text" id="shortage-notes" placeholder="למשל: דחוף / מותג מסוים">
      </div>
      <button type="button" class="btn btn-primary btn-sm" id="shortage-add-btn" style="width:100%">+ הוסף לרשימה</button>
    </div>

    <div class="card">
      <div class="card-title">רשימת חוסרים (${openItems} פתוחים · ${totalItems} סה"כ)</div>
      ${grouped.length === 0
    ? '<p class="form-hint">אין חוסרים — הוסף למעלה</p>'
    : grouped.map(({ supplier, items }) => `
        <div class="shortage-supplier-block order-category-block">
          <h3 class="order-category-title shortage-supplier-title">${escapeHtml(supplier?.name || 'ספק')}</h3>
          <ul class="shortage-items-list">
            ${items.map((item) => `
              <li class="shortage-item${item.done ? ' is-done' : ''}" data-id="${item.id}">
                <label class="shortage-item-check">
                  <input type="checkbox" class="shortage-done-cb" data-id="${item.id}" ${item.done ? 'checked' : ''}>
                </label>
                <div class="shortage-item-body">
                  <strong class="shortage-item-name">${escapeHtml(item.displayName)}</strong>
                  ${item.notes ? `<span class="shortage-item-notes">${escapeHtml(item.notes)}</span>` : ''}
                </div>
                <label class="shortage-qty-edit">
                  <input type="number" class="shortage-qty-input" data-id="${item.id}" min="0.001" step="0.001" inputmode="decimal"
                    value="${item.orderQuantity ?? ''}" placeholder="כמות" aria-label="כמות הזמנה">
                  <input type="text" class="shortage-unit-input" data-id="${item.id}" value="${escapeHtml(item.unit || '')}" placeholder="יח'" aria-label="יחידה">
                </label>
                <button type="button" class="btn btn-danger btn-sm btn-icon shortage-del-btn" data-id="${item.id}" title="הסר">🗑</button>
              </li>`).join('')}
          </ul>
        </div>`).join('')}
      <textarea id="shortage-wa-text" class="wa-order-text" rows="8" readonly style="margin-top:12px">${escapeHtml(waText)}</textarea>
      <div class="filter-row" style="margin-top:8px">
        <button type="button" class="btn btn-primary btn-sm" id="copy-shortage-wa" style="flex:1">📋 העתק לוואטסאפ</button>
        <button type="button" class="btn btn-secondary btn-sm" id="clear-done-shortages">נקה שהושלמו</button>
      </div>
    </div>`;

  document.getElementById('shortage-material')?.addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    const unit = opt?.dataset?.unit || '';
    if (unit) document.getElementById('shortage-unit').value = unit;
    if (opt?.value) document.getElementById('shortage-name').value = '';
  });

  document.getElementById('shortage-add-btn')?.addEventListener('click', async () => {
    const supplierId = document.getElementById('shortage-supplier')?.value;
    const rawMaterialId = document.getElementById('shortage-material')?.value || null;
    const name = document.getElementById('shortage-name')?.value?.trim();
    const orderQuantity = document.getElementById('shortage-qty')?.value;
    const unit = document.getElementById('shortage-unit')?.value?.trim();
    const notes = document.getElementById('shortage-notes')?.value?.trim();
    try {
      await addSupplierShortage({
        supplierId, rawMaterialId, name, orderQuantity, unit, notes,
      });
      requestAutoBackupNow().catch(() => {});
      showToast('נוסף ✓');
      renderSuppliers(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  body.querySelectorAll('.shortage-done-cb').forEach((cb) => {
    cb.addEventListener('change', async () => {
      try {
        await updateSupplierShortage(cb.dataset.id, { done: cb.checked });
        requestAutoBackupNow().catch(() => {});
        renderSuppliers(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  const saveShortageField = async (id, patch) => {
    try {
      await updateSupplierShortage(id, patch);
      requestAutoBackupNow().catch(() => {});
      showToast('עודכן ✓');
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  };

  body.querySelectorAll('.shortage-qty-input').forEach((input) => {
    input.addEventListener('change', () => saveShortageField(input.dataset.id, { orderQuantity: input.value }));
  });
  body.querySelectorAll('.shortage-unit-input').forEach((input) => {
    input.addEventListener('change', () => saveShortageField(input.dataset.id, { unit: input.value }));
  });

  body.querySelectorAll('.shortage-del-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('להסיר מהרשימה?')) return;
      try {
        await deleteSupplierShortage(btn.dataset.id);
        requestAutoBackupNow().catch(() => {});
        showToast('נמחק');
        renderSuppliers(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.getElementById('copy-shortage-wa')?.addEventListener('click', async () => {
    const ta = document.getElementById('shortage-wa-text');
    try {
      await navigator.clipboard.writeText(ta.value);
      showToast('הועתק ✓');
    } catch {
      ta.select();
      document.execCommand('copy');
      showToast('הועתק ✓');
    }
  });

  document.getElementById('clear-done-shortages')?.addEventListener('click', async () => {
    try {
      const n = await clearDoneSupplierShortages();
      requestAutoBackupNow().catch(() => {});
      showToast(n ? `${n} הוסרו ✓` : 'אין פריטים שהושלמו');
      renderSuppliers(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
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
