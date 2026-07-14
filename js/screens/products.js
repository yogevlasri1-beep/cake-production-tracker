import {
  getProductsCatalogLayout, getCategories, getCategoryGroups, addCategory, updateCategory, deleteCategory,
  addCategoryGroup, updateCategoryGroup, deleteCategoryGroup, setCategoriesInGroup,
  addProduct, updateProduct, toggleProductActive, getProduct, resetAllData,
  importCatalogRows, importProductionRows, setProductOrderInCategory, setCategoryOrderInContainer, setCategoryGroupOrder, setCategoryUnitPrice,
  findDuplicateProductGroups, mergeProducts, mergeAllDuplicateProducts,
  getProductsWithEntryStats, mergeSelectedProducts,
  getLinkedFlowsForProduct, getCandidateFlowsForProduct, setProductFlowLinks,
} from '../db.js?v=294';
import {
  getProductDetail,
  addProductRecipeComponent,
  updateProductRecipeComponent, deleteProductRecipeComponent,
  getRecipesCatalogLayout, getBakingProfiles, getProductBakingProfileLink,
  linkProductToBakingProfile, unlinkProductFromBakingProfile, syncProductCostFromComposition,
  syncProductCostIfRecipesMode, isProductRecipesCostSource,
  formatRecipeBakingParamsLine, resolveRecipeBaking, getRecipeOvenLabel, formatKgWeight,
  recipeTotalWeightGrams,
} from '../kitchen-db.js?v=294';
import { formatMoney, showToast, escapeHtml, productUnitLabel, productPriceUnitLabel, formatDecimal } from '../utils.js?v=294';
import { openModal, closeModal } from '../modal.js?v=294';
import { CATEGORY_COLOR_HEX, defaultColorForIndex } from '../chart.js?v=294';
import { bindProductDragLists, bindCategoryDragList, bindCategoryGroupDragList } from '../product-drag.js?v=294';
import { renderSheetsStatusHTML, bindSheetsStatusEvents } from '../sheets-flow.js?v=294';

const EXPANDED_CATS_KEY = 'yitzurExpandedCategories';
const EXPANDED_GROUPS_KEY = 'yitzurExpandedCategoryGroups';

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
  const cost = (p.rawMaterialsCost || 0) + (p.packagingCost || 0) + (p.additionalCosts || 0);
  if (cost > 0) parts.push(`עלות: ${formatMoney(cost)}`);
  return parts.length ? parts.join(' · ') : 'ללא מחירים';
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

function renderProductItem(p, index) {
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

function renderCategoryCard(cat, catIndex) {
  const uniform = categoryUniformPricing(cat.products);
  const isExpanded = expandedCategories.has(cat.id);
  const unitPriceAttrs = `data-id="${cat.id}" data-name="${escapeHtml(cat.name)}" data-price="${uniform?.price ?? ''}" data-price-unit="${uniform?.priceUnit ?? 'unit'}" data-count="${cat.products.length}"`;
  const unitPriceBtn = `<button type="button" class="btn btn-secondary btn-sm cat-unit-price-btn" ${unitPriceAttrs}>💰 מחיר אחיד</button>`;
  const priceBadge = uniform != null
    ? `<span class="category-price-badge">${formatMoney(uniform.price)}/${uniformPriceUnitLabel(uniform.priceUnit)}</span>`
    : '';
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
          : `<p class="product-drag-hint">גרור ⠿ לשינוי סדר · ✏️ לעריכת מחיר למוצר בודד</p>
             <div class="product-list" data-category-id="${cat.id}">${cat.products.map((p, i) => renderProductItem(p, i)).join('')}</div>`}
      </div>
    </div>`;
}

function renderGroupCard(group, groupIndex, categories) {
  const totalProducts = categories.reduce((s, c) => s + c.products.length, 0);
  const isExpanded = expandedGroups.has(group.id);
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
          : `<div class="category-list" data-group-id="${group.id}">${categories.map((cat, i) => renderCategoryCard(cat, i)).join('')}</div>`}
      </div>
    </div>`;
}

