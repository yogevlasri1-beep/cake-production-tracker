import {
  getPortionPresetsCatalog, updatePortionPresetLink, setPortionPresetCatalogOrder,
  PORTION_LINK_PRODUCT, PORTION_LINK_CATEGORY, PORTION_LINK_GROUP,
  getPortionLinkKindLabel,
} from './db.js?v=277';
import { escapeHtml, showToast } from './utils.js?v=277';
import { openModal, closeModal } from './modal.js?v=277';

function portionPresetLabel(p) {
  const extra = p.extra ? ` · ${p.extra}` : '';
  return `${p.name} (${p.weight} ק"ג${extra})`;
}

function buildGroupSelectHTML(productCatalog, selectedId) {
  const parts = ['<option value="">בחר קטגוריה כללית...</option>'];
  for (const group of productCatalog.groups || []) {
    const sel = Number(selectedId) === group.id ? ' selected' : '';
    parts.push(`<option value="${group.id}"${sel}>${escapeHtml(group.name)}</option>`);
  }
  return parts.join('');
}

function buildCategorySelectHTML(productCatalog, selectedId) {
  const parts = ['<option value="">בחר קטגוריה...</option>'];
  for (const group of productCatalog.groups || []) {
    for (const cat of group.categories || []) {
      const sel = Number(selectedId) === cat.id ? ' selected' : '';
      parts.push(`<option value="${cat.id}"${sel}>${escapeHtml(`${group.name} › ${cat.name}`)}</option>`);
    }
  }
  for (const cat of productCatalog.ungrouped || []) {
    const sel = Number(selectedId) === cat.id ? ' selected' : '';
    parts.push(`<option value="${cat.id}"${sel}>${escapeHtml(cat.name)}</option>`);
  }
  return parts.join('');
}

function buildProductSelectHTML(productCatalog, selectedId) {
  const parts = ['<option value="">בחר מוצר...</option>'];
  for (const group of productCatalog.groups || []) {
    for (const cat of group.categories || []) {
      const products = (cat.products || []).filter((p) => p.active !== false);
      if (!products.length) continue;
      parts.push(`<optgroup label="${escapeHtml(`${group.name} › ${cat.name}`)}">`);
      for (const p of products) {
        const sel = Number(selectedId) === p.id ? ' selected' : '';
        parts.push(`<option value="${p.id}"${sel}>${escapeHtml(p.name)}</option>`);
      }
      parts.push('</optgroup>');
    }
  }
  for (const cat of productCatalog.ungrouped || []) {
    const products = (cat.products || []).filter((p) => p.active !== false);
    if (!products.length) continue;
    parts.push(`<optgroup label="${escapeHtml(cat.name)}">`);
    for (const p of products) {
      const sel = Number(selectedId) === p.id ? ' selected' : '';
      parts.push(`<option value="${p.id}"${sel}>${escapeHtml(p.name)}</option>`);
    }
    parts.push('</optgroup>');
  }
  return parts.join('');
}

function buildPortionLinkPickHTML(linkMode, productCatalog, portion) {
  if (linkMode === PORTION_LINK_GROUP) {
    return `
      <div class="form-group">
        <label for="portion-link-group">קטגוריה כללית</label>
        <select id="portion-link-group">${buildGroupSelectHTML(productCatalog, portion?.linkCategoryGroupId)}</select>
      </div>`;
  }
  if (linkMode === PORTION_LINK_CATEGORY) {
    return `
      <div class="form-group">
        <label for="portion-link-category">קטגוריה</label>
        <select id="portion-link-category">${buildCategorySelectHTML(productCatalog, portion?.linkCategoryId)}</select>
      </div>`;
  }
  if (linkMode === PORTION_LINK_PRODUCT) {
    return `
      <div class="form-group">
        <label for="portion-link-product">מוצר</label>
        <select id="portion-link-product">${buildProductSelectHTML(productCatalog, portion?.linkProductId)}</select>
      </div>`;
  }
  return `<p class="form-hint">${portion?.sourceRecipeId
    ? 'המנה תוצג לפי שיוך המתכון למוצרים (במסך עריכת מתכון)'
    : `המנה תוצג לכל המוצרים בקבוצת התזרים «${escapeHtml(portion?.homeGroupName || '')}»`}</p>`;
}

