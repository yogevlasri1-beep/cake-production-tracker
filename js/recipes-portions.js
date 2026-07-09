import {
  getPortionPresetsCatalog, updatePortionPresetLink, setPortionPresetCatalogOrder,
  PORTION_LINK_PRODUCT, PORTION_LINK_CATEGORY, PORTION_LINK_GROUP,
} from './db.js?v=278';
import { escapeHtml, showToast } from './utils.js?v=278';
import { openModal, closeModal } from './modal.js?v=278';

function portionPresetLabel(p) {
  const extra = p.extra ? ` · ${p.extra}` : '';
  return `${p.name} (${p.weight} ק"ג${extra})`;
}

function buildGroupCheckboxesHTML(productCatalog, selectedIds = []) {
  const selected = new Set(selectedIds.map(Number));
  const groups = productCatalog.groups || [];
  if (!groups.length) return '<p class="form-hint">אין קטגוריות כלליות</p>';
  return `<div class="portion-link-checklist">${groups.map((group) => `
    <label class="checkbox-label portion-link-pick">
      <input type="checkbox" class="portion-link-cb" data-link-type="${PORTION_LINK_GROUP}" value="${group.id}"${selected.has(group.id) ? ' checked' : ''}>
      <span>${escapeHtml(group.name)}</span>
    </label>`).join('')}</div>`;
}

function buildCategoryCheckboxesHTML(productCatalog, selectedIds = []) {
  const selected = new Set(selectedIds.map(Number));
  const parts = [];
  for (const group of productCatalog.groups || []) {
    for (const cat of group.categories || []) {
      parts.push(`
        <label class="checkbox-label portion-link-pick">
          <input type="checkbox" class="portion-link-cb" data-link-type="${PORTION_LINK_CATEGORY}" value="${cat.id}"${selected.has(cat.id) ? ' checked' : ''}>
          <span>${escapeHtml(`${group.name} › ${cat.name}`)}</span>
        </label>`);
    }
  }
  for (const cat of productCatalog.ungrouped || []) {
    parts.push(`
      <label class="checkbox-label portion-link-pick">
        <input type="checkbox" class="portion-link-cb" data-link-type="${PORTION_LINK_CATEGORY}" value="${cat.id}"${selected.has(cat.id) ? ' checked' : ''}>
        <span>${escapeHtml(cat.name)}</span>
      </label>`);
  }
  return parts.length
    ? `<div class="portion-link-checklist">${parts.join('')}</div>`
    : '<p class="form-hint">אין קטגוריות</p>';
}

function buildProductCheckboxesHTML(productCatalog, selectedIds = []) {
  const selected = new Set(selectedIds.map(Number));
  const parts = [];
  for (const group of productCatalog.groups || []) {
    for (const cat of group.categories || []) {
      for (const p of (cat.products || []).filter((prod) => prod.active !== false)) {
        parts.push(`
          <label class="checkbox-label portion-link-pick">
            <input type="checkbox" class="portion-link-cb" data-link-type="${PORTION_LINK_PRODUCT}" value="${p.id}"${selected.has(p.id) ? ' checked' : ''}>
            <span>${escapeHtml(`${group.name} › ${cat.name} › ${p.name}`)}</span>
          </label>`);
      }
    }
  }
  for (const cat of productCatalog.ungrouped || []) {
    for (const p of (cat.products || []).filter((prod) => prod.active !== false)) {
      parts.push(`
        <label class="checkbox-label portion-link-pick">
          <input type="checkbox" class="portion-link-cb" data-link-type="${PORTION_LINK_PRODUCT}" value="${p.id}"${selected.has(p.id) ? ' checked' : ''}>
          <span>${escapeHtml(`${cat.name} › ${p.name}`)}</span>
        </label>`);
    }
  }
  return parts.length
    ? `<div class="portion-link-checklist portion-link-checklist--products">${parts.join('')}</div>`
    : '<p class="form-hint">אין מוצרים</p>';
}