function renderCatalogHTML(layout) {
  const { groups, ungrouped } = layout;
  if (!layout.allCategories.length) return '';

  const parts = [];
  if (groups.length) {
    parts.push(`
      <p class="product-drag-hint">קטגוריות כלליות — לחץ לפתיחה · גרור ⠿ לשינוי סדר</p>
      <div class="category-group-list">
        ${groups.map((g, i) => renderGroupCard(g, i, g.categories)).join('')}
      </div>`);
  }
  if (ungrouped.length) {
    parts.push(`
      ${groups.length ? '<h3 class="catalog-section-title">קטגוריות ללא קבוצה</h3>' : '<p class="product-drag-hint">לחץ על קטגוריה לפתיחה · גרור ⠿ לשינוי סדר</p>'}
      <div class="category-list" data-group-id="">
        ${ungrouped.map((cat, i) => renderCategoryCard(cat, i)).join('')}
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
  const sheetsHTML = await renderSheetsStatusHTML();
  const layout = await getProductsCatalogLayout();

  container.innerHTML = `
    <div class="section-header products-toolbar">
      <h2>קטגוריות ומוצרים</h2>
      <div class="products-toolbar-actions">
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

    ${layout.allCategories.length === 0
      ? `<div class="empty-state">
          <div class="empty-state-icon">📦</div>
          <p>התחל מאפס — הוסף קטגוריה ראשונה<br>או צור קטגוריה כללית לארגון קבוצות.</p>
          <button class="btn btn-primary" id="add-category-empty">+ הוסף קטגוריה</button>
        </div>`
      : renderCatalogHTML(layout)}

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

    <button class="btn btn-danger btn-sm" id="reset-all" style="width:100%;margin-top:12px">🔄 איפוס — התחלה מאפס</button>`;

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
    const { navigate } = await import('../app.js?v=294');
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

function gramsToKgInput(grams) {
  if (grams == null || grams === '' || Number(grams) <= 0) return '';
  return formatDecimal(Number(grams) / 1000);
}

function parseCompositionKgInput(val) {
  const trimmed = String(val ?? '').trim();
  if (!trimmed) return null;
  const kg = Number(trimmed);
  if (!Number.isFinite(kg) || kg <= 0) return null;
  return Math.round(kg * 1000);
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

function buildProductDetailHTML(detail, { allRecipes, bakingProfiles, profileMap, linkedFlows = [], candidateFlows = [] }) {
  const { product, category, components, linkedRecipes, bakingProfile, bakingProfileLink, totalWeightGrams } = detail;
  const totalWeightText = totalWeightGrams > 0 ? formatKgWeight(totalWeightGrams / 1000) : '—';
  const usedRecipeIds = new Set(components.map((c) => c.recipeId));
  const availableRecipes = allRecipes.filter((r) => !usedRecipeIds.has(r.id));
  const quickAddRecipes = linkedRecipes.filter((r) => !usedRecipeIds.has(r.id));

  const compositionRows = components.length
    ? components.map((comp) => {
      const defaultG = comp.recipeTotalGrams || 0;
      const weightKg = gramsToKgInput(comp.weightGrams);
      const placeholderKg = defaultG > 0 ? formatDecimal(defaultG / 1000) : '';
      return `
        <div class="product-composition-row" data-component-id="${comp.id}">
          <div class="product-composition-main">
            <span class="product-composition-name">${escapeHtml(comp.recipe?.name || 'מתכון')}</span>
            <span class="product-composition-meta">בסיס: ${formatCompositionKg(defaultG)}</span>
          </div>
          <label class="product-composition-weight">
            <span>ק"ג</span>
            <input type="number" class="product-comp-weight-input" data-id="${comp.id}" min="0.001" step="0.001"
              value="${weightKg}" placeholder="${placeholderKg}">
          </label>
          <span class="product-composition-cost" title="עלות ספק">${formatMoney(comp.supplierCost)}</span>
          <button type="button" class="btn btn-danger btn-sm product-comp-remove" data-id="${comp.id}" title="הסר">🗑</button>
        </div>`;
    }).join('')
    : '<p class="recipe-sheet-empty">אין רכיבים — הוסף מתכון מהרשימה</p>';

  const quickAddBanner = !components.length && quickAddRecipes.length
    ? `<div class="product-detail-quick-add">
        <p>מתכונים מקושרים למוצר:</p>
        <div class="product-detail-quick-add-btns">
          ${quickAddRecipes.map((r) => {
            const g = recipeTotalWeightGrams(r.ingredients);
            return `<button type="button" class="btn btn-secondary btn-sm product-quick-add-recipe" data-recipe-id="${r.id}" data-weight="${g || ''}">+ ${escapeHtml(r.name)}${g ? ` (${formatCompositionKg(g)})` : ''}</button>`;
          }).join('')}
        </div>
      </div>`
    : '';

  const recipeOptions = availableRecipes.length
    ? availableRecipes.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')
    : '<option value="" disabled>— אין מתכונים זמינים —</option>';

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

  const componentBakingRows = components.length
    ? components.map((comp) => {
      const baking = resolveRecipeBaking(comp.recipe, profileMap);
      const line = formatRecipeBakingParamsLine(comp.recipe, profileMap);
      if (!baking.hasBaking && !line) return '';
      return `<li><strong>${escapeHtml(comp.recipe?.name || '')}</strong>${line ? `: ${escapeHtml(line)}` : ''}${baking.bakeOvenType ? ` · ${escapeHtml(getRecipeOvenLabel(baking.bakeOvenType))}` : ''}</li>`;
    }).filter(Boolean).join('')
    : '';

  const marginHtml = detail.margin != null
    ? `<span class="product-detail-margin ${detail.margin >= 0 ? 'positive' : 'negative'}">רווח: ${formatMoney(detail.margin)}</span>`
    : '';

  const rawSource = detail.currentCosts.rawMaterialsCostSource || 'manual';
  const rawSourceLabel = rawSource === 'recipes' ? 'מהמתכונים' : 'ידני';
  const rawCostActions = rawSource === 'recipes'
    ? `<button type="button" class="btn btn-secondary btn-sm" id="product-switch-manual-cost" style="margin-top:10px">עבור להזנה ידנית</button>`
    : `<button type="button" class="btn btn-primary btn-sm" id="product-apply-recommended-cost" style="margin-top:10px">החל עלות מהמתכונים</button>`;

  const linkedFlowIds = new Set(linkedFlows.map((row) => row.flow.id));
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
          <span class="recipe-meta-pill">⚖️ ${totalWeightText}</span>
          ${product.active ? '' : '<span class="recipe-meta-pill">לא פעיל</span>'}
        </div>
      </header>

      <section class="recipe-sheet-section product-detail-section" aria-label="הרכב מוצר">
        <h2 class="recipe-sheet-section-title">הרכב מוצר</h2>
        ${quickAddBanner}
        <div class="product-composition-list">${compositionRows}</div>
        <div class="product-composition-add">
          <select id="product-add-recipe-select" class="product-add-recipe-select">
            <option value="">— בחר מתכון —</option>
            ${recipeOptions}
          </select>
          <button type="button" class="btn btn-secondary btn-sm" id="product-add-recipe-btn">+ הוסף</button>
        </div>
      </section>

      <section class="recipe-sheet-section product-detail-section" aria-label="אפייה">
        <h2 class="recipe-sheet-section-title">אפייה</h2>
        <div class="product-baking-product">
          <label for="product-baking-profile-select">פרופיל אפייה למוצר</label>
          <select id="product-baking-profile-select">
            <option value="">— ללא —</option>
            ${profileOptions}
          </select>
        </div>
        ${productBakingHtml}
        ${componentBakingRows ? `<div class="product-baking-recipes"><p class="product-detail-subtitle">מתכוני הרכב:</p><ul>${componentBakingRows}</ul></div>` : ''}
      </section>

      <section class="recipe-sheet-section product-detail-section" aria-label="תזרימי ייצור">
        <h2 class="recipe-sheet-section-title">תזרימי ייצור</h2>
        <p class="form-hint product-detail-subtitle">שיוך ישיר גובר על תזרים לפי קטגוריה. ניתן לשייך כמה תזרימים למוצר.</p>
        <div class="product-flow-links-list">${flowCheckboxes}</div>
        <button type="button" class="btn btn-primary btn-sm" id="product-save-flow-links" style="margin-top:10px">שמור שיוך תזרימים</button>
      </section>

      <section class="recipe-sheet-section product-detail-section" aria-label="תמחור">
        <h2 class="recipe-sheet-section-title">תמחור</h2>
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
            <span>אריזה</span>
            <span>${formatMoney(detail.currentCosts.packagingCost)}</span>
          </div>
          <div class="product-pricing-row">
            <span>עלויות נוספות</span>
            <span>${formatMoney(detail.currentCosts.additionalCosts)}</span>
          </div>
          <div class="product-pricing-row">
            <span>סה״כ עלות</span>
            <span>${formatMoney(detail.currentCosts.totalCost)}</span>
          </div>
          ${detail.currentCosts.unitPrice > 0 ? `
          <div class="product-pricing-row">
            <span>מחיר ללקוח</span>
            <span>${formatMoney(detail.currentCosts.unitPrice)}</span>
          </div>` : ''}
        </div>
        ${marginHtml}
        ${rawCostActions}
      </section>
    </article>`;
}

async function openProductDetailModal(container, productId) {
  let detail;
  let allRecipes = [];
  let bakingProfiles = [];
  let profileMap = new Map();

  let linkedFlows = [];
  let candidateFlows = [];

  async function loadContext() {
    const [d, layout, profiles, linked, candidates] = await Promise.all([
      getProductDetail(productId),
      getRecipesCatalogLayout(),
      getBakingProfiles(),
      getLinkedFlowsForProduct(productId),
      getCandidateFlowsForProduct(productId),
    ]);
    detail = d;
    linkedFlows = linked;
    candidateFlows = candidates;
    bakingProfiles = profiles;
    profileMap = new Map(profiles.map((p) => [p.id, p]));
    allRecipes = [];
    for (const group of layout.groups) {
      for (const cat of group.categories) {
        for (const r of cat.recipes) allRecipes.push(r);
      }
    }
    allRecipes.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }

  async function refreshModal() {
    await loadContext();
    const body = document.querySelector('.modal-body');
    if (body) body.innerHTML = buildProductDetailHTML(detail, { allRecipes, bakingProfiles, profileMap, linkedFlows, candidateFlows });
    bindProductDetailModalEvents(container, productId, refreshModal);
  }

  await loadContext();

  openModal({
    title: '',
    modalClass: 'modal-product-detail',
    bodyHTML: buildProductDetailHTML(detail, { allRecipes, bakingProfiles, profileMap, linkedFlows, candidateFlows }),
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">סגור</button>
      <button type="button" class="btn btn-primary" id="product-detail-edit">עריכת פרטים</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('product-detail-edit')?.addEventListener('click', async () => {
    closeModal();
    const p = await getProduct(productId);
    if (p) showProductForm(container, { ...p });
  });

  bindProductDetailModalEvents(container, productId, refreshModal);
}

function bindProductDetailModalEvents(container, productId, refreshModal) {
  async function afterCompositionChange() {
    await syncProductCostIfRecipesMode(productId);
    await refreshModal();
    renderProducts(container);
  }

  document.querySelectorAll('.product-comp-weight-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const id = Number(input.dataset.id);
      const grams = parseCompositionKgInput(input.value);
      try {
        await updateProductRecipeComponent(id, { weightGrams: grams });
        await afterCompositionChange();
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.querySelectorAll('.product-comp-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await deleteProductRecipeComponent(Number(btn.dataset.id));
        showToast('הוסר');
        await afterCompositionChange();
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.querySelectorAll('.product-quick-add-recipe').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await addProductRecipeComponent({
          productId,
          recipeId: Number(btn.dataset.recipeId),
          weightGrams: btn.dataset.weight || null,
        });
        showToast('נוסף');
        await afterCompositionChange();
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.getElementById('product-add-recipe-btn')?.addEventListener('click', async () => {
    const sel = document.getElementById('product-add-recipe-select');
    const recipeId = Number(sel?.value);
    if (!recipeId) return showToast('בחר מתכון');
    try {
      await addProductRecipeComponent({ productId, recipeId });
      showToast('נוסף');
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
      showToast('מקור העלות: הזנה ידנית');
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
  const source = opts.rawMaterialsCostSource || 'manual';
  const isManual = source !== 'recipes';
  const previewText = opts.rawMaterialsCostPreview != null ? formatMoney(opts.rawMaterialsCostPreview) : '—';
  return `
      <div class="form-group">
        <label>מחיר חומרי גלם</label>
        <div class="price-unit-options" data-cost-source-group role="radiogroup" aria-label="מקור מחיר חומרי גלם">
          <label class="price-unit-option${isManual ? ' is-selected' : ''}">
            <input type="radio" name="prod-raw-source" value="manual" ${isManual ? 'checked' : ''}>
            <span class="price-unit-option-title">ידני</span>
            <span class="price-unit-option-sub">הזנה ידנית של עלות</span>
          </label>
          <label class="price-unit-option${!isManual ? ' is-selected' : ''}">
            <input type="radio" name="prod-raw-source" value="recipes" ${!isManual ? 'checked' : ''}>
            <span class="price-unit-option-title">מהמתכונים</span>
            <span class="price-unit-option-sub">חישוב מהרכב המוצר</span>
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

  const layout = await getProductsCatalogLayout();
  const categories = layout.allCategories.map((c) => ({ id: c.id, name: c.name }));

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
      ${rawMaterialsCostSourceFieldsHTML({ ...opts, rawMaterialsCostPreview })}
      ${optionalPriceInput('prod-pack', 'מחיר אריזה (₪)', opts.packagingCost)}
      ${optionalPriceInput('prod-extra', 'עלויות נוספות (₪)', opts.additionalCosts)}`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-prod">שמור</button>`,
  });

  bindProductPriceUnitFields();
  bindRawMaterialsCostSourceFields({ productId: opts.id });
  document.querySelector('.modal-cancel').addEventListener('click', closeModal);
  document.getElementById('save-prod').addEventListener('click', async () => {
    const name = document.getElementById('prod-name').value.trim();
    if (!name) return showToast('יש להזין שם מוצר');

    const rawMaterialsCostSource = document.querySelector('input[name="prod-raw-source"]:checked')?.value || 'manual';
    const data = {
      name,
      categoryId: Number(document.getElementById('prod-cat').value),
      unitPrice: document.getElementById('prod-price').value,
      priceUnit: document.querySelector('input[name="prod-price-unit"]:checked')?.value || 'unit',
      unitWeightKg: document.getElementById('prod-unit-weight')?.value ?? '',
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
      if (opts.id) await updateProduct(opts.id, data);
      else await addProduct(data);
      expandCategory(data.categoryId);
      closeModal();
      showToast('נשמר ✓');
      renderProducts(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

export function productsMeta() {
  return { title: 'מוצרים', subtitle: 'קטגוריות כלליות, צבעים ומוצרים' };
}

function showImportError(message) {
  openModal({
    title: 'שגיאה בייבוא',
    bodyHTML: `<p style="white-space:pre-line;font-size:0.9rem;line-height:1.6;color:var(--text)">${escapeHtml(message)}</p>`,
    footerHTML: `<button class="btn btn-primary modal-cancel">הבנתי</button>`,
  });
  document.querySelector('.modal-cancel').addEventListener('click', closeModal);
}