function inferLinkMode(portion) {
  if (portion?.linkTargetType === PORTION_LINK_GROUP) return PORTION_LINK_GROUP;
  if (portion?.linkTargetType === PORTION_LINK_CATEGORY) return PORTION_LINK_CATEGORY;
  if (portion?.linkTargetType === PORTION_LINK_PRODUCT) return PORTION_LINK_PRODUCT;
  return 'default';
}

function openPortionLinkForm({ portion, productCatalog, onSaved }) {
  const linkMode = inferLinkMode(portion);
  openModal({
    title: `שיוך מנה · ${escapeHtml(portion.name)}`,
    bodyHTML: `
      <p class="form-hint" style="margin-top:0">${escapeHtml(portionPresetLabel(portion))}</p>
      <p class="form-hint">מקור: ${escapeHtml(portion.sourceLabel)}</p>
      <div class="form-group">
        <label>שיוך לתוכנית יומית</label>
        <div class="baking-scope-type-row">
          <label class="baking-scope-type-option">
            <input type="radio" name="portion-link-mode" value="default"${linkMode === 'default' ? ' checked' : ''}>
            ברירת מחדל
          </label>
          <label class="baking-scope-type-option">
            <input type="radio" name="portion-link-mode" value="${PORTION_LINK_GROUP}"${linkMode === PORTION_LINK_GROUP ? ' checked' : ''}>
            קטגוריה כללית
          </label>
          <label class="baking-scope-type-option">
            <input type="radio" name="portion-link-mode" value="${PORTION_LINK_CATEGORY}"${linkMode === PORTION_LINK_CATEGORY ? ' checked' : ''}>
            קטגוריה
          </label>
          <label class="baking-scope-type-option">
            <input type="radio" name="portion-link-mode" value="${PORTION_LINK_PRODUCT}"${linkMode === PORTION_LINK_PRODUCT ? ' checked' : ''}>
            מוצר
          </label>
        </div>
      </div>
      <div id="portion-link-pick">${buildPortionLinkPickHTML(linkMode, productCatalog, portion)}</div>
      <div id="portion-link-hint" class="form-hint"></div>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-portion-link-form">שמור</button>`,
  });

  const getLinkMode = () =>
    document.querySelector('input[name="portion-link-mode"]:checked')?.value || 'default';

  const updateHint = () => {
    const mode = getLinkMode();
    const hint = document.getElementById('portion-link-hint');
    if (!hint) return;
    if (mode === PORTION_LINK_GROUP) hint.textContent = 'המנה תופיע לכל המוצרים בקטגוריה כללית שנבחרה';
    else if (mode === PORTION_LINK_CATEGORY) hint.textContent = 'המנה תופיע לכל המוצרים בקטגוריה שנבחרה';
    else if (mode === PORTION_LINK_PRODUCT) hint.textContent = 'המנה תופיע רק למוצר שנבחר';
    else hint.textContent = '';
  };

  const syncPick = () => {
    const mode = getLinkMode();
    const pick = document.getElementById('portion-link-pick');
    if (!pick) return;
    const pickPortion = portion.linkTargetType === mode ? portion : { ...portion, linkCategoryGroupId: null, linkCategoryId: null, linkProductId: null };
    pick.innerHTML = buildPortionLinkPickHTML(mode, productCatalog, pickPortion);
    updateHint();
  };

  document.querySelectorAll('input[name="portion-link-mode"]').forEach((el) => {
    el.addEventListener('change', syncPick);
  });
  updateHint();

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-portion-link-form')?.addEventListener('click', async () => {
    const mode = getLinkMode();
    const link = { linkTargetType: null };
    if (mode === PORTION_LINK_GROUP) {
      link.linkTargetType = PORTION_LINK_GROUP;
      link.linkCategoryGroupId = document.getElementById('portion-link-group')?.value;
    } else if (mode === PORTION_LINK_CATEGORY) {
      link.linkTargetType = PORTION_LINK_CATEGORY;
      link.linkCategoryId = document.getElementById('portion-link-category')?.value;
    } else if (mode === PORTION_LINK_PRODUCT) {
      link.linkTargetType = PORTION_LINK_PRODUCT;
      link.linkProductId = document.getElementById('portion-link-product')?.value;
    }
    try {
      await updatePortionPresetLink(portion.id, link);
      closeModal();
      showToast('נשמר ✓');
      onSaved?.();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

function renderPortionRow(portion, index, total) {
  const scopeBadge = portion.linkTargetType
    ? `<span class="machine-assignment-scope">${escapeHtml(getPortionLinkKindLabel(portion.linkTargetType))}</span>`
    : `<span class="machine-assignment-scope portion-scope-default">ברירת מחדל</span>`;
  const sourceBadge = portion.sourceKind === 'recipe'
    ? '<span class="portion-source-badge portion-source-badge--recipe">מתכון</span>'
    : '<span class="portion-source-badge portion-source-badge--flow">תזרים</span>';
  return `
    <div class="portion-catalog-row list-item" data-portion-id="${portion.id}">
      <div class="portion-order-actions">
        <button type="button" class="btn btn-secondary btn-sm portion-move-up" data-id="${portion.id}" title="העלה"${index === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" class="btn btn-secondary btn-sm portion-move-down" data-id="${portion.id}" title="הורד"${index >= total - 1 ? ' disabled' : ''}>↓</button>
      </div>
      <div class="list-item-info">
        <div class="list-item-name">🍽 ${escapeHtml(portionPresetLabel(portion))}</div>
        <div class="list-item-meta">${sourceBadge} ${escapeHtml(portion.sourceLabel)}</div>
        <div class="list-item-meta portion-link-line">
          ${scopeBadge}
          <strong>${escapeHtml(portion.linkLabel)}</strong>
          ${portion.linkPath ? `<span class="form-hint"> · ${escapeHtml(portion.linkPath)}</span>` : ''}
        </div>
      </div>
      <div class="list-item-actions">
        <button type="button" class="btn btn-secondary btn-sm portion-edit-link" data-id="${portion.id}" title="שיוך">🔗</button>
      </div>
    </div>`;
}

export async function renderRecipesPortions(container, { productCatalog }) {
  const rerender = () => renderRecipesPortions(container, { productCatalog });
  const portions = await getPortionPresetsCatalog();

  container.innerHTML = `
    <div class="card portion-station-intro">
      <div class="card-title">מנות לייצור</div>
      <p class="form-hint" style="margin:0">כל המנות ממתכונים ומתזרימי ייצור. סדר אותן ושייך לקטגוריה כללית, קטגוריה או מוצר — בתוכנית היומית יוצגו רק המנות הרלוונטיות למוצר שנבחר.</p>
    </div>
    <div class="card portion-list-card">
      <div class="section-header">
        <h2>רשימת מנות (${portions.length})</h2>
      </div>
      ${portions.length ? `
      <div class="portion-catalog-list">
        ${portions.map((p, i) => renderPortionRow(p, i, portions.length)).join('')}
      </div>` : '<p class="form-hint portion-empty">אין מנות — הוסף מנות בתזרים או שייך מתכונים למוצרים</p>'}
    </div>`;

  const movePortion = async (id, direction) => {
    const ids = portions.map((p) => p.id);
    const idx = ids.indexOf(Number(id));
    if (idx < 0) return;
    const swap = idx + direction;
    if (swap < 0 || swap >= ids.length) return;
    [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
    try {
      await setPortionPresetCatalogOrder(ids);
      showToast('סדר עודכן ✓');
      rerender();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  };

  container.querySelectorAll('.portion-move-up').forEach((btn) => {
    btn.addEventListener('click', () => movePortion(Number(btn.dataset.id), -1));
  });
  container.querySelectorAll('.portion-move-down').forEach((btn) => {
    btn.addEventListener('click', () => movePortion(Number(btn.dataset.id), 1));
  });
  container.querySelectorAll('.portion-edit-link').forEach((btn) => {
    btn.addEventListener('click', () => {
      const portion = portions.find((p) => p.id === Number(btn.dataset.id));
      if (portion) openPortionLinkForm({ portion, productCatalog, onSaved: rerender });
    });
  });
}