function buildCustomLinkPickHTML(productCatalog, portion) {
  return `
    <div class="portion-link-section">
      <div class="portion-link-section-title">קטגוריות כלליות</div>
      ${buildGroupCheckboxesHTML(productCatalog, portion.linkGroupIds)}
    </div>
    <div class="portion-link-section">
      <div class="portion-link-section-title">קטגוריות</div>
      ${buildCategoryCheckboxesHTML(productCatalog, portion.linkCategoryIds)}
    </div>
    <div class="portion-link-section">
      <div class="portion-link-section-title">מוצרים</div>
      ${buildProductCheckboxesHTML(productCatalog, portion.linkProductIds)}
    </div>`;
}

function readSelectedPortionLinks() {
  const productIds = [];
  const categoryIds = [];
  const groupIds = [];
  document.querySelectorAll('.portion-link-cb:checked').forEach((cb) => {
    const id = Number(cb.value);
    if (!id) return;
    const type = cb.dataset.linkType;
    if (type === PORTION_LINK_PRODUCT) productIds.push(id);
    else if (type === PORTION_LINK_CATEGORY) categoryIds.push(id);
    else if (type === PORTION_LINK_GROUP) groupIds.push(id);
  });
  return { productIds, categoryIds, groupIds };
}

function openPortionLinkForm({ portion, productCatalog, onSaved }) {
  const linkMode = portion.hasCustomLinks ? 'custom' : 'default';
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
            <input type="radio" name="portion-link-mode" value="custom"${linkMode === 'custom' ? ' checked' : ''}>
            שיוך מותאם
          </label>
        </div>
      </div>
      <div id="portion-link-pick">${linkMode === 'custom'
    ? buildCustomLinkPickHTML(productCatalog, portion)
    : `<p class="form-hint">${portion.sourceRecipeId
      ? 'המנה תוצג לפי שיוך המתכון למוצרים (במסך עריכת מתכון)'
      : `המנה תוצג לכל המוצרים בקבוצת התזרים «${escapeHtml(portion.homeGroupName || '')}»`}</p>`}</div>
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
    if (mode === 'custom') {
      hint.textContent = 'ניתן לבחור כמה קטגוריות וכמה מוצרים — המנה תופיע אם המוצר מתאים לאחד מהיעדים';
    } else {
      hint.textContent = '';
    }
  };

  const syncPick = () => {
    const mode = getLinkMode();
    const pick = document.getElementById('portion-link-pick');
    if (!pick) return;
    pick.innerHTML = mode === 'custom'
      ? buildCustomLinkPickHTML(productCatalog, portion)
      : `<p class="form-hint">${portion.sourceRecipeId
        ? 'המנה תוצג לפי שיוך המתכון למוצרים (במסך עריכת מתכון)'
        : `המנה תוצג לכל המוצרים בקבוצת התזרים «${escapeHtml(portion.homeGroupName || '')}»`}</p>`;
    updateHint();
  };

  document.querySelectorAll('input[name="portion-link-mode"]').forEach((el) => {
    el.addEventListener('change', syncPick);
  });
  updateHint();

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-portion-link-form')?.addEventListener('click', async () => {
    const mode = getLinkMode();
    try {
      if (mode === 'default') {
        await updatePortionPresetLink(portion.id, { useDefault: true });
      } else {
        const { productIds, categoryIds, groupIds } = readSelectedPortionLinks();
        await updatePortionPresetLink(portion.id, { productIds, categoryIds, groupIds });
      }
      closeModal();
      showToast('נשמר ✓');
      onSaved?.();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

function renderPortionRow(portion, index, total) {
  const scopeBadge = portion.hasCustomLinks
    ? '<span class="machine-assignment-scope">שיוך מותאם</span>'
    : '<span class="machine-assignment-scope portion-scope-default">ברירת מחדל</span>';
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
      <p class="form-hint" style="margin:0">כל המנות ממתכונים ומתזרימי ייצור. סדר אותן ושייך לכמה קטגוריות ומוצרים — בתוכנית היומית יוצגו רק המנות הרלוונטיות.</p>
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
