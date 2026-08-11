import {
  getProductsCatalogLayout, getCategories, getCategoryGroups, addCategory, updateCategory, deleteCategory,
  addCategoryGroup, updateCategoryGroup, deleteCategoryGroup, setCategoriesInGroup,
  addProduct, updateProduct, toggleProductActive, getProduct, resetAllData,
  importCatalogRows, importProductionRows, setProductOrderInCategory, setCategoryOrderInContainer, setCategoryGroupOrder, setCategoryUnitPrice,
  findDuplicateProductGroups, mergeProducts, mergeAllDuplicateProducts,
  getProductsWithEntryStats, mergeSelectedProducts,
  getLinkedFlowsForProduct, getCandidateFlowsForProduct, setProductFlowLinks,
  getPortionPresetsForProduct,
} from '../db.js?v=458';
import {
  getProductDetail,
  buildProductProfileCompleteness,
  PRODUCT_ALLERGENS,
  PRODUCT_STORAGE_CONDITIONS,
  PRODUCT_SHELF_LIFE_UNITS,
  productAllergenLabel,
  productStorageConditionLabel,
  sanitizeProductAllergenIds,
  sanitizeProductAllergensMode,
  resolveProductShelfLifeFields,
  resolveProductStorageConditionId,
  formatProductShelfLife,
  addProductRecipeComponent,
  updateProductRecipeComponent, deleteProductRecipeComponent,
  addProductPortionComponent,
  updateProductPortionComponent, deleteProductPortionComponent,
  getRecipesCatalogLayout, getBakingProfiles, getProductBakingProfileLink,
  linkProductToBakingProfile, unlinkProductFromBakingProfile, syncProductCostFromComposition,
  syncProductCostIfRecipesMode, syncAllProductsCostFromRecipes, isProductRecipesCostSource,
  formatRecipeBakingParamsLine, resolveRecipeBaking, getRecipeOvenLabel, formatKgWeight,
  recipeTotalWeightGrams, getRawMaterials,
  getPackagingMaterials, syncProductPackagingToMaterial, computePackagingCostPerProduct,
  getPackagingKindLabel, getSuppliers,
  portionMaterialDefaultWeightGrams,
} from '../kitchen-db.js?v=458';
import { formatMoney, showToast, escapeHtml, productUnitLabel, productPriceUnitLabel, formatDecimal } from '../utils.js?v=458';
import { openModal, closeModal } from '../modal.js?v=458';
import { CATEGORY_COLOR_HEX, defaultColorForIndex } from '../chart.js?v=458';
import { bindProductDragLists, bindCategoryDragList, bindCategoryGroupDragList } from '../product-drag.js?v=458';
import { renderSheetsStatusHTML, bindSheetsStatusEvents } from '../sheets-flow.js?v=458';

const EXPANDED_CATS_KEY = 'yitzurExpandedCategories';
const EXPANDED_GROUPS_KEY = 'yitzurExpandedCategoryGroups';
const PRODUCTS_MODE_KEY = 'yitzurProductsMode';

function getProductsMode(container) {
  const fromDom = container?.dataset?.productsMode;
  if (fromDom === 'browse' || fromDom === 'build') return fromDom;
  return sessionStorage.getItem(PRODUCTS_MODE_KEY) === 'build' ? 'build' : 'browse';
}

function setProductsMode(container, mode) {
  const next = mode === 'build' ? 'build' : 'browse';
  if (container) container.dataset.productsMode = next;
  sessionStorage.setItem(PRODUCTS_MODE_KEY, next);
}

function renderProductsModeTabs(mode) {
  return `
    <div class="flow-scope-tabs products-mode-tabs" role="tablist" aria-label="עמדות מוצרים">
      <button type="button" class="flow-scope-tab products-mode-tab${mode === 'browse' ? ' active' : ''}" data-products-mode="browse" role="tab" aria-selected="${mode === 'browse' ? 'true' : 'false'}">
        📦 מוצרים מוגמרים
      </button>
      <button type="button" class="flow-scope-tab products-mode-tab${mode === 'build' ? ' active' : ''}" data-products-mode="build" role="tab" aria-selected="${mode === 'build' ? 'true' : 'false'}">
        🛠️ עריכה ובנייה
      </button>
    </div>`;
}

function loadExpandedCategories() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(EXPANDED_CATS_KEY) || '[]').map(Number));
  } catch {
    return new Set();
  }
}

let expandedCategories = loadExpandedCategories();

function loadExpandedGroups() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(EXPANDED_GROUPS_KEY) || '[]').map(Number));
  } catch {
    return new Set();
  }
}

let expandedGroups = loadExpandedGroups();

function saveExpandedGroups() {
  sessionStorage.setItem(EXPANDED_GROUPS_KEY, JSON.stringify([...expandedGroups]));
}

function toggleGroupCard(card) {
  const id = Number(card.dataset.groupId);
  if (card.classList.toggle('is-expanded')) {
    expandedGroups.add(id);
  } else {
    expandedGroups.delete(id);
  }
  saveExpandedGroups();
  const toggle = card.querySelector('.category-group-toggle');
  toggle?.setAttribute('aria-expanded', card.classList.contains('is-expanded') ? 'true' : 'false');
}

function saveExpandedCategories() {
  sessionStorage.setItem(EXPANDED_CATS_KEY, JSON.stringify([...expandedCategories]));
}

function collapseAllProductsCatalog() {
  expandedCategories = new Set();
  expandedGroups = new Set();
  saveExpandedCategories();
  saveExpandedGroups();
}

function expandAllProductsCatalog(layout) {
  expandedGroups = new Set((layout?.groups || []).map((g) => g.id));
  expandedCategories = new Set((layout?.allCategories || []).map((c) => c.id));
  saveExpandedCategories();
  saveExpandedGroups();
}

function expandCategory(categoryId) {
  expandedCategories.add(Number(categoryId));
  saveExpandedCategories();
}

function toggleCategoryCard(card) {
  const id = Number(card.dataset.categoryId);
  if (card.classList.toggle('is-expanded')) {
    expandedCategories.add(id);
  } else {
    expandedCategories.delete(id);
  }
  saveExpandedCategories();
  const toggle = card.querySelector('.category-toggle');
  toggle?.setAttribute('aria-expanded', card.classList.contains('is-expanded') ? 'true' : 'false');
}

async function toastAfterMerge(result) {
  const { runProductionAudit } = await import('../integrity.js');
  const audit = await runProductionAudit();
  const qty = result.qtyBefore ?? audit.totals.total;
  if (audit.ok) {
    showToast(`איחוד ✓ · ${qty} יח' נשמרו · בדיקת תקינות עברה`);
  } else {
    showToast(`איחוד ✓ · ${audit.issues.length} בעיות — בדוק בדוחות → בדיקת תקינות`);
  }
}

function categoryChipStyle(color) {
  const c = color || '#2563eb';
  return `background:color-mix(in srgb, ${c} 14%, white);color:${c};border:1px solid color-mix(in srgb, ${c} 28%, transparent)`;
}

function categoryColorValue(cat) {
  return cat.color || defaultColorForIndex(cat.id);
}

function renderColorPickerFields(initialColor, prefix = 'cat') {
  const presets = CATEGORY_COLOR_HEX.map((hex) =>
    `<button type="button" class="color-swatch" data-color="${hex}" style="background:${hex}" title="${hex}" aria-label="צבע ${hex}"></button>`
  ).join('');

  return `
    <div class="form-group">
      <label for="${prefix}-color">צבע בגרף</label>
      <div class="color-picker-row">
        <input type="color" id="${prefix}-color" value="${initialColor}">
        <span class="color-picker-preview" id="${prefix}-color-preview" style="background:${initialColor}"></span>
      </div>
      <div class="color-presets" id="${prefix}-color-presets">${presets}</div>
    </div>`;
}

function bindColorPickerInModal(prefix = 'cat') {
  const colorInput = document.getElementById(`${prefix}-color`);
  const preview = document.getElementById(`${prefix}-color-preview`);
  if (!colorInput) return colorInput;

  colorInput.addEventListener('input', () => {
    if (preview) preview.style.background = colorInput.value;
  });

  document.querySelectorAll(`#${prefix}-color-presets .color-swatch`).forEach((btn) => {
    btn.addEventListener('click', () => {
      colorInput.value = btn.dataset.color;
      if (preview) preview.style.background = btn.dataset.color;
    });
  });

  return colorInput;
}

function productPriceMeta(p) {
  const parts = [];
  const unitBadge = p.priceUnit === 'kg' || p.priceUnit === 'kg_units' || p.priceUnit === 'kg_with_units' ? '⚖️ ' : '';
  if (p.unitPrice > 0) {
    parts.push(`${unitBadge}ללקוח: ${formatMoney(p.unitPrice)}/${productPriceUnitLabel(p).replace('₪/', '')}`);
    if (p.priceUnit === 'kg_units') {
      parts.push('רישום: יח\'');
      if (p.unitWeightKg) parts.push(`~${p.unitWeightKg} ק"ג/יח'`);
    } else if (p.priceUnit === 'kg_with_units') {
      parts.push('רישום: ק"ג');
      if (p.unitWeightKg) parts.push(`≈${p.unitWeightKg} ק"ג/יח'`);
    }
  }
  const cost = sanitizeListMoney(p.rawMaterialsCost)
    + sanitizeListMoney(p.packagingCost)
    + sanitizeListMoney(p.additionalCosts);
  if (cost > 0) parts.push(`עלות: ${formatMoney(cost)}`);
  if (p.unitsPerCarton) parts.push(`${p.unitsPerCarton} יח'/קרטון`);
  if (p.packagingMaterialId) parts.push('אריזה משויכת');
  return parts.length ? parts.join(' · ') : 'ללא מחירים';
}

function sanitizeListMoney(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function categoryUniformPricing(products) {
  if (!products.length) return null;
  const priced = products.filter((p) => Number(p.unitPrice) > 0);
  if (!priced.length) return null;
  const prices = priced.map((p) => Number(p.unitPrice));
  const units = priced.map((p) => p.priceUnit || 'unit');
  if ([...new Set(prices)].length === 1 && [...new Set(units)].length === 1) {
    return { price: prices[0], priceUnit: units[0] };
  }
  return null;
}

function uniformPriceUnitLabel(priceUnit) {
  if (priceUnit === 'kg' || priceUnit === 'kg_units' || priceUnit === 'kg_with_units') return 'ק"ג';
  return "יח'";
}

function renderProductItem(p, index, mode = 'build') {
  if (mode === 'browse') {
    return `
    <div class="list-item product-list-item product-list-item--clickable product-list-item--browse ${p.active ? '' : 'inactive-label'}" data-product-id="${p.id}" role="button" tabindex="0">
      <div class="list-item-info">
        <div class="list-item-name">${escapeHtml(p.name)}</div>
        <div class="list-item-meta">${productPriceMeta(p)} ${p.active ? '' : '· לא פעיל'}</div>
      </div>
      <span class="product-browse-chevron" aria-hidden="true">‹</span>
    </div>`;
  }
  return `
    <div class="list-item product-list-item product-list-item--clickable ${p.active ? '' : 'inactive-label'}" data-product-id="${p.id}" role="button" tabindex="0">
      <div class="product-order-col">
        <span class="product-order-num" aria-label="מיקום ${index + 1}">${index + 1}</span>
        <span class="product-drag-handle" role="button" tabindex="0" aria-label="גרור לשינוי סדר">⠿</span>
      </div>
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
    </div>`;
}

function renderCategoryCard(cat, catIndex, mode = 'build') {
  const uniform = categoryUniformPricing(cat.products);
  const isExpanded = expandedCategories.has(cat.id);
  const priceBadge = uniform != null
    ? `<span class="category-price-badge">${formatMoney(uniform.price)}/${uniformPriceUnitLabel(uniform.priceUnit)}</span>`
    : '';
  const browseClass = mode === 'browse' ? ' category-card--browse' : '';

  if (mode === 'browse') {
    return `
    <div class="card category-card${browseClass}${isExpanded ? ' is-expanded' : ''}" data-category-id="${cat.id}">
      <div class="section-header category-card-header">
        <div class="category-header-start">
          <button type="button" class="category-toggle" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-label="${isExpanded ? 'סגור מוצרים' : 'פתח מוצרים'} — ${escapeHtml(cat.name)}">
            <span class="category-chevron" aria-hidden="true"></span>
            <span class="category-chip cat-chip" style="${categoryChipStyle(cat.color)}">${escapeHtml(cat.name)}</span>
            <span class="category-summary">${cat.products.length} מוצרים</span>
            ${priceBadge}
          </button>
        </div>
      </div>
      <div class="category-products-area">
        ${cat.products.length === 0
    ? '<p class="category-products-empty">אין מוצרים בקטגוריה זו</p>'
    : `<div class="product-list product-list--browse" data-category-id="${cat.id}">${cat.products.map((p, i) => renderProductItem(p, i, 'browse')).join('')}</div>`}
      </div>
    </div>`;
  }

  const unitPriceAttrs = `data-id="${cat.id}" data-name="${escapeHtml(cat.name)}" data-price="${uniform?.price ?? ''}" data-price-unit="${uniform?.priceUnit ?? 'unit'}" data-count="${cat.products.length}"`;
  const unitPriceBtn = `<button type="button" class="btn btn-secondary btn-sm cat-unit-price-btn" ${unitPriceAttrs}>💰 מחיר אחיד</button>`;
  return `
    <div class="card category-card${isExpanded ? ' is-expanded' : ''}" data-category-id="${cat.id}">
      <div class="section-header category-card-header">
        <div class="category-header-start">
          <div class="category-order-col">
            <span class="product-order-num category-order-num" aria-label="מיקום ${catIndex + 1}">${catIndex + 1}</span>
            <span class="product-drag-handle category-drag-handle" role="button" tabindex="0" aria-label="גרור לשינוי סדר קטגוריה">⠿</span>
          </div>
          <button type="button" class="category-toggle" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-label="${isExpanded ? 'סגור מוצרים' : 'פתח מוצרים'} — ${escapeHtml(cat.name)}">
            <span class="category-chevron" aria-hidden="true"></span>
            <span class="category-chip cat-chip" style="${categoryChipStyle(cat.color)}">${escapeHtml(cat.name)}</span>
            <span class="category-summary">${cat.products.length} מוצרים</span>
            ${priceBadge}
          </button>
        </div>
        <div class="category-actions">
          <button class="btn btn-secondary btn-sm btn-icon edit-cat" aria-label="ערוך קטגוריה" title="ערוך" data-id="${cat.id}" data-name="${escapeHtml(cat.name)}" data-color="${categoryColorValue(cat)}" data-group-id="${cat.groupId || ''}">✏️</button>
          <button class="btn btn-danger btn-sm btn-icon delete-cat" aria-label="מחק קטגוריה" title="מחק" data-id="${cat.id}" data-name="${escapeHtml(cat.name)}" data-count="${cat.products.length}">🗑</button>
        </div>
      </div>
      <div class="category-products-area">
        <div class="category-products-toolbar">
          <span class="category-products-label">מוצרים (${cat.products.length})</span>
          <div class="category-products-toolbar-actions">
            ${unitPriceBtn}
            <button class="btn btn-primary btn-sm add-product" data-cat="${cat.id}" data-catname="${escapeHtml(cat.name)}">+ מוצר</button>
          </div>
        </div>
        ${cat.products.length === 0
    ? '<p class="category-products-empty">אין מוצרים בקטגוריה זו</p>'
    : `<p class="product-drag-hint">גרור ⠿ לשינוי סדר · לחץ על מוצר לפרופיל מלא (מתכון · אפייה · תזרים)</p>
             <div class="product-list" data-category-id="${cat.id}">${cat.products.map((p, i) => renderProductItem(p, i, 'build')).join('')}</div>`}
      </div>
    </div>`;
}

function renderGroupCard(group, groupIndex, categories, mode = 'build') {
  const totalProducts = categories.reduce((s, c) => s + c.products.length, 0);
  const isExpanded = expandedGroups.has(group.id);
  const browseClass = mode === 'browse' ? ' category-group-card--browse' : '';

  if (mode === 'browse') {
    return `
    <div class="card category-group-card${browseClass}${isExpanded ? ' is-expanded' : ''}" data-group-id="${group.id}">
      <div class="section-header category-group-header">
        <div class="category-header-start">
          <button type="button" class="category-toggle category-group-toggle" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-label="${isExpanded ? 'סגור קטגוריות' : 'פתח קטגוריות'} — ${escapeHtml(group.name)}">
            <span class="category-chevron" aria-hidden="true"></span>
            <span class="category-group-chip" style="${categoryChipStyle(group.color)}">📁 ${escapeHtml(group.name)}</span>
            <span class="category-summary">${categories.length} קטגוריות · ${totalProducts} מוצרים</span>
          </button>
        </div>
      </div>
      <div class="category-group-body">
        ${categories.length === 0
    ? '<p class="category-products-empty">אין קטגוריות בקבוצה</p>'
    : `<div class="category-list" data-group-id="${group.id}">${categories.map((cat, i) => renderCategoryCard(cat, i, 'browse')).join('')}</div>`}
      </div>
    </div>`;
  }

  return `
    <div class="card category-group-card${isExpanded ? ' is-expanded' : ''}" data-group-id="${group.id}">
      <div class="section-header category-group-header">
        <div class="category-header-start">
          <div class="category-order-col">
            <span class="product-order-num category-group-order-num" aria-label="מיקום ${groupIndex + 1}">${groupIndex + 1}</span>
            <span class="product-drag-handle category-group-drag-handle" role="button" tabindex="0" aria-label="גרור לשינוי סדר קבוצה">⠿</span>
          </div>
          <button type="button" class="category-toggle category-group-toggle" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-label="${isExpanded ? 'סגור קטגוריות' : 'פתח קטגוריות'} — ${escapeHtml(group.name)}">
            <span class="category-chevron" aria-hidden="true"></span>
            <span class="category-group-chip" style="${categoryChipStyle(group.color)}">📁 ${escapeHtml(group.name)}</span>
            <span class="category-summary">${categories.length} קטגוריות · ${totalProducts} מוצרים</span>
          </button>
        </div>
        <div class="category-actions">
          <button class="btn btn-secondary btn-sm edit-group" data-id="${group.id}" data-name="${escapeHtml(group.name)}" data-color="${group.color || defaultColorForIndex(group.id)}">✏️</button>
          <button class="btn btn-danger btn-sm delete-group" data-id="${group.id}" data-name="${escapeHtml(group.name)}" data-count="${categories.length}">🗑</button>
        </div>
      </div>
      <div class="category-group-body">
        ${categories.length === 0
    ? '<p class="category-products-empty">אין קטגוריות בקבוצה — ערוך את הקבוצה להוספת קטגוריות</p>'
    : `<div class="category-list" data-group-id="${group.id}">${categories.map((cat, i) => renderCategoryCard(cat, i, 'build')).join('')}</div>`}
      </div>
    </div>`;
}

function renderCatalogHTML(layout, mode = 'build') {
  const { groups, ungrouped } = layout;
  if (!layout.allCategories.length) return '';

  const parts = [];
  if (groups.length) {
    parts.push(`
      <p class="product-drag-hint">${mode === 'browse'
    ? 'לחץ על קבוצה או קטגוריה לפתיחה · לחץ על מוצר לפרופיל'
    : 'קטגוריות כלליות — לחץ לפתיחה · גרור ⠿ לשינוי סדר'}</p>
      <div class="category-group-list">
        ${groups.map((g, i) => renderGroupCard(g, i, g.categories, mode)).join('')}
      </div>`);
  }
  if (ungrouped.length) {
    parts.push(`
      ${groups.length ? '<h3 class="catalog-section-title">קטגוריות ללא קבוצה</h3>' : `<p class="product-drag-hint">${mode === 'browse' ? 'לחץ על קטגוריה לפתיחה · לחץ על מוצר לפרופיל' : 'לחץ על קטגוריה לפתיחה · גרור ⠿ לשינוי סדר'}</p>`}
      <div class="category-list" data-group-id="">
        ${ungrouped.map((cat, i) => renderCategoryCard(cat, i, mode)).join('')}
      </div>`);
  }
  return parts.join('');
}

function bindProductsOptionsMenu(container) {
  const btn = container.querySelector('#products-options-btn');
  const menu = container.querySelector('#products-options-menu');
  if (!btn || !menu) return;

  const closeMenu = () => {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = menu.classList.contains('hidden');
    if (opening) {
      menu.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      setTimeout(() => {
        document.addEventListener('click', closeMenu, { once: true });
      }, 0);
    } else {
      closeMenu();
    }
  });

  menu.addEventListener('click', (e) => e.stopPropagation());
  container._productsOptionsClose = closeMenu;
}

export async function renderProducts(container) {
  const mode = getProductsMode(container);
  setProductsMode(container, mode);
  const isBuild = mode === 'build';
  const sheetsHTML = isBuild ? await renderSheetsStatusHTML() : '';
  // Always reconcile stored product costs with live composition so the list
  // matches the numbers shown inside the product profile.
  await syncAllProductsCostFromRecipes();
  const layout = await getProductsCatalogLayout();
  const totalProducts = (layout.allCategories || []).reduce((s, c) => s + (c.products?.length || 0), 0);

  const emptyState = isBuild
    ? `<div class="empty-state">
          <div class="empty-state-icon">📦</div>
          <p>התחל מאפס — הוסף קטגוריה ראשונה<br>או צור קטגוריה כללית לארגון קבוצות.</p>
          <button class="btn btn-primary" id="add-category-empty">+ הוסף קטגוריה</button>
        </div>`
    : `<div class="empty-state">
          <div class="empty-state-icon">📦</div>
          <p>אין מוצרים עדיין</p>
          <button type="button" class="btn btn-primary" id="products-go-build">עבור לעריכה ובנייה</button>
        </div>`;

  const browseToolbar = `
    <div class="section-header products-toolbar">
      <h2>מוצרים מוגמרים${totalProducts ? ` · ${totalProducts}` : ''}</h2>
      <div class="products-toolbar-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="products-expand-all" ${layout.allCategories.length ? '' : 'disabled'}>📂 פתח הכל</button>
        <button type="button" class="btn btn-secondary btn-sm" id="products-collapse-all" ${layout.allCategories.length ? '' : 'disabled'}>🗂 מזער הכל</button>
      </div>
    </div>
    <p class="form-hint products-mode-hint">תצוגה נוחה של כל המוצרים · לחץ על מוצר לפרופיל (מתכון · אפייה · תזרים)</p>`;

  const buildToolbar = `
    <div class="section-header products-toolbar">
      <h2>עריכה ובניית מוצרים</h2>
      <div class="products-toolbar-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="products-collapse-all" ${layout.allCategories.length ? '' : 'disabled'} title="מזער את כל הקבוצות והקטגוריות">🗂 מזער הכל</button>
        <button class="btn btn-primary btn-sm" id="add-category-btn">+ קטגוריה</button>
        <button class="btn btn-secondary btn-sm" id="add-group-btn">+ קטגוריה כללית</button>
        <div class="products-options-wrap">
          <button type="button" class="btn btn-secondary btn-sm" id="products-options-btn" aria-expanded="false" aria-haspopup="true">⚙️ אופציות</button>
          <div class="products-options-menu hidden" id="products-options-menu" role="menu">
            <button type="button" class="products-options-item" id="manual-merge-btn" role="menuitem">🔗 איחוד מוצרים נבחרים</button>
            <button type="button" class="products-options-item" id="merge-duplicates-btn" role="menuitem">🔗 איחוד כפילויות</button>
          </div>
        </div>
      </div>
    </div>
    <p class="form-hint products-mode-hint">כאן בונים פרופיל מלא למוצר — שיוך למתכון, אפייה ותזרים · וגם מבנה קטגוריות</p>`;

  const buildFooters = isBuild ? `
    <details class="card" style="margin-top:8px">
      <summary style="cursor:pointer;font-weight:600;font-size:0.9rem;color:var(--text-muted)">ייבוא מקובץ Excel (גיבוי)</summary>
      <p style="font-size:0.85rem;color:var(--text-muted);margin:12px 0;line-height:1.5">
        מומלץ לייבא מ-<strong>Google Sheets</strong> (למטה) · או מקובץ Excel ישירות.
      </p>
      <input type="file" id="csv-import" accept=".csv,.xlsx,.xls,.txt" hidden>
      <button class="btn btn-secondary btn-sm" id="import-btn" style="width:100%;margin-bottom:8px">📥 בחר קובץ</button>
      <button class="btn btn-secondary btn-sm" id="template-btn" style="width:100%">הורד קובץ דוגמה</button>
    </details>

    <details class="card backup-card">
      <summary class="import-summary">גיבוי ושחזור</summary>
      <p class="import-hint">גיבוי אוטומטי, בחירת תיקייה, ושחזור אחרי מחיקת האפליקציה</p>
      <button type="button" class="btn btn-primary btn-sm" id="open-backup-screen" style="width:100%">
        💾 פתח מסך גיבוי
      </button>
    </details>

    <div class="card sheets-footer-card">
      <div class="card-title">📊 ייבוא מ-Google Sheets</div>
      <div id="sheets-status">${sheetsHTML}</div>
    </div>

    <button class="btn btn-danger btn-sm" id="reset-all" style="width:100%;margin-top:12px">🔄 איפוס — התחלה מאפס</button>` : '';

  container.innerHTML = `
    ${renderProductsModeTabs(mode)}
    ${isBuild ? buildToolbar : browseToolbar}
    ${layout.allCategories.length === 0 ? emptyState : renderCatalogHTML(layout, mode)}
    ${buildFooters}`;

  container.querySelectorAll('.products-mode-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      setProductsMode(container, btn.dataset.productsMode);
      const meta = productsMeta(container);
      const sub = document.getElementById('page-subtitle');
      if (sub) sub.textContent = meta.subtitle;
      renderProducts(container);
    });
  });

  document.getElementById('products-go-build')?.addEventListener('click', () => {
    setProductsMode(container, 'build');
    renderProducts(container);
  });

  document.getElementById('products-collapse-all')?.addEventListener('click', () => {
    collapseAllProductsCatalog();
    showToast('הכל מוזער ✓');
    renderProducts(container);
  });

  document.getElementById('products-expand-all')?.addEventListener('click', () => {
    expandAllProductsCatalog(layout);
    showToast('הכל נפתח ✓');
    renderProducts(container);
  });

  if (!isBuild) {
    container.querySelectorAll('.category-group-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.category-group-card');
        if (card) toggleGroupCard(card);
      });
    });
    container.querySelectorAll('.category-card .category-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.category-card');
        if (card) toggleCategoryCard(card);
      });
    });
    bindProductDetailOpen(container);
    return;
  }

  bindProductsOptionsMenu(container);
  container.querySelector('#add-category-btn')?.addEventListener('click', () => showCategoryForm(container));
  container.querySelector('#add-category-empty')?.addEventListener('click', () => showCategoryForm(container));
  container.querySelector('#add-group-btn')?.addEventListener('click', () => showGroupForm(container));
  container.querySelector('#merge-duplicates-btn')?.addEventListener('click', () => {
    container._productsOptionsClose?.();
    showMergeDuplicatesModal(container);
  });
  container.querySelector('#manual-merge-btn')?.addEventListener('click', () => {
    container._productsOptionsClose?.();
    showManualMergeModal(container);
  });

  bindSheetsStatusEvents(container, {
    onRefresh: () => renderProducts(container),
    onImportComplete: () => renderProducts(container),
  });

  container.querySelectorAll('.delete-cat').forEach((btn) => {
    btn.addEventListener('click', () => confirmDeleteCategory(container, {
      id: Number(btn.dataset.id),
      name: btn.dataset.name,
      productCount: Number(btn.dataset.count),
    }));
  });

  document.getElementById('open-backup-screen')?.addEventListener('click', async () => {
    const { navigate } = await import('../app.js?v=458');
    navigate('backup');
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
      const { parseImportFile, importParsedRows, previewText } = await import('../import.js');
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
      document.getElementById('confirm-import')?.addEventListener('click', async () => {
        const btn = document.getElementById('confirm-import');
        btn.disabled = true;
        btn.textContent = 'מייבא...';
        try {
          const result = await importParsedRows(parsed, {
            importCatalog: importCatalogRows,
            importProduction: importProductionRows,
          });
          closeModal();
          const prod = result.production;
          if (prod) {
            const parts = [`${prod.imported} רישומים`];
            if (prod.merged) parts.push(`${prod.merged} עודכנו`);
            if (prod.newProducts) parts.push(`${prod.newProducts} מוצרים חדשים`);
            if (prod.newCategories) parts.push(`${prod.newCategories} קטגוריות חדשות`);
            if (prod.skipped) parts.push(`${prod.skipped} דולגו`);
            showToast(`יובא בהצלחה: ${parts.join(' · ')} ✓`);
          } else {
            showToast('יובא בהצלחה ✓');
          }
          renderProducts(container);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'ייבא';
          showImportError(err.message || 'שגיאה בייבוא');
        }
      });
    } catch (err) {
      showImportError(err.message || 'שגיאה בייבוא');
    }
  });

  document.getElementById('template-btn')?.addEventListener('click', async () => {
    const { CSV_TEMPLATE_BLOCKS } = await import('../import.js');
    const blob = new Blob(['\ufeff' + CSV_TEMPLATE_BLOCKS], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dugma-yitzur.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  container.querySelectorAll('.edit-cat').forEach((btn) => {
    btn.addEventListener('click', () => showCategoryForm(container, {
      id: btn.dataset.id,
      name: btn.dataset.name,
      color: btn.dataset.color,
      groupId: btn.dataset.groupId || '',
    }));
  });

  container.querySelectorAll('.edit-group').forEach((btn) => {
    btn.addEventListener('click', () => showGroupForm(container, {
      id: btn.dataset.id,
      name: btn.dataset.name,
      color: btn.dataset.color,
    }));
  });

  container.querySelectorAll('.delete-group').forEach((btn) => {
    btn.addEventListener('click', () => confirmDeleteGroup(container, {
      id: Number(btn.dataset.id),
      name: btn.dataset.name,
      categoryCount: Number(btn.dataset.count),
    }));
  });

  container.querySelectorAll('.cat-unit-price-btn').forEach((btn) => {
    btn.addEventListener('click', () => showCategoryPriceModal(container, {
      id: Number(btn.dataset.id),
      name: btn.dataset.name,
      productCount: Number(btn.dataset.count),
      currentPrice: btn.dataset.price,
      priceUnit: btn.dataset.priceUnit || 'unit',
    }));
  });

  bindProductDragLists(container, async (categoryId, productIds) => {
    try {
      await setProductOrderInCategory(categoryId, productIds);
    } catch (err) {
      showToast(err.message || 'שגיאה');
      renderProducts(container);
    }
  });

  bindCategoryDragList(container, async (categoryIds, groupId) => {
    try {
      await setCategoryOrderInContainer(groupId, categoryIds);
    } catch (err) {
      showToast(err.message || 'שגיאה');
      renderProducts(container);
    }
  });

  bindCategoryGroupDragList(container, async (groupIds) => {
    try {
      await setCategoryGroupOrder(groupIds);
    } catch (err) {
      showToast(err.message || 'שגיאה');
      renderProducts(container);
    }
  });

  container.querySelectorAll('.category-group-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.category-group-card');
      if (card) toggleGroupCard(card);
    });
  });

  container.querySelectorAll('.category-card .category-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.category-card');
      if (card) toggleCategoryCard(card);
    });
  });

  container.querySelectorAll('.add-product').forEach((btn) => {
    btn.addEventListener('click', () => {
      const categoryId = Number(btn.dataset.cat);
      expandCategory(categoryId);
      showProductForm(container, { categoryId, categoryName: btn.dataset.catname });
    });
  });

  container.querySelectorAll('.edit-product').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const p = await getProduct(Number(btn.dataset.id));
      if (p) showProductForm(container, { ...p });
    });
  });

  container.querySelectorAll('.toggle-product').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleProductActive(Number(btn.dataset.id));
      showToast('עודכן');
      renderProducts(container);
    });
  });

  bindProductDetailOpen(container);
}

function formatCompositionKg(grams) {
  if (!grams || grams <= 0) return '—';
  return `${formatDecimal(grams / 1000)} ק"ג`;
}

function formatCompositionWeightLabel(grams) {
  if (!grams || grams <= 0) return '—';
  const g = Math.round(Number(grams));
  if (g >= 1000 && g % 1000 === 0) return `${formatDecimal(g / 1000)} ק"ג`;
  if (g >= 1000) return `${g} גרם (${formatDecimal(g / 1000)} ק"ג)`;
  return `${g} גרם`;
}

function gramsToQtyInput(grams, unit = 'g') {
  if (grams == null || grams === '' || Number(grams) <= 0) return '';
  const g = Number(grams);
  if (unit === 'kg') return formatDecimal(g / 1000);
  return String(Math.round(g));
}

function parseCompositionQtyInput(val, unit = 'g') {
  const trimmed = String(val ?? '').trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (unit === 'kg') return Math.round(n * 1000);
  return Math.round(n);
}

/** תאימות לאחור — קלט ישן בק"ג */
function gramsToKgInput(grams) {
  return gramsToQtyInput(grams, 'kg');
}

function parseCompositionKgInput(val) {
  return parseCompositionQtyInput(val, 'kg');
}

function compositionUnitSelectHTML(selected = 'g', className = 'product-comp-qty-unit') {
  const u = selected === 'kg' ? 'kg' : 'g';
  return `<select class="${className}" aria-label="יחידת משקל">
    <option value="g"${u === 'g' ? ' selected' : ''}>גרם</option>
    <option value="kg"${u === 'kg' ? ' selected' : ''}>ק"ג</option>
  </select>`;
}

/**
 * מועמדים להוספה להרכב: מתכונים ומנות שמשויכות למוצר ועדיין לא בהרכב.
 */
function buildLinkedCompositionCandidates({
  linkedRecipes = [],
  portionPresets = [],
  portionMaterials = [],
  allRecipes = [],
  usedRecipeIds,
  usedPortionIds,
}) {
  const items = [];
  const seenRecipe = new Set();
  const seenPortion = new Set();
  const recipeById = new Map((allRecipes || []).map((r) => [Number(r.id), r]));
  const matById = new Map((portionMaterials || []).map((m) => [Number(m.id), m]));

  for (const r of linkedRecipes || []) {
    const rid = Number(r.id);
    if (!rid || usedRecipeIds.has(rid) || seenRecipe.has(rid)) continue;
    seenRecipe.add(rid);
    const full = recipeById.get(rid) || r;
    const g = recipeTotalWeightGrams(full.ingredients || r.ingredients);
    items.push({
      key: `recipe:${rid}`,
      kind: 'recipe',
      recipeId: rid,
      name: r.name || full.name || 'מתכון',
      defaultGrams: g > 0 ? g : null,
      badge: 'מתכון',
    });
  }

  for (const p of portionPresets || []) {
    const mid = Number(p.sourceRawMaterialId) || 0;
    const rid = Number(p.sourceRecipeId) || 0;
    if (mid) {
      if (usedPortionIds.has(mid) || seenPortion.has(mid)) continue;
      const mat = matById.get(mid);
      if (!mat?.isPortion) continue;
      seenPortion.add(mid);
      let defaultGrams = portionMaterialDefaultWeightGrams(mat);
      const w = Number(p.weight);
      if (Number.isFinite(w) && w > 0) {
        const unit = String(p.weightUnit || 'ק"ג').toLocaleLowerCase('he');
        defaultGrams = (unit.includes('גרם') || unit === 'g' || unit === 'gr')
          ? Math.round(w)
          : Math.round(w * 1000);
      }
      items.push({
        key: `portion:${mid}`,
        kind: 'portion',
        rawMaterialId: mid,
        name: p.name || mat.name || 'מנה',
        defaultGrams: defaultGrams > 0 ? defaultGrams : null,
        badge: 'מנה',
      });
      continue;
    }
    if (rid) {
      if (usedRecipeIds.has(rid) || seenRecipe.has(rid)) continue;
      seenRecipe.add(rid);
      const full = recipeById.get(rid);
      const g = recipeTotalWeightGrams(full?.ingredients);
      items.push({
        key: `recipe:${rid}`,
        kind: 'recipe',
        recipeId: rid,
        name: p.name || full?.name || p.recipeName || 'מתכון',
        defaultGrams: g > 0 ? g : null,
        badge: 'מנה·מתכון',
      });
    }
  }

  items.sort((a, b) => {
    const kindCmp = (a.kind === 'recipe' ? 0 : 1) - (b.kind === 'recipe' ? 0 : 1);
    if (kindCmp !== 0) return kindCmp;
    return String(a.name || '').localeCompare(String(b.name || ''), 'he');
  });
  return items;
}

function bindProductDetailOpen(container) {
  const openById = (id) => openProductDetailModal(container, Number(id));
  container.querySelectorAll('.product-list-item--clickable').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.edit-product, .toggle-product, .product-drag-handle')) return;
      openById(row.dataset.productId);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target.closest('.product-drag-handle')) return;
      e.preventDefault();
      openById(row.dataset.productId);
    });
  });
}

function buildProductDetailHTML(detail, {
  allRecipes, portionMaterials = [], bakingProfiles, profileMap, linkedFlows = [], candidateFlows = [],
  packagingMaterial = null, packagingSupplierName = '', portionPresets = [],
}) {
  const { product, category, components, linkedRecipes, bakingProfile, bakingProfileLink, totalWeightGrams } = detail;
  const totalWeightText = totalWeightGrams > 0 ? formatKgWeight(totalWeightGrams / 1000) : '—';
  const usedRecipeIds = new Set(components.filter((c) => c.kind !== 'portion').map((c) => c.recipeId));
  const usedPortionIds = new Set(components.filter((c) => c.kind === 'portion').map((c) => c.rawMaterialId));
  const availableRecipes = allRecipes.filter((r) => !usedRecipeIds.has(r.id));
  const availablePortions = (portionMaterials || []).filter((m) => !usedPortionIds.has(m.id));
  const allergenIds = sanitizeProductAllergenIds(detail.allergenIds ?? product.allergens);
  const allergensMode = sanitizeProductAllergensMode(detail.allergensMode ?? product.allergensMode);
  const computedAllergenIds = sanitizeProductAllergenIds(detail.computedAllergens?.allergenIds);
  const completeness = buildProductProfileCompleteness({
    product,
    components,
    linkedRecipes,
    bakingProfile,
    totalWeightGrams,
    portionPresets,
    linkedFlows,
    allergenIds,
  });
  const sellWeightText = Number(product.unitWeightKg) > 0
    ? `${formatDecimal(product.unitWeightKg)} ק"ג/יח'`
    : '';
  const allergenSummary = allergenIds.length
    ? allergenIds.map((id) => productAllergenLabel(id)).join(' · ')
    : '';
  const shelfResolved = resolveProductShelfLifeFields(product);
  const storageResolvedId = resolveProductStorageConditionId(product);
  const shelfDisplay = formatProductShelfLife(shelfResolved.value, shelfResolved.unit)
    || String(product.shelfLife || '').trim();
  const storageDisplay = productStorageConditionLabel(storageResolvedId)
    || String(product.storageConditions || '').trim();
  const shelfSummary = [shelfDisplay, storageDisplay].filter(Boolean).join(' · ');

  const compositionRows = components.length
    ? components.map((comp) => {
      if (comp.kind === 'portion') {
        const defaultG = comp.portionDefaultGrams || 0;
        const weightVal = gramsToQtyInput(comp.weightGrams, 'g');
        const placeholderG = defaultG > 0 ? String(Math.round(defaultG)) : '';
        return `
        <div class="product-composition-row product-composition-row--portion" data-component-id="${comp.id}" data-kind="portion">
          <div class="product-composition-main">
            <span class="product-composition-name">${escapeHtml(comp.material?.name || 'מנה')}
              <span class="product-composition-kind-badge">מנה</span>
            </span>
            <span class="product-composition-meta">ברירת מחדל: ${formatCompositionWeightLabel(defaultG)} · חומר גלם</span>
          </div>
          <label class="product-composition-weight">
            <input type="number" class="product-comp-weight-input" data-id="${comp.id}" data-kind="portion" min="0.001" step="any"
              value="${weightVal}" placeholder="${placeholderG}">
            ${compositionUnitSelectHTML('g', 'product-comp-weight-unit')}
          </label>
          <span class="product-composition-cost" title="עלות ספק">${formatMoney(comp.supplierCost)}</span>
          <button type="button" class="btn btn-danger btn-sm product-comp-remove" data-id="${comp.id}" data-kind="portion" title="הסר">🗑</button>
        </div>`;
      }
      const defaultG = comp.recipeTotalGrams || 0;
      const weightVal = gramsToQtyInput(comp.weightGrams, 'g');
      const placeholderG = defaultG > 0 ? String(Math.round(defaultG)) : '';
      const recipeId = Number(comp.recipeId || comp.recipe?.id) || '';
      return `
        <div class="product-composition-row" data-component-id="${comp.id}" data-kind="recipe">
          <div class="product-composition-main">
            <span class="product-composition-name">
              ${recipeId
    ? `<button type="button" class="product-open-recipe product-composition-recipe-link" data-recipe-id="${recipeId}">${escapeHtml(comp.recipe?.name || 'מתכון')}</button>`
    : escapeHtml(comp.recipe?.name || 'מתכון')}
              <span class="product-composition-kind-badge product-composition-kind-badge--recipe">מתכון</span>
            </span>
            <span class="product-composition-meta">בסיס: ${formatCompositionWeightLabel(defaultG)}</span>
          </div>
          <label class="product-composition-weight">
            <input type="number" class="product-comp-weight-input" data-id="${comp.id}" data-kind="recipe" min="0.001" step="any"
              value="${weightVal}" placeholder="${placeholderG}">
            ${compositionUnitSelectHTML('g', 'product-comp-weight-unit')}
          </label>
          <span class="product-composition-cost" title="עלות ספק">${formatMoney(comp.supplierCost)}</span>
          <button type="button" class="btn btn-danger btn-sm product-comp-remove" data-id="${comp.id}" data-kind="recipe" title="הסר">🗑</button>
        </div>`;
    }).join('')
    : '<p class="recipe-sheet-empty">אין רכיבים — סמן מתכונים/מנות משויכות והוסף להרכב</p>';

  const linkedCandidates = buildLinkedCompositionCandidates({
    linkedRecipes,
    portionPresets,
    portionMaterials,
    allRecipes,
    usedRecipeIds,
    usedPortionIds,
  });

  const linkedPickList = linkedCandidates.length
    ? `<div class="product-comp-pick-list" id="product-comp-pick-list">
        <p class="form-hint" style="margin:0 0 8px">משויך למוצר — סמן, הזן כמות (ברירת מחדל: גרם) והוסף:</p>
        ${linkedCandidates.map((item) => {
    const defG = item.defaultGrams > 0 ? item.defaultGrams : null;
    const qtyVal = defG ? gramsToQtyInput(defG, 'g') : '';
    return `
          <div class="product-comp-pick-row" data-pick-key="${escapeHtml(item.key)}" data-kind="${item.kind}"
            data-recipe-id="${item.recipeId || ''}" data-material-id="${item.rawMaterialId || ''}"
            data-default-grams="${defG || ''}">
            <label class="product-comp-pick-check">
              <input type="checkbox" class="product-comp-pick-cb" value="${escapeHtml(item.key)}">
              <span class="product-comp-pick-name">${escapeHtml(item.name)}
                <span class="product-composition-kind-badge${item.kind === 'recipe' ? ' product-composition-kind-badge--recipe' : ''}">${escapeHtml(item.badge)}</span>
              </span>
            </label>
            <label class="product-composition-weight product-comp-pick-qty-wrap">
              <input type="number" class="product-comp-pick-qty" min="0.001" step="any"
                value="${qtyVal}" placeholder="${defG ? String(Math.round(defG)) : 'כמות'}"
                aria-label="כמות ל${escapeHtml(item.name)}">
              ${compositionUnitSelectHTML('g', 'product-comp-pick-unit')}
            </label>
          </div>`;
  }).join('')}
        <button type="button" class="btn btn-primary btn-sm" id="product-comp-pick-add" style="margin-top:8px">+ הוסף מסומנים להרכב</button>
      </div>`
    : `<p class="form-hint">אין מתכונים/מנות משויכות פנויים להוספה — שייך מתכון למוצר או הגדר מנה במתכונים.</p>`;

  const quickAddBanner = '';

  const linkedRecipesChips = linkedRecipes.length
    ? `<div class="product-detail-linked-recipes">
        <p class="form-hint" style="margin:0 0 6px">שיוך למתכונים — לחץ לפתיחה:</p>
        <div class="product-detail-linked-recipes-list">
          ${linkedRecipes.map((r) => `
            <button type="button" class="recipe-meta-pill product-open-recipe" data-recipe-id="${r.id}">
              ${escapeHtml(r.name)}
            </button>`).join('')}
        </div>
      </div>`
    : '';

  const allergenChecks = PRODUCT_ALLERGENS.map((a) => `
    <label class="product-allergen-item">
      <input type="checkbox" class="product-allergen-cb" value="${a.id}"
        ${allergenIds.includes(a.id) ? 'checked' : ''}
        ${allergensMode === 'auto' ? 'disabled' : ''}>
      <span>${escapeHtml(a.label)}</span>
    </label>`).join('');

  const allergensSection = `
    <details class="recipe-sheet-section product-detail-section product-detail-collapse" open aria-label="אלרגנים">
      <summary class="recipe-sheet-section-title product-detail-collapse-summary">אלרגנים · סימון מוצר</summary>
      <div class="product-allergens-mode" role="radiogroup" aria-label="מצב אלרגנים">
        <label class="product-allergens-mode-option">
          <input type="radio" name="product-allergens-mode" value="auto" ${allergensMode === 'auto' ? 'checked' : ''}>
          אוטומטי מהרכב
        </label>
        <label class="product-allergens-mode-option">
          <input type="radio" name="product-allergens-mode" value="manual" ${allergensMode === 'manual' ? 'checked' : ''}>
          ידני
        </label>
      </div>
      <p class="form-hint">
        ${allergensMode === 'auto'
    ? (computedAllergenIds.length
      ? `חושב מהרכב: ${escapeHtml(computedAllergenIds.map((id) => productAllergenLabel(id)).join(' · '))}`
      : 'לא זוהו אלרגנים מהרכב (לפי שמות רכיבים / חומרי גלם)')
    : 'בחר ידנית — או לחץ «חשב מהרכב» ואז שמור'}
      </p>
      <div class="product-allergens-grid">${allergenChecks}</div>
      <div class="product-allergens-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="product-allergens-recompute">↻ חשב מהרכב</button>
        <button type="button" class="btn btn-primary btn-sm" id="product-allergens-save">שמור אלרגנים</button>
      </div>
    </details>`;

  const shelfSection = `
    <details class="recipe-sheet-section product-detail-section product-detail-collapse" open aria-label="חיי מדף ואחסון">
      <summary class="recipe-sheet-section-title product-detail-collapse-summary">חיי מדף · תנאי אחסון</summary>
      <div class="haccp-form-row product-shelf-storage-row" style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end">
        <div class="form-group" style="flex:0 0 auto;min-width:110px">
          <label for="product-detail-shelf-value">חיי מדף</label>
          <input type="number" id="product-detail-shelf-value" min="1" max="9999" step="1"
            inputmode="numeric" placeholder="מספר"
            value="${shelfResolved.value != null ? escapeHtml(String(shelfResolved.value)) : ''}">
        </div>
        <div class="form-group" style="flex:1;min-width:140px">
          <label for="product-detail-shelf-unit">יחידה</label>
          <select id="product-detail-shelf-unit">
            <option value="">בחר יחידה…</option>
            ${PRODUCT_SHELF_LIFE_UNITS.map((u) => `
              <option value="${u.id}"${shelfResolved.unit === u.id ? ' selected' : ''}>${escapeHtml(u.label)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="flex:1;min-width:180px">
          <label for="product-detail-storage">תנאי אחסון</label>
          <select id="product-detail-storage">
            <option value="">בחר תנאי אחסון…</option>
            ${PRODUCT_STORAGE_CONDITIONS.map((c) => `
              <option value="${c.id}"${storageResolvedId === c.id ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
          </select>
        </div>
      </div>
      <p class="form-hint" style="margin-top:6px">בחירה מרשימה — לדוגמה 5 ימים + קירור</p>
      <button type="button" class="btn btn-primary btn-sm" id="product-detail-save-shelf" style="margin-top:8px">שמור חיי מדף</button>
    </details>`;

  const completenessHtml = `
    <div class="product-profile-completeness" aria-label="השלמת פרופיל">
      <div class="product-profile-completeness-head">
        <strong>פרופיל מוצר · ${completeness.percent}%</strong>
        <span class="form-hint">${completeness.doneRequired}/${completeness.totalRequired} חובה
          ${completeness.ready ? '· מוכן לייצור/מכירה בסיסי' : '· חסרים שדות חובה'}</span>
      </div>
      <div class="product-profile-completeness-bar" aria-hidden="true">
        <span style="width:${completeness.percent}%"></span>
      </div>
      <ul class="product-profile-completeness-list">
        ${completeness.items.map((item) => `
          <li class="${item.done ? 'done' : 'missing'}${item.required ? '' : ' optional'}">
            <span>${item.done ? '✓' : '○'} ${escapeHtml(item.label)}</span>
            <span class="form-hint">${escapeHtml(item.detail || '')}${item.required ? '' : ' · רשות'}</span>
          </li>`).join('')}
      </ul>
    </div>`;

  const portionPresetsHtml = `
    <details class="recipe-sheet-section product-detail-section product-detail-collapse" open aria-label="מנות מתכון">
      <summary class="recipe-sheet-section-title product-detail-collapse-summary">מנות מתכון / תזרים</summary>
      <p class="form-hint">מנות שמוגדרות בעמדת מתכונים ומשויכות למוצר / קטגוריה / משפחה — לשימוש בתזרים ובשקילה.</p>
      ${(portionPresets || []).length
    ? `<ul class="product-portion-presets-list">
          ${portionPresets.map((p) => `
            <li>
              <strong>${escapeHtml(p.name || 'מנה')}</strong>
              <span class="form-hint">${p.weight ? `${formatDecimal(p.weight)} ${escapeHtml(p.weightUnit || 'ק"ג')}` : 'ללא משקל'}
                ${p.sourceRecipeId ? ' · מממתכון' : ''}${p.sourceRawMaterialId ? ' · מחומר גלם' : ''}</span>
            </li>`).join('')}
        </ul>`
    : '<p class="recipe-sheet-empty">אין מנות משויכות — הגדר ב«מתכונים» → מנות, או הוסף מנת הרכב למעלה</p>'}
    </details>`;

  const sellWeightSection = `
    <details class="recipe-sheet-section product-detail-section product-detail-collapse" open aria-label="מחיר ומשקל מכירה">
      <summary class="recipe-sheet-section-title product-detail-collapse-summary">מחיר · משקל מכירה · אריזה</summary>
      <div class="product-weight-summary">
        <div class="product-weight-chip">
          <span class="form-hint">משקל הרכב</span>
          <strong>${totalWeightText}</strong>
        </div>
        <div class="product-weight-chip">
          <span class="form-hint">משקל ליחידה (מכירה)</span>
          <strong>${sellWeightText || '—'}</strong>
        </div>
        <div class="product-weight-chip">
          <span class="form-hint">מחיר ללקוח</span>
          <strong>${Number(product.unitPrice) > 0 ? formatMoney(product.unitPrice) : '—'}</strong>
        </div>
      </div>
      ${productPriceUnitFieldsHTML(product)}
      <div class="haccp-form-row" style="display:flex;flex-wrap:wrap;gap:12px;margin-top:8px">
        <div class="form-group" style="flex:1;min-width:120px">
          <label for="product-detail-units-carton">יחידות בקרטון</label>
          <input type="number" id="product-detail-units-carton" min="0" step="1"
            value="${product.unitsPerCarton || ''}" placeholder="אופציונלי">
        </div>
      </div>
      <button type="button" class="btn btn-primary btn-sm" id="product-detail-save-sell" style="margin-top:10px">שמור מחיר ומשקל</button>
      <p class="form-hint" style="margin-top:8px">אריזה מספקים ועלויות נוספות — ב«עריכת פרטים» בתחתית.</p>
    </details>`;

  const recipeOptions = availableRecipes.length
    ? availableRecipes.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')
    : '<option value="" disabled>— אין מתכונים זמינים —</option>';

  const portionOptions = availablePortions.length
    ? availablePortions.map((m) => {
      const defaultG = portionMaterialDefaultWeightGrams(m);
      const labelG = defaultG > 0 ? `${Math.round(defaultG)} גרם` : '';
      return `<option value="${m.id}" data-weight-grams="${defaultG || ''}">${escapeHtml(m.name)}${labelG ? ` (${labelG})` : ''}</option>`;
    }).join('')
    : '<option value="" disabled>— אין מנות מחומרי גלם —</option>';

  const directProfileId = bakingProfileLink?.source === 'product' ? bakingProfile?.id : null;
  const inheritedHint = bakingProfile && bakingProfileLink?.source !== 'product'
    ? (bakingProfileLink.source === 'category'
      ? `יורש מקטגוריה ${bakingProfileLink.scopeName || ''}`
      : `יורש מקבוצה ${bakingProfileLink.scopeName || ''}`)
    : '';

  const productBakingHtml = bakingProfile
    ? `<div class="product-baking-profile">
        <strong>${escapeHtml(bakingProfile.name)}</strong>
        <span class="product-baking-params">${escapeHtml(formatRecipeBakingParamsLine({ bakingProfileId: bakingProfile.id, hasBaking: true }, bakingProfile))}</span>
        ${inheritedHint ? `<span class="form-hint product-baking-inherited">${escapeHtml(inheritedHint)}</span>` : ''}
      </div>`
    : '<p class="recipe-sheet-empty">לא שויך פרופיל אפייה למוצר</p>';

  const profileOptions = bakingProfiles.map((p) =>
    `<option value="${p.id}" ${directProfileId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`,
  ).join('');

  const recipeCompsForBaking = components.filter((c) => c.kind !== 'portion');
  const componentBakingRows = recipeCompsForBaking.length
    ? recipeCompsForBaking.map((comp) => {
      const baking = resolveRecipeBaking(comp.recipe, profileMap);
      const line = formatRecipeBakingParamsLine(comp.recipe, profileMap);
      if (!baking.hasBaking && !line) return '';
      return `<li><strong>${escapeHtml(comp.recipe?.name || '')}</strong>${line ? `: ${escapeHtml(line)}` : ''}${baking.bakeOvenType ? ` · ${escapeHtml(getRecipeOvenLabel(baking.bakeOvenType))}` : ''}</li>`;
    }).filter(Boolean).join('')
    : '';

  const marginHtml = detail.margin != null
    ? `<span class="product-detail-margin ${detail.margin >= 0 ? 'positive' : 'negative'}">רווח: ${formatMoney(detail.margin)}</span>`
    : '';

  const rawSource = detail.currentCosts.rawMaterialsCostSource || 'recipes';
  const rawSourceLabel = rawSource === 'recipes' ? 'מהמתכונים' : 'ידני';
  const rawCostActions = rawSource === 'recipes'
    ? `<button type="button" class="btn btn-secondary btn-sm" id="product-switch-manual-cost" style="margin-top:10px">בטל — עבור להזנה ידנית</button>`
    : `<button type="button" class="btn btn-primary btn-sm" id="product-apply-recommended-cost" style="margin-top:10px">הפעל עלות מהמתכונים</button>`;

  const linkedFlowIds = new Set(linkedFlows.map((row) => Number(row.flow.id)).filter(Boolean));
  const flowCheckboxes = candidateFlows.length
    ? candidateFlows.map((f) => `
        <label class="product-flow-link-item">
          <input type="checkbox" class="product-flow-link-cb" value="${f.id}" ${linkedFlowIds.has(f.id) ? 'checked' : ''}>
          <span class="product-flow-link-name">${escapeHtml(f.name)}${f.isDefault ? ' ★' : ''}</span>
          <span class="product-flow-link-meta">${escapeHtml(f.targetLabel || '')} · ${f.stepCount || 0} שלבים</span>
        </label>`).join('')
    : '<p class="recipe-sheet-empty">אין תזרימים — הגדר ב«תהליך יצור» → נהל תזרים</p>';

  return `
    <article class="product-detail-sheet">
      <header class="recipe-sheet-header">
        <p class="recipe-sheet-breadcrumb">${category ? escapeHtml(category.name) : ''}</p>
        <h1 class="recipe-sheet-title">${escapeHtml(product.name)}</h1>
        <div class="recipe-sheet-meta">
          <span class="recipe-meta-pill">⚖️ הרכב ${totalWeightText}</span>
          ${sellWeightText ? `<span class="recipe-meta-pill">יח׳ ${escapeHtml(sellWeightText)}</span>` : ''}
          ${Number(product.unitPrice) > 0 ? `<span class="recipe-meta-pill">💰 ${formatMoney(product.unitPrice)}</span>` : ''}
          ${bakingProfile ? `<span class="recipe-meta-pill">🔥 ${escapeHtml(bakingProfile.name)}</span>` : ''}
          ${allergenSummary ? `<span class="recipe-meta-pill" title="${escapeHtml(allergenSummary)}">⚠ ${allergenIds.length} אלרגנים</span>` : ''}
          ${shelfSummary ? `<span class="recipe-meta-pill" title="${escapeHtml(shelfSummary)}">⏳ מדף</span>` : ''}
          ${product.unitsPerCarton ? `<span class="recipe-meta-pill">📦 ${product.unitsPerCarton} יח׳ בקרטון</span>` : ''}
          ${packagingMaterial ? `<span class="recipe-meta-pill">🥡 ${escapeHtml(packagingMaterial.name)}${packagingSupplierName ? ` · ${escapeHtml(packagingSupplierName)}` : ''}</span>` : ''}
          ${product.active ? '' : '<span class="recipe-meta-pill">לא פעיל</span>'}
        </div>
        ${completenessHtml}
        <div class="product-detail-collapse-toolbar">
          <button type="button" class="btn btn-secondary btn-sm" id="product-detail-collapse-all">🗂 מזער הכל</button>
          <button type="button" class="btn btn-secondary btn-sm" id="product-detail-expand-all">📂 פתח הכל</button>
        </div>
      </header>

      ${sellWeightSection}

      <details class="recipe-sheet-section product-detail-section product-detail-collapse" open aria-label="הרכב מוצר">
        <summary class="recipe-sheet-section-title product-detail-collapse-summary">הרכב מוצר · מתכונים ומנות</summary>
        ${linkedRecipesChips}
        <div class="product-composition-list">${compositionRows}</div>
        ${linkedPickList}
        <details class="product-composition-other-add">
          <summary>הוסף מתכון/מנה אחרים (לא מהרשימה המשויכת)</summary>
          <div class="product-composition-add" style="margin-top:8px">
            <select id="product-add-recipe-select" class="product-add-recipe-select">
              <option value="">— בחר מתכון —</option>
              ${recipeOptions}
            </select>
            <label class="product-composition-weight">
              <input type="number" id="product-add-recipe-qty" min="0.001" step="any" placeholder="כמות">
              ${compositionUnitSelectHTML('g', 'product-add-recipe-unit')}
            </label>
            <button type="button" class="btn btn-secondary btn-sm" id="product-add-recipe-btn">+ הוסף מתכון</button>
          </div>
          <div class="product-composition-add product-composition-add--portion">
            <select id="product-add-portion-select" class="product-add-recipe-select">
              <option value="">— בחר מנה —</option>
              ${portionOptions}
            </select>
            <label class="product-composition-weight product-add-portion-weight">
              <input type="number" id="product-add-portion-weight" min="0.001" step="any" placeholder="כמות">
              ${compositionUnitSelectHTML('g', 'product-add-portion-unit')}
            </label>
            <button type="button" class="btn btn-secondary btn-sm" id="product-add-portion-btn">+ הוסף מנה</button>
          </div>
        </details>
        <p class="form-hint" style="margin-top:8px">כמות נשמרת בגרמים · ברירת מחדל להזנה: גרם · לחץ על שם מתכון לפתיחה</p>
      </details>

      ${allergensSection}
      ${shelfSection}
      ${portionPresetsHtml}

      <details class="recipe-sheet-section product-detail-section product-detail-collapse" open aria-label="אפייה">
        <summary class="recipe-sheet-section-title product-detail-collapse-summary">אפייה · שיוך פרופיל</summary>
        <div class="product-baking-product">
          <label for="product-baking-profile-select">פרופיל אפייה למוצר</label>
          <select id="product-baking-profile-select">
            <option value="">— ללא —</option>
            ${profileOptions}
          </select>
        </div>
        ${productBakingHtml}
        ${componentBakingRows ? `<div class="product-baking-recipes"><p class="product-detail-subtitle">מתכוני הרכב:</p><ul>${componentBakingRows}</ul></div>` : ''}
        <div class="product-baking-actions">
          <button type="button" class="btn btn-secondary btn-sm" id="product-share-baking" ${bakingProfile ? '' : 'disabled'}>
            📤 שתף / הדפס אפייה למוצר
          </button>
        </div>
      </details>

      <details class="recipe-sheet-section product-detail-section product-detail-collapse" open aria-label="תזרימי ייצור">
        <summary class="recipe-sheet-section-title product-detail-collapse-summary">תזרימי ייצור · שיוך לתזרים</summary>
        <p class="form-hint product-detail-subtitle">שיוך ישיר גובר על תזרים לפי קטגוריה. ניתן לשייך כמה תזרימים למוצר.</p>
        <div class="product-flow-links-list">${flowCheckboxes}</div>
        <button type="button" class="btn btn-primary btn-sm" id="product-save-flow-links" style="margin-top:10px">שמור שיוך תזרימים</button>
      </details>

      <details class="recipe-sheet-section product-detail-section product-detail-collapse" open aria-label="עלות ורווח">
        <summary class="recipe-sheet-section-title product-detail-collapse-summary">עלות ורווח</summary>
        <div class="product-pricing-grid">
          <div class="product-pricing-row highlight">
            <span>עלות מומלצת (ספק)</span>
            <strong>${formatMoney(detail.recommendedCost)}</strong>
          </div>
          <div class="product-pricing-row">
            <span>עלות מלאה (כל המחירים)</span>
            <span>${formatMoney(detail.fullCost)}</span>
          </div>
          <div class="product-pricing-row">
            <span>חומרי גלם (נוכחי) <span class="product-cost-source-badge">${rawSourceLabel}</span></span>
            <span>${formatMoney(detail.currentCosts.rawMaterialsCost)}</span>
          </div>
          <div class="product-pricing-row">
            <span>אריזה${packagingMaterial ? ` · ${escapeHtml(packagingMaterial.name)}` : ''}</span>
            <span>${formatMoney(detail.currentCosts.packagingCost)}</span>
          </div>
          ${packagingMaterial ? `
          <div class="product-pricing-row">
            <span>אריזה מספקים</span>
            <span>${escapeHtml(packagingMaterial.name)}${packagingSupplierName ? ` · ${escapeHtml(packagingSupplierName)}` : ''}</span>
          </div>` : ''}
          <div class="product-pricing-row">
            <span>עלויות נוספות</span>
            <span>${formatMoney(detail.currentCosts.additionalCosts)}</span>
          </div>
          <div class="product-pricing-row">
            <span>סה״כ עלות</span>
            <span>${formatMoney(detail.currentCosts.totalCost)}</span>
          </div>
          <p class="form-hint" style="margin:6px 0 0">סה״כ עלות = חומרי גלם + אריזה + נוספות · מחיר ללקוח נשמר בסעיף «מחיר ומשקל»</p>
          ${detail.currentCosts.unitPrice > 0 ? `
          <div class="product-pricing-row">
            <span>מחיר ללקוח</span>
            <span>${formatMoney(detail.currentCosts.unitPrice)}</span>
          </div>` : ''}
        </div>
        ${marginHtml}
        ${rawCostActions}
      </details>
    </article>`;
}

async function openProductDetailModal(container, productId) {
  let detail;
  let allRecipes = [];
  let portionMaterials = [];
  let bakingProfiles = [];
  let profileMap = new Map();
  let packagingMaterial = null;
  let packagingSupplierName = '';
  let portionPresets = [];

  let linkedFlows = [];
  let candidateFlows = [];

  async function loadContext() {
    const [d, layout, profiles, linked, candidates, packMats, suppliers, materials, presets] = await Promise.all([
      getProductDetail(productId),
      getRecipesCatalogLayout(),
      getBakingProfiles(),
      getLinkedFlowsForProduct(productId),
      getCandidateFlowsForProduct(productId),
      getPackagingMaterials(),
      getSuppliers(),
      getRawMaterials(),
      getPortionPresetsForProduct(productId),
    ]);
    detail = d;
    linkedFlows = linked;
    candidateFlows = candidates;
    portionPresets = presets || [];
    bakingProfiles = profiles;
    profileMap = new Map(profiles.map((p) => [p.id, p]));
    const mid = Number(d?.product?.packagingMaterialId);
    packagingMaterial = mid ? (packMats.find((m) => m.id === mid) || null) : null;
    packagingSupplierName = packagingMaterial?.supplierId
      ? (suppliers.find((s) => s.id === packagingMaterial.supplierId)?.name || '')
      : '';
    allRecipes = [];
    for (const group of layout.groups) {
      for (const cat of group.categories) {
        for (const r of cat.recipes) allRecipes.push(r);
      }
    }
    allRecipes.sort((a, b) => a.name.localeCompare(b.name, 'he'));
    portionMaterials = (materials || [])
      .filter((m) => m.isPortion)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'he'));
  }

  const detailOpts = () => ({
    allRecipes, portionMaterials, bakingProfiles, profileMap, linkedFlows, candidateFlows,
    packagingMaterial, packagingSupplierName, portionPresets,
  });

  async function refreshModal() {
    await loadContext();
    const body = document.querySelector('.modal-body');
    if (body) body.innerHTML = buildProductDetailHTML(detail, detailOpts());
    bindProductDetailModalEvents(container, productId, refreshModal);
  }

  await loadContext();

  const refreshListAfterClose = () => {
    renderProducts(container);
  };

  openModal({
    title: '',
    modalClass: 'modal-product-detail',
    bodyHTML: buildProductDetailHTML(detail, detailOpts()),
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">סגור</button>
      <button type="button" class="btn btn-primary" id="product-detail-edit">עריכת פרטים</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', () => {
    closeModal();
    refreshListAfterClose();
  });
  document.getElementById('product-detail-edit')?.addEventListener('click', async () => {
    closeModal();
    refreshListAfterClose();
    const p = await getProduct(productId);
    if (p) showProductForm(container, { ...p });
  });

  bindProductDetailModalEvents(container, productId, refreshModal);
}

function bindProductDetailModalEvents(container, productId, refreshModal) {
  document.getElementById('product-detail-collapse-all')?.addEventListener('click', () => {
    document.querySelectorAll('.product-detail-collapse').forEach((el) => {
      el.open = false;
    });
  });
  document.getElementById('product-detail-expand-all')?.addEventListener('click', () => {
    document.querySelectorAll('.product-detail-collapse').forEach((el) => {
      el.open = true;
    });
  });

  async function afterCompositionChange() {
    await syncProductCostIfRecipesMode(productId);
    await refreshModal();
    renderProducts(container);
  }

  document.querySelectorAll('.product-comp-weight-input').forEach((input) => {
    const saveWeight = async () => {
      const id = Number(input.dataset.id);
      const kind = input.dataset.kind || 'recipe';
      const unit = input.closest('.product-composition-weight')
        ?.querySelector('.product-comp-weight-unit')?.value || 'g';
      const grams = parseCompositionQtyInput(input.value, unit);
      try {
        if (kind === 'portion') {
          await updateProductPortionComponent(id, { weightGrams: grams });
        } else {
          await updateProductRecipeComponent(id, { weightGrams: grams });
        }
        await afterCompositionChange();
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    };
    input.addEventListener('change', saveWeight);
  });

  document.querySelectorAll('.product-comp-weight-unit').forEach((sel) => {
    sel.addEventListener('change', () => {
      const wrap = sel.closest('.product-composition-weight');
      const input = wrap?.querySelector('.product-comp-weight-input');
      if (!input) return;
      const prevUnit = sel.dataset.prevUnit || 'g';
      const grams = parseCompositionQtyInput(input.value, prevUnit);
      sel.dataset.prevUnit = sel.value;
      if (grams != null) input.value = gramsToQtyInput(grams, sel.value);
    });
    sel.dataset.prevUnit = sel.value || 'g';
  });

  document.querySelectorAll('.product-comp-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const kind = btn.dataset.kind || 'recipe';
        if (kind === 'portion') {
          await deleteProductPortionComponent(Number(btn.dataset.id));
        } else {
          await deleteProductRecipeComponent(Number(btn.dataset.id));
        }
        showToast('הוסר');
        await afterCompositionChange();
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.querySelectorAll('.product-comp-pick-unit').forEach((sel) => {
    sel.addEventListener('change', () => {
      const row = sel.closest('.product-comp-pick-row');
      const input = row?.querySelector('.product-comp-pick-qty');
      if (!input) return;
      const prevUnit = sel.dataset.prevUnit || 'g';
      const grams = parseCompositionQtyInput(input.value, prevUnit)
        ?? (Number(row?.dataset.defaultGrams) > 0 ? Number(row.dataset.defaultGrams) : null);
      sel.dataset.prevUnit = sel.value;
      if (grams != null) input.value = gramsToQtyInput(grams, sel.value);
    });
    sel.dataset.prevUnit = sel.value || 'g';
  });

  document.getElementById('product-comp-pick-add')?.addEventListener('click', async () => {
    const rows = [...document.querySelectorAll('.product-comp-pick-row')].filter((row) => (
      row.querySelector('.product-comp-pick-cb')?.checked
    ));
    if (!rows.length) {
      showToast('סמן לפחות מתכון או מנה');
      return;
    }
    const btn = document.getElementById('product-comp-pick-add');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'מוסיף...';
    }
    let added = 0;
    try {
      for (const row of rows) {
        const kind = row.dataset.kind;
        const unit = row.querySelector('.product-comp-pick-unit')?.value || 'g';
        let grams = parseCompositionQtyInput(row.querySelector('.product-comp-pick-qty')?.value, unit);
        if (grams == null && Number(row.dataset.defaultGrams) > 0) {
          grams = Number(row.dataset.defaultGrams);
        }
        if (kind === 'portion') {
          const rawMaterialId = Number(row.dataset.materialId);
          if (!rawMaterialId) continue;
          await addProductPortionComponent({
            productId,
            rawMaterialId,
            weightGrams: grams,
          });
          added += 1;
        } else {
          const recipeId = Number(row.dataset.recipeId);
          if (!recipeId) continue;
          await addProductRecipeComponent({
            productId,
            recipeId,
            weightGrams: grams,
          });
          added += 1;
        }
      }
      showToast(added ? `נוספו ${added} להרכב ✓` : 'לא נוסף כלום');
      await afterCompositionChange();
    } catch (err) {
      showToast(err.message || 'שגיאה');
      if (btn) {
        btn.disabled = false;
        btn.textContent = '+ הוסף מסומנים להרכב';
      }
    }
  });

  document.getElementById('product-add-recipe-btn')?.addEventListener('click', async () => {
    const sel = document.getElementById('product-add-recipe-select');
    const recipeId = Number(sel?.value);
    if (!recipeId) return showToast('בחר מתכון');
    const unit = document.querySelector('.product-add-recipe-unit')?.value || 'g';
    const grams = parseCompositionQtyInput(document.getElementById('product-add-recipe-qty')?.value, unit);
    try {
      await addProductRecipeComponent({ productId, recipeId, weightGrams: grams });
      showToast('נוסף');
      await afterCompositionChange();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  const portionSelect = document.getElementById('product-add-portion-select');
  const portionWeightInput = document.getElementById('product-add-portion-weight');
  const portionUnitSel = document.querySelector('.product-add-portion-unit');
  const syncPortionWeightPlaceholder = () => {
    if (!portionSelect || !portionWeightInput) return;
    const opt = portionSelect.selectedOptions?.[0];
    const grams = Number(opt?.dataset?.weightGrams) || 0;
    const unit = portionUnitSel?.value || 'g';
    if (!portionWeightInput.value && grams > 0) {
      portionWeightInput.value = gramsToQtyInput(grams, unit);
    }
    portionWeightInput.placeholder = grams > 0 ? gramsToQtyInput(grams, unit) : 'כמות';
  };
  portionSelect?.addEventListener('change', () => {
    if (portionWeightInput) portionWeightInput.value = '';
    syncPortionWeightPlaceholder();
  });
  portionUnitSel?.addEventListener('change', () => {
    const prev = portionUnitSel.dataset.prevUnit || 'g';
    const grams = parseCompositionQtyInput(portionWeightInput?.value, prev);
    portionUnitSel.dataset.prevUnit = portionUnitSel.value;
    if (grams != null && portionWeightInput) {
      portionWeightInput.value = gramsToQtyInput(grams, portionUnitSel.value);
    } else {
      syncPortionWeightPlaceholder();
    }
  });
  if (portionUnitSel) portionUnitSel.dataset.prevUnit = portionUnitSel.value || 'g';
  syncPortionWeightPlaceholder();

  document.getElementById('product-add-portion-btn')?.addEventListener('click', async () => {
    const materialId = Number(portionSelect?.value);
    if (!materialId) return showToast('בחר מנה');
    const unit = portionUnitSel?.value || 'g';
    const grams = parseCompositionQtyInput(portionWeightInput?.value, unit);
    try {
      await addProductPortionComponent({
        productId,
        rawMaterialId: materialId,
        weightGrams: grams,
      });
      showToast('מנה נוספה');
      await afterCompositionChange();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('product-baking-profile-select')?.addEventListener('change', async (e) => {
    const val = e.target.value;
    try {
      const link = await getProductBakingProfileLink(productId);
      if (val) {
        if (link?.source === 'product' && Number(link.bakingProfileId) !== Number(val)) {
          await unlinkProductFromBakingProfile(link.bakingProfileId, productId);
        }
        await linkProductToBakingProfile(Number(val), productId);
      } else if (link?.source === 'product') {
        await unlinkProductFromBakingProfile(link.bakingProfileId, productId);
      }
      await refreshModal();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('product-save-flow-links')?.addEventListener('click', async () => {
    const flowIds = [...document.querySelectorAll('.product-flow-link-cb:checked')].map((cb) => Number(cb.value));
    try {
      await setProductFlowLinks(productId, flowIds);
      showToast('שיוך תזרימים נשמר ✓');
      await refreshModal();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('product-apply-recommended-cost')?.addEventListener('click', async () => {
    try {
      const cost = await syncProductCostFromComposition(productId, { setSource: true });
      showToast(`עלות חומרי גלם עודכנה ל-${formatMoney(cost)} (מהמתכונים)`);
      await refreshModal();
      renderProducts(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('product-switch-manual-cost')?.addEventListener('click', async () => {
    try {
      await updateProduct(productId, { rawMaterialsCostSource: 'manual' });
      showToast('עלות חומרי גלם: הזנה ידנית (בוטל חישוב ממתכונים)');
      await refreshModal();
      renderProducts(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  bindProductPriceUnitFields();

  document.getElementById('product-detail-save-sell')?.addEventListener('click', async () => {
    const root = document.querySelector('.modal-body') || document;
    const priceUnit = root.querySelector('input[name="prod-price-unit"]:checked')?.value || 'unit';
    const unitPrice = root.querySelector('#prod-price')?.value;
    const unitWeightKg = root.querySelector('#prod-unit-weight')?.value;
    const unitsPerCarton = root.querySelector('#product-detail-units-carton')?.value;
    try {
      await updateProduct(productId, {
        priceUnit,
        unitPrice: unitPrice === '' || unitPrice == null ? 0 : unitPrice,
        unitWeightKg: (priceUnit === 'kg_units' || priceUnit === 'kg_with_units')
          ? unitWeightKg
          : null,
        unitsPerCarton: unitsPerCarton === '' || unitsPerCarton == null ? null : unitsPerCarton,
      });
      showToast('מחיר ומשקל נשמרו ✓');
      await refreshModal();
      renderProducts(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  async function openLinkedRecipe(recipeId) {
    const id = Number(recipeId);
    if (!id) return;
    try {
      const { requestOpenRecipe } = await import('./recipes.js?v=458');
      const { navigateToWorkspace } = await import('../app.js?v=458');
      requestOpenRecipe(id);
      closeModal();
      await navigateToWorkspace('recipes', 'recipes');
    } catch (err) {
      showToast(err.message || 'לא ניתן לפתוח מתכון');
    }
  }

  document.querySelectorAll('.product-open-recipe').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openLinkedRecipe(btn.dataset.recipeId);
    });
  });

  document.getElementById('product-share-baking')?.addEventListener('click', async () => {
    try {
      const { shareBakingForProduct } = await import('./recipes.js?v=458');
      const method = await shareBakingForProduct(productId);
      if (method === 'cancelled') return;
      if (method === 'share') showToast('נפתח Share — אפשר לשלוח או להדפיס');
      else showToast('הקובץ הורד');
    } catch (err) {
      showToast(err.message || 'שגיאה בשיתוף אפייה');
    }
  });

  const syncAllergenChecksDisabled = () => {
    const mode = document.querySelector('input[name="product-allergens-mode"]:checked')?.value || 'auto';
    document.querySelectorAll('.product-allergen-cb').forEach((cb) => {
      cb.disabled = mode === 'auto';
    });
  };
  document.querySelectorAll('input[name="product-allergens-mode"]').forEach((radio) => {
    radio.addEventListener('change', syncAllergenChecksDisabled);
  });

  document.getElementById('product-allergens-recompute')?.addEventListener('click', async () => {
    try {
      const { computeProductAllergensFromComposition } = await import('../kitchen-db.js?v=458');
      const computed = await computeProductAllergensFromComposition(productId);
      const ids = new Set(sanitizeProductAllergenIds(computed.allergenIds));
      document.querySelectorAll('.product-allergen-cb').forEach((cb) => {
        cb.checked = ids.has(cb.value);
      });
      const autoRadio = document.querySelector('input[name="product-allergens-mode"][value="auto"]');
      if (autoRadio) autoRadio.checked = true;
      syncAllergenChecksDisabled();
      showToast(ids.size ? `זוהו ${ids.size} אלרגנים מהרכב` : 'לא זוהו אלרגנים מהרכב');
    } catch (err) {
      showToast(err.message || 'שגיאה בחישוב אלרגנים');
    }
  });

  document.getElementById('product-allergens-save')?.addEventListener('click', async () => {
    const mode = document.querySelector('input[name="product-allergens-mode"]:checked')?.value || 'auto';
    let allergens = [...document.querySelectorAll('.product-allergen-cb:checked')].map((cb) => cb.value);
    try {
      if (mode === 'auto') {
        const { computeProductAllergensFromComposition } = await import('../kitchen-db.js?v=458');
        const computed = await computeProductAllergensFromComposition(productId);
        allergens = sanitizeProductAllergenIds(computed.allergenIds);
      } else {
        allergens = sanitizeProductAllergenIds(allergens);
      }
      await updateProduct(productId, {
        allergens,
        allergensMode: mode === 'manual' ? 'manual' : 'auto',
      });
      showToast('אלרגנים נשמרו ✓');
      await refreshModal();
      renderProducts(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('product-detail-save-shelf')?.addEventListener('click', async () => {
    const shelfLifeValue = document.getElementById('product-detail-shelf-value')?.value || '';
    const shelfLifeUnit = document.getElementById('product-detail-shelf-unit')?.value || '';
    const storageConditionId = document.getElementById('product-detail-storage')?.value || '';
    const shelfLife = formatProductShelfLife(shelfLifeValue, shelfLifeUnit);
    const storageConditions = productStorageConditionLabel(storageConditionId);
    if ((shelfLifeValue || shelfLifeUnit) && !shelfLife) {
      showToast('יש למלא מספר יחידה לחיי מדף (יום / חודש / שנה)');
      return;
    }
    try {
      await updateProduct(productId, {
        shelfLife,
        shelfLifeValue: shelfLife ? Number(shelfLifeValue) : null,
        shelfLifeUnit: shelfLife ? shelfLifeUnit : '',
        storageConditions,
        storageConditionId: storageConditionId || '',
      });
      showToast('חיי מדף ואחסון נשמרו ✓');
      await refreshModal();
      renderProducts(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
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
    expandedCategories.delete(id);
    saveExpandedCategories();
    closeModal();
    showToast('הקטגוריה נמחקה');
    renderProducts(container);
  });
}

async function showManualMergeModal(container) {
  const [categories, products] = await Promise.all([
    getCategories(),
    getProductsWithEntryStats(),
  ]);

  if (products.length < 2) {
    showToast('צריך לפחות 2 מוצרים לאיחוד');
    return;
  }

  const defaultCategoryId = categories[0]?.id || products[0].categoryId;

  function productsForCategory(catId) {
    return products.filter((p) => p.categoryId === Number(catId));
  }

  function suggestName(checkedIds) {
    const selected = products.filter((p) => checkedIds.has(p.id));
    if (!selected.length) return '';
    selected.sort((a, b) => b.totalQty - a.totalQty || b.entryCount - a.entryCount || a.name.localeCompare(b.name, 'he'));
    return selected[0].name;
  }

  function renderProductOptions(catId) {
    const list = productsForCategory(catId);
    if (!list.length) {
      return '<p class="form-hint">אין מוצרים בקטגוריה זו</p>';
    }
    return list.map((p) => `
      <label class="merge-product-option manual-merge-option">
        <input type="checkbox" class="manual-merge-check" value="${p.id}">
        <span>
          <strong>${escapeHtml(p.name)}</strong>
          <span class="merge-product-meta">${p.entryCount} רישומים · ${p.totalQty} יח'</span>
        </span>
      </label>`).join('');
  }

  openModal({
    title: 'איחוד מוצרים נבחרים',
    bodyHTML: `
      <p class="form-hint" style="margin-bottom:12px;line-height:1.5">
        בחר 2 מוצרים או יותר מאותה קטגוריה. כל רישומי הייצור יישמרו תחת מוצר אחד.
      </p>
      <div class="form-group">
        <label for="manual-merge-category">קטגוריה</label>
        <select id="manual-merge-category">
          ${categories.map((c) => `<option value="${c.id}" ${c.id === defaultCategoryId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="manual-merge-list" id="manual-merge-list">
        ${renderProductOptions(defaultCategoryId)}
      </div>
      <div class="form-group" style="margin-top:12px">
        <label for="manual-merge-name">שם המוצר המאוחד</label>
        <input type="text" id="manual-merge-name" placeholder="לדוגמה: עוגת שוקולד">
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="confirm-manual-merge">אחד מוצרים</button>`,
  });

  const listEl = document.getElementById('manual-merge-list');
  const nameInput = document.getElementById('manual-merge-name');
  const categorySelect = document.getElementById('manual-merge-category');

  function getCheckedIds() {
    return new Set(
      [...document.querySelectorAll('.manual-merge-check:checked')].map((el) => Number(el.value))
    );
  }

  function syncNameSuggestion() {
    const ids = getCheckedIds();
    if (ids.size && !nameInput.dataset.userEdited) {
      nameInput.value = suggestName(ids);
    }
  }

  function bindListEvents() {
    listEl.querySelectorAll('.manual-merge-check').forEach((cb) => {
      cb.addEventListener('change', syncNameSuggestion);
    });
  }

  bindListEvents();

  nameInput.addEventListener('input', () => {
    nameInput.dataset.userEdited = nameInput.value.trim() ? '1' : '';
  });

  categorySelect.addEventListener('change', () => {
    listEl.innerHTML = renderProductOptions(Number(categorySelect.value));
    nameInput.value = '';
    nameInput.dataset.userEdited = '';
    bindListEvents();
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  document.getElementById('confirm-manual-merge')?.addEventListener('click', async () => {
    const ids = [...getCheckedIds()];
    const name = nameInput.value.trim();
    if (ids.length < 2) {
      showToast('יש לבחור לפחות 2 מוצרים');
      return;
    }
    if (!name) {
      showToast('יש להזין שם למוצר המאוחד');
      return;
    }

    const btn = document.getElementById('confirm-manual-merge');
    btn.disabled = true;
    btn.textContent = 'מאחד...';
    try {
      const result = await mergeSelectedProducts(ids, name);
      closeModal();
      await toastAfterMerge(result);
      renderProducts(container);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'אחד מוצרים';
      showToast(err.message || 'שגיאה באיחוד');
    }
  });
}

async function showMergeDuplicatesModal(container) {
  const groups = await findDuplicateProductGroups();

  if (!groups.length) {
    openModal({
      title: 'איחוד כפילויות',
      bodyHTML: '<p style="line-height:1.6;color:var(--text-muted)">לא נמצאו כפילויות 🎉</p>',
      footerHTML: '<button class="btn btn-primary modal-cancel">סגור</button>',
    });
    document.querySelector('.modal-cancel').addEventListener('click', closeModal);
    return;
  }

  const totalDups = groups.reduce((s, g) => s + g.products.length - 1, 0);
  const groupsHtml = groups.map((g, gi) => {
    const radios = g.products.map((p, pi) => `
      <label class="merge-product-option">
        <input type="radio" name="merge-keep-${gi}" value="${p.id}" ${pi === 0 ? 'checked' : ''}>
        <span>
          <strong>${escapeHtml(p.name)}</strong>
          <span class="merge-product-meta">${p.entryCount} רישומים · ${p.totalQty} יח'</span>
        </span>
      </label>`).join('');

    return `
      <div class="merge-group" data-group="${gi}">
        <div class="merge-group-title">${escapeHtml(g.categoryName)} · ${escapeHtml(g.name)}</div>
        <p class="form-hint">בחר איזה מוצר לשמור — השאר יאוחדו אליו:</p>
        ${radios}
      </div>`;
  }).join('');

  openModal({
    title: 'איחוד כפילויות',
    bodyHTML: `
      <p style="margin-bottom:12px;line-height:1.5">
        נמצאו <strong>${groups.length}</strong> קבוצות · <strong>${totalDups}</strong> כפילויות
      </p>
      <div class="merge-groups-list">${groupsHtml}</div>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="merge-all-auto">אחד הכל (אוטומטי)</button>
      <button class="btn btn-primary" id="merge-selected">אחד לפי בחירה</button>`,
  });

  document.querySelector('.modal-cancel').addEventListener('click', closeModal);

  document.getElementById('merge-all-auto').addEventListener('click', async () => {
    try {
      const result = await mergeAllDuplicateProducts();
      closeModal();
      await toastAfterMerge(result);
      renderProducts(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('merge-selected').addEventListener('click', async () => {
    try {
      let merged = 0;
      let lastResult = null;
      for (let gi = 0; gi < groups.length; gi++) {
        const keepId = Number(document.querySelector(`input[name="merge-keep-${gi}"]:checked`)?.value);
        if (!keepId) continue;
        const others = groups[gi].products.map((p) => p.id).filter((id) => id !== keepId);
        lastResult = await mergeProducts(keepId, others);
        merged += lastResult.merged;
      }
      closeModal();
      await toastAfterMerge(lastResult || { qtyBefore: 0 });
      renderProducts(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

function showCategoryPriceModal(container, { id, name, productCount, currentPrice, priceUnit }) {
  openModal({
    title: `מחיר אחיד — ${name}`,
    bodyHTML: `
      <p class="form-hint" style="margin-bottom:12px;line-height:1.5">
        המחיר יוחל על <strong>${productCount}</strong> מוצרים בקטגוריה.
        אפשר לערוך מחיר לכל מוצר בנפרד בכפתור ✏️.
      </p>
      ${priceUnitFieldsHTML('cat', { unitPrice: currentPrice, priceUnit: priceUnit || 'unit', hintScope: 'category' })}`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-cat-price">שמור לכל המוצרים</button>`,
  });

  bindPriceUnitFields('cat', { hintScope: 'category' });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-cat-price')?.addEventListener('click', async () => {
    const raw = document.getElementById('cat-price').value;
    if (raw === '') return showToast('יש להזין מחיר');
    const unit = document.querySelector('input[name="cat-price-unit"]:checked')?.value || 'unit';
    try {
      const count = await setCategoryUnitPrice(id, raw, unit);
      closeModal();
      showToast(`מחיר עודכן ל-${count} מוצרים ✓`);
      renderProducts(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

function showGroupForm(container, existing) {
  Promise.all([getProductsCatalogLayout(), getCategoryGroups()]).then(([layout, groups]) => {
    const groupId = existing?.id ? Number(existing.id) : null;
    const assigned = new Set(
      layout.allCategories.filter((c) => Number(c.groupId) === groupId).map((c) => c.id),
    );
    const initialColor = existing?.color || defaultColorForIndex(groups.length);

    openModal({
      title: existing ? 'עריכת קטגוריה כללית' : 'קטגוריה כללית חדשה',
      bodyHTML: `
        <p class="form-hint" style="margin-bottom:12px;line-height:1.5">
          קטגוריה כללית מארגנת כמה קטגוריות תחתיה — המוצרים נשארים בקטגוריות הרגילות.
        </p>
        <div class="form-group">
          <label for="group-name">שם הקבוצה</label>
          <input type="text" id="group-name" value="${existing ? escapeHtml(existing.name) : ''}" placeholder="לדוגמה: מאפים">
        </div>
        ${renderColorPickerFields(initialColor, 'group')}
        <div class="form-group">
          <label>קטגוריות בקבוצה</label>
          <div class="group-category-checklist">
            ${layout.allCategories.length === 0
              ? '<p class="form-hint">אין קטגוריות — הוסף קטגוריה קודם</p>'
              : layout.allCategories.map((cat) => {
                const inOtherGroup = cat.groupId && Number(cat.groupId) !== groupId;
                return `
                  <label class="group-category-option${inOtherGroup ? ' is-disabled' : ''}">
                    <input type="checkbox" name="group-cats" value="${cat.id}"
                      ${assigned.has(cat.id) ? 'checked' : ''}
                      ${inOtherGroup ? 'disabled' : ''}>
                    <span>${escapeHtml(cat.name)}</span>
                    ${inOtherGroup ? '<span class="form-hint">(בקבוצה אחרת)</span>' : ''}
                  </label>`;
              }).join('')}
          </div>
        </div>`,
      footerHTML: `
        <button class="btn btn-secondary modal-cancel">ביטול</button>
        <button class="btn btn-primary" id="save-group">שמור</button>`,
    });

    const colorInput = bindColorPickerInModal('group');
    document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('save-group')?.addEventListener('click', async () => {
      const name = document.getElementById('group-name').value.trim();
      if (!name) return showToast('יש להזין שם');
      const color = colorInput?.value || initialColor;
      const selected = [...document.querySelectorAll('input[name="group-cats"]:checked')].map((el) => Number(el.value));
      try {
        let id = groupId;
        if (existing) {
          await updateCategoryGroup(id, { name, color });
        } else {
          id = await addCategoryGroup(name, color);
        }
        await setCategoriesInGroup(id, selected);
        closeModal();
        showToast('נשמר ✓');
        renderProducts(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });
}

function confirmDeleteGroup(container, { id, name, categoryCount }) {
  openModal({
    title: 'מחיקת קטגוריה כללית',
    bodyHTML: `
      <p style="line-height:1.6">למחוק את <strong>${escapeHtml(name)}</strong>?</p>
      <p class="form-hint">${categoryCount} קטגוריות יועברו ל«ללא קבוצה» · המוצרים לא יימחקו.</p>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-danger" id="confirm-delete-group">מחק</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('confirm-delete-group')?.addEventListener('click', async () => {
    try {
      await deleteCategoryGroup(id);
      expandedGroups.delete(id);
      closeModal();
      showToast('נמחק ✓');
      renderProducts(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

function showCategoryForm(container, existing) {
  Promise.all([getCategoryGroups(), getProductsCatalogLayout()]).then(([groups]) => {
  const initialColor = existing?.color || defaultColorForIndex(existing?.id ? Number(existing.id) - 1 : 0);
  const groupOptions = [
    '<option value="">ללא קבוצה</option>',
    ...groups.map((g) => `<option value="${g.id}" ${String(existing?.groupId || '') === String(g.id) ? 'selected' : ''}>${escapeHtml(g.name)}</option>`),
  ].join('');

  openModal({
    title: existing ? 'עריכת קטגוריה' : 'קטגוריה חדשה',
    bodyHTML: `
      <div class="form-group">
        <label for="cat-name">שם קטגוריה</label>
        <input type="text" id="cat-name" value="${existing ? escapeHtml(existing.name) : ''}" placeholder="לדוגמה: שטרודל">
      </div>
      <div class="form-group">
        <label for="cat-group">קטגוריה כללית</label>
        <select id="cat-group">${groupOptions}</select>
      </div>
      ${renderColorPickerFields(initialColor)}`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-cat">שמור</button>`,
  });

  const colorInput = bindColorPickerInModal();

  document.querySelector('.modal-cancel').addEventListener('click', closeModal);
  document.getElementById('save-cat').addEventListener('click', async () => {
    const name = document.getElementById('cat-name').value.trim();
    if (!name) return showToast('יש להזין שם');
    const color = colorInput?.value || initialColor;
    const groupId = document.getElementById('cat-group').value || null;
    try {
      if (existing) {
        await updateCategory(Number(existing.id), { name, color, groupId });
      } else {
        await addCategory(name, color, groupId);
      }
      closeModal();
      showToast('נשמר ✓');
      renderProducts(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
  });
}

function priceUnitFieldsHTML(prefix, opts = {}) {
  const isKg = opts.priceUnit === 'kg';
  const hint = opts.hintScope === 'category'
    ? (isKg ? 'כל המוצרים בקטגוריה יימכרו לפי משקל (ק"ג)' : 'כל המוצרים בקטגוריה יימכרו לפי יחידה')
    : (isKg ? 'ברישום ייצור יזינו משקל בק"ג (2.5, 0.8...)' : 'ברישום ייצור יזינו מספר יחידות');
  return `
      <div class="form-group">
        <label>תמחור מכירה</label>
        <div class="price-unit-options" data-price-unit-group="${prefix}" role="radiogroup" aria-label="תמחור מכירה">
          <label class="price-unit-option${!isKg ? ' is-selected' : ''}">
            <input type="radio" name="${prefix}-price-unit" value="unit" ${!isKg ? 'checked' : ''}>
            <span class="price-unit-option-title">לפי יחידה</span>
            <span class="price-unit-option-sub">₪ לכל יחידה / מנה</span>
          </label>
          <label class="price-unit-option${isKg ? ' is-selected' : ''}">
            <input type="radio" name="${prefix}-price-unit" value="kg" ${isKg ? 'checked' : ''}>
            <span class="price-unit-option-title">לפי משקל</span>
            <span class="price-unit-option-sub">₪ לכל ק"ג</span>
          </label>
        </div>
      </div>
      <div class="form-group">
        <label for="${prefix}-price" id="${prefix}-price-label">מחיר ללקוח (${isKg ? '₪/ק"ג' : '₪/יח\''})</label>
        <input type="number" id="${prefix}-price" min="0" step="${isKg ? '0.01' : '0.5'}" value="${opts.unitPrice != null && opts.unitPrice !== '' ? opts.unitPrice : ''}" placeholder="${isKg ? 'לדוגמה: 45' : 'לדוגמה: 25'}">
        <p class="form-hint" id="${prefix}-price-hint">${hint}</p>
      </div>`;
}

function bindPriceUnitFields(prefix, opts = {}) {
  const root = document.getElementById('modal-body');
  if (!root) return;
  const priceInput = root.querySelector(`#${prefix}-price`);
  const priceLabel = root.querySelector(`#${prefix}-price-label`);
  const priceHint = root.querySelector(`#${prefix}-price-hint`);
  const optionGroup = root.querySelector(`[data-price-unit-group="${prefix}"]`);
  const sync = () => {
    const isKg = root.querySelector(`input[name="${prefix}-price-unit"]:checked`)?.value === 'kg';
    optionGroup?.querySelectorAll('.price-unit-option').forEach((el) => {
      el.classList.toggle('is-selected', el.querySelector('input')?.checked);
    });
    if (priceLabel) priceLabel.textContent = `מחיר ללקוח (${isKg ? '₪/ק"ג' : '₪/יח\''})`;
    if (priceHint) {
      priceHint.textContent = opts.hintScope === 'category'
        ? (isKg ? 'כל המוצרים בקטגוריה יימכרו לפי משקל (ק"ג)' : 'כל המוצרים בקטגוריה יימכרו לפי יחידה')
        : (isKg ? 'ברישום ייצור יזינו משקל בק"ג (2.5, 0.8...)' : 'ברישום ייצור יזינו מספר יחידות');
    }
    if (priceInput) {
      priceInput.step = isKg ? '0.01' : '0.5';
      priceInput.placeholder = isKg ? 'לדוגמה: 45' : 'לדוגמה: 25';
    }
  };
  root.querySelectorAll(`input[name="${prefix}-price-unit"]`).forEach((radio) => {
    radio.addEventListener('change', sync);
  });
  sync();
}

function productPriceUnitFieldsHTML(opts = {}) {
  const mode = opts.priceUnit || 'unit';
  const isUnit = mode === 'unit';
  const isKg = mode === 'kg';
  const isKgUnits = mode === 'kg_units';
  const isKgWithUnits = mode === 'kg_with_units';
  const showWeightField = isKgUnits || isKgWithUnits;
  const priceSuffix = isUnit ? '₪/יח\'' : '₪/ק"ג';
  return `
      <div class="form-group">
        <label>תמחור ורישום ייצור</label>
        <div class="price-unit-options price-unit-options--triple" data-price-unit-group="prod" role="radiogroup" aria-label="תמחור ורישום">
          <label class="price-unit-option${isUnit ? ' is-selected' : ''}">
            <input type="radio" name="prod-price-unit" value="unit" ${isUnit ? 'checked' : ''}>
            <span class="price-unit-option-title">לפי יחידה</span>
            <span class="price-unit-option-sub">מחיר ורישום ביחידות</span>
          </label>
          <label class="price-unit-option${isKg ? ' is-selected' : ''}">
            <input type="radio" name="prod-price-unit" value="kg" ${isKg ? 'checked' : ''}>
            <span class="price-unit-option-title">לפי משקל</span>
            <span class="price-unit-option-sub">מחיר ורישום בק"ג</span>
          </label>
          <label class="price-unit-option${isKgWithUnits ? ' is-selected' : ''}">
            <input type="radio" name="prod-price-unit" value="kg_with_units" ${isKgWithUnits ? 'checked' : ''}>
            <span class="price-unit-option-title">משקל + יחידות</span>
            <span class="price-unit-option-sub">רישום ותמחור בק"ג · הצגת יחידות</span>
          </label>
          ${isKgUnits ? `
          <label class="price-unit-option is-selected">
            <input type="radio" name="prod-price-unit" value="kg_units" checked>
            <span class="price-unit-option-title">יחידות (מצב קיים)</span>
            <span class="price-unit-option-sub">רישום ביחידות · מחיר לק"ג</span>
          </label>` : ''}
        </div>
      </div>
      <div class="form-group${showWeightField ? '' : ' hidden'}" id="prod-unit-weight-group">
        <label for="prod-unit-weight">משקל ממוצע ליחידה (ק"ג)</label>
        <input type="number" id="prod-unit-weight" min="0.001" step="0.001" value="${opts.unitWeightKg != null && opts.unitWeightKg !== '' ? opts.unitWeightKg : ''}" placeholder="לדוגמה: 0.8">
        <p class="form-hint" id="prod-unit-weight-hint">${isKgWithUnits
    ? 'יוצג גם כמות יחידות (משקל ÷ משקל ליחידה)'
    : 'לחישוב ערך: יחידות × משקל ממוצע × מחיר לק"ג'}</p>
      </div>
      <div class="form-group">
        <label for="prod-price" id="prod-price-label">מחיר ללקוח (${priceSuffix})</label>
        <input type="number" id="prod-price" min="0" step="${isUnit ? '0.5' : '0.01'}" value="${opts.unitPrice != null && opts.unitPrice !== '' ? opts.unitPrice : ''}" placeholder="${isUnit ? 'לדוגמה: 25' : 'לדוגמה: 45'}">
        <p class="form-hint" id="prod-price-hint">${isKgWithUnits
    ? 'ברישום ייצור יזינו משקל בק"ג; יוצג גם מספר יחידות משוער'
    : isKgUnits
      ? 'ברישום ייצור יזינו מספר יחידות; המחיר ללקוח לפי ק"ג'
      : isKg
        ? 'ברישום ייצור יזינו משקל בק"ג (2.5, 0.8...)'
        : 'ברישום ייצור יזינו מספר יחידות'}</p>
      </div>`;
}

function bindProductPriceUnitFields() {
  const root = document.getElementById('modal-body');
  if (!root) return;
  const priceInput = root.querySelector('#prod-price');
  const priceLabel = root.querySelector('#prod-price-label');
  const priceHint = root.querySelector('#prod-price-hint');
  const weightGroup = root.querySelector('#prod-unit-weight-group');
  const optionGroup = root.querySelector('[data-price-unit-group="prod"]');
  const weightHint = root.querySelector('#prod-unit-weight-hint');
  const sync = () => {
    const mode = root.querySelector('input[name="prod-price-unit"]:checked')?.value || 'unit';
    const isUnit = mode === 'unit';
    const isKgUnits = mode === 'kg_units';
    const isKgWithUnits = mode === 'kg_with_units';
    const showWeight = isKgUnits || isKgWithUnits;
    optionGroup?.querySelectorAll('.price-unit-option').forEach((el) => {
      el.classList.toggle('is-selected', el.querySelector('input')?.checked);
    });
    weightGroup?.classList.toggle('hidden', !showWeight);
    if (priceLabel) priceLabel.textContent = `מחיר ללקוח (${isUnit ? '₪/יח\'' : '₪/ק"ג'})`;
    if (weightHint) {
      weightHint.textContent = isKgWithUnits
        ? 'יוצג גם כמות יחידות (משקל ÷ משקל ליחידה)'
        : 'לחישוב ערך: יחידות × משקל ממוצע × מחיר לק"ג';
    }
    if (priceHint) {
      priceHint.textContent = isKgWithUnits
        ? 'ברישום ייצור יזינו משקל בק"ג; יוצג גם מספר יחידות משוער'
        : isKgUnits
          ? 'ברישום ייצור יזינו מספר יחידות; המחיר ללקוח לפי ק"ג'
          : mode === 'kg'
            ? 'ברישום ייצור יזינו משקל בק"ג (2.5, 0.8...)'
            : 'ברישום ייצור יזינו מספר יחידות';
    }
    if (priceInput) {
      priceInput.step = isUnit ? '0.5' : '0.01';
      priceInput.placeholder = isUnit ? 'לדוגמה: 25' : 'לדוגמה: 45';
    }
  };
  root.querySelectorAll('input[name="prod-price-unit"]').forEach((radio) => {
    radio.addEventListener('change', sync);
  });
  sync();
}

function optionalPriceInput(id, label, value, { nested = false } = {}) {
  const inner = `
      <label for="${id}">${label} <span style="font-weight:400;color:var(--text-muted)">(רשות)</span></label>
      <input type="number" id="${id}" min="0" step="0.5" value="${value != null && value !== '' ? value : ''}" placeholder="—">`;
  return nested ? inner : `<div class="form-group">${inner}
    </div>`;
}

function rawMaterialsCostSourceFieldsHTML(opts = {}) {
  const source = opts.rawMaterialsCostSource || 'recipes';
  const isManual = source === 'manual';
  const previewText = opts.rawMaterialsCostPreview != null ? formatMoney(opts.rawMaterialsCostPreview) : '—';
  return `
      <div class="form-group">
        <label>מחיר חומרי גלם</label>
        <div class="price-unit-options" data-cost-source-group role="radiogroup" aria-label="מקור מחיר חומרי גלם">
          <label class="price-unit-option${!isManual ? ' is-selected' : ''}">
            <input type="radio" name="prod-raw-source" value="recipes" ${!isManual ? 'checked' : ''}>
            <span class="price-unit-option-title">מהמתכונים</span>
            <span class="price-unit-option-sub">ברירת מחדל · חישוב מהרכב המוצר</span>
          </label>
          <label class="price-unit-option${isManual ? ' is-selected' : ''}">
            <input type="radio" name="prod-raw-source" value="manual" ${isManual ? 'checked' : ''}>
            <span class="price-unit-option-title">ידני</span>
            <span class="price-unit-option-sub">ביטול חישוב אוטומטי · הזנה ידנית</span>
          </label>
        </div>
      </div>
      <div class="form-group${isManual ? '' : ' hidden'}" id="prod-raw-manual-group">
        ${optionalPriceInput('prod-raw', 'סכום (₪)', opts.rawMaterialsCost, { nested: true })}
      </div>
      <div class="form-group${isManual ? ' hidden' : ''}" id="prod-raw-recipes-preview">
        <label>עלות מחושבת (מחירי ספק)</label>
        <p class="product-raw-cost-preview" id="prod-raw-preview-value">${previewText}</p>
        <p class="form-hint">מתעדכן אוטומטית מהרכב המוצר במסך פרטי מוצר</p>
      </div>`;
}

function bindRawMaterialsCostSourceFields({ productId } = {}) {
  const root = document.querySelector('[data-cost-source-group]');
  if (!root) return;

  const manualGroup = document.getElementById('prod-raw-manual-group');
  const recipesGroup = document.getElementById('prod-raw-recipes-preview');
  const previewEl = document.getElementById('prod-raw-preview-value');

  const sync = async () => {
    const isManual = root.querySelector('input[name="prod-raw-source"]:checked')?.value !== 'recipes';
    manualGroup?.classList.toggle('hidden', !isManual);
    recipesGroup?.classList.toggle('hidden', isManual);
    root.querySelectorAll('.price-unit-option').forEach((opt) => {
      opt.classList.toggle('is-selected', opt.querySelector('input')?.checked);
    });
    if (!isManual && productId && previewEl) {
      try {
        const detail = await getProductDetail(productId);
        previewEl.textContent = formatMoney(detail.recommendedCost);
      } catch {
        previewEl.textContent = '—';
      }
    }
  };

  root.querySelectorAll('input[name="prod-raw-source"]').forEach((radio) => {
    radio.addEventListener('change', sync);
  });
  sync();
}

async function showProductForm(container, opts) {
  let rawMaterialsCostPreview = null;
  if (opts.id && (opts.rawMaterialsCostSource === 'recipes' || isProductRecipesCostSource(opts))) {
    try {
      const detail = await getProductDetail(opts.id);
      rawMaterialsCostPreview = detail.recommendedCost;
    } catch { /* preview unavailable */ }
  }

  const [layout, packagingMaterials, suppliers] = await Promise.all([
    getProductsCatalogLayout(),
    getPackagingMaterials(),
    getSuppliers(),
  ]);
  const categories = layout.allCategories.map((c) => ({ id: c.id, name: c.name }));
  const selectedPackId = Number(opts.packagingMaterialId) || '';
  const selectedPack = selectedPackId
    ? packagingMaterials.find((m) => m.id === selectedPackId)
    : null;
  const packingOptions = packagingMaterials.map((m) => {
    const sup = suppliers.find((s) => s.id === m.supplierId)?.name || '';
    const kind = m.packagingKind ? getPackagingKindLabel(m.packagingKind) : 'אריזה';
    const qty = m.packProductsPerUnit ? ` · ${m.packProductsPerUnit} יח'/קרטון` : '';
    const label = `${m.name}${sup ? ` — ${sup}` : ''} (${kind}${qty})`;
    return `<option value="${m.id}"${selectedPackId === m.id ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');

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
      ${productPriceUnitFieldsHTML(opts)}
      <div class="form-group">
        <label for="prod-packaging-material">אריזה מספקים</label>
        <select id="prod-packaging-material">
          <option value="">— ללא שיוך —</option>
          ${packingOptions}
        </select>
        <p class="form-hint">שיוך לקרטון/אריזה מרשימת הספקים</p>
      </div>
      <div class="form-group">
        <label for="prod-units-per-carton">יחידות בקרטון</label>
        <input type="number" id="prod-units-per-carton" min="1" step="1" inputmode="numeric"
          value="${opts.unitsPerCarton != null && opts.unitsPerCarton !== '' ? opts.unitsPerCarton : (selectedPack?.packProductsPerUnit || '')}"
          placeholder="לדוגמה: 12">
        <p class="form-hint">כמה יחידות אורזים בקרטון אחד · מסונכרן עם האריזה המשויכת</p>
      </div>
      ${rawMaterialsCostSourceFieldsHTML({ ...opts, rawMaterialsCostPreview })}
      ${optionalPriceInput('prod-pack', 'מחיר אריזה (₪)', opts.packagingCost)}
      <p class="form-hint" id="prod-pack-cost-hint" style="margin-top:-6px"></p>
      ${optionalPriceInput('prod-extra', 'עלויות נוספות (₪)', opts.additionalCosts)}`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-prod">שמור</button>`,
  });

  bindProductPriceUnitFields();
  bindRawMaterialsCostSourceFields({ productId: opts.id });

  const packSelect = document.getElementById('prod-packaging-material');
  const unitsInput = document.getElementById('prod-units-per-carton');
  const packCostInput = document.getElementById('prod-pack');
  const packCostHint = document.getElementById('prod-pack-cost-hint');
  const syncPackagingFromSelect = ({ fillCost = false } = {}) => {
    const mid = Number(packSelect?.value);
    const mat = mid ? packagingMaterials.find((m) => m.id === mid) : null;
    if (mat?.packProductsPerUnit && unitsInput && !unitsInput.value) {
      unitsInput.value = String(mat.packProductsPerUnit);
    }
    if (mat?.packProductsPerUnit && unitsInput && document.activeElement !== unitsInput) {
      /* keep user value if already set */
    }
    const cost = mat ? computePackagingCostPerProduct(mat) : null;
    if (packCostHint) {
      packCostHint.textContent = cost != null
        ? `עלות אריזה מחושבת מהספקים: ${formatMoney(cost)} (לחיצה על «מלא מחישוב» תעדכן)`
        : (mat ? 'לא ניתן לחשב עלות — חסר מחיר/כמות באריזה' : '');
    }
    if (fillCost && cost != null && packCostInput) {
      packCostInput.value = String(cost);
    }
  };
  packSelect?.addEventListener('change', () => {
    const mid = Number(packSelect.value);
    const mat = mid ? packagingMaterials.find((m) => m.id === mid) : null;
    if (mat?.packProductsPerUnit && unitsInput) {
      unitsInput.value = String(mat.packProductsPerUnit);
    }
    syncPackagingFromSelect({ fillCost: true });
  });
  syncPackagingFromSelect();

  document.querySelector('.modal-cancel').addEventListener('click', closeModal);
  document.getElementById('save-prod').addEventListener('click', async () => {
    const name = document.getElementById('prod-name').value.trim();
    if (!name) return showToast('יש להזין שם מוצר');

    const rawMaterialsCostSource = document.querySelector('input[name="prod-raw-source"]:checked')?.value || 'recipes';
    const packagingMaterialId = document.getElementById('prod-packaging-material')?.value || null;
    const unitsPerCarton = document.getElementById('prod-units-per-carton')?.value ?? '';
    const data = {
      name,
      categoryId: Number(document.getElementById('prod-cat').value),
      unitPrice: document.getElementById('prod-price').value,
      priceUnit: document.querySelector('input[name="prod-price-unit"]:checked')?.value || 'unit',
      unitWeightKg: document.getElementById('prod-unit-weight')?.value ?? '',
      unitsPerCarton,
      packagingMaterialId,
      rawMaterialsCostSource,
      packagingCost: document.getElementById('prod-pack').value,
      additionalCosts: document.getElementById('prod-extra').value,
    };
    if (rawMaterialsCostSource === 'recipes') {
      if (opts.id) {
        try {
          const detail = await getProductDetail(opts.id);
          data.rawMaterialsCost = detail.recommendedCost;
        } catch {
          data.rawMaterialsCost = opts.rawMaterialsCost ?? 0;
        }
      } else {
        data.rawMaterialsCost = 0;
      }
    } else {
      data.rawMaterialsCost = document.getElementById('prod-raw').value;
    }
    if (data.priceUnit === 'kg_with_units' && !Number(data.unitWeightKg)) {
      return showToast('הזן משקל ממוצע ליחידה');
    }

    try {
      let productId = opts.id;
      if (opts.id) await updateProduct(opts.id, data);
      else productId = await addProduct(data);
      await syncProductPackagingToMaterial(productId, {
        packagingMaterialId,
        unitsPerCarton,
        syncCost: false,
      });
      expandCategory(data.categoryId);
      closeModal();
      showToast('נשמר ✓');
      renderProducts(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

export function productsMeta(container) {
  const mode = getProductsMode(container || document.getElementById('main-content'));
  if (mode === 'build') {
    return { title: 'מוצרים', subtitle: 'עריכה ובנייה · פרופיל מלא, קטגוריות ושיוכים' };
  }
  return { title: 'מוצרים', subtitle: 'מוצרים מוגמרים · תצוגה נוחה' };
}

function showImportError(message) {
  openModal({
    title: 'שגיאה בייבוא',
    bodyHTML: `<p style="white-space:pre-line;font-size:0.9rem;line-height:1.6;color:var(--text)">${escapeHtml(message)}</p>`,
    footerHTML: `<button class="btn btn-primary modal-cancel">הבנתי</button>`,
  });
  document.querySelector('.modal-cancel').addEventListener('click', closeModal);
}
