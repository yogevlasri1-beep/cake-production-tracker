import {
  getPortionPresetsCatalog, updatePortionPresetLink, setPortionPresetCatalogOrder,
  PORTION_LINK_PRODUCT, PORTION_LINK_CATEGORY, PORTION_LINK_GROUP,
} from './db.js?v=291';

function wirePortionIngredientsButtons(root, { onSaved } = {}) {
  import('../portion-ingredients.js?v=291').then(({ bindPortionIngredientsButtons }) => {
    bindPortionIngredientsButtons(root, { onSaved });
  }).catch((err) => {
    console.warn('portion-ingredients load failed', err);
  });
}
import { escapeHtml, showToast } from './utils.js?v=291';
import { openModal, closeModal } from './modal.js?v=291';

const PORTION_SECTIONS_KEY = 'yitzurPortionSectionsOpen';

function getPortionSectionsOpen() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(PORTION_SECTIONS_KEY) || '{}');
    return {
      recipe: raw.recipe !== false,
      flow: raw.flow !== false,
    };
  } catch {
    return { recipe: true, flow: true };
  }
}

function setPortionSectionOpen(id, open) {
  const state = getPortionSectionsOpen();
  state[id] = open;
  sessionStorage.setItem(PORTION_SECTIONS_KEY, JSON.stringify(state));
}

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
  const metaLine = portion.sourceKind === 'recipe'
    ? escapeHtml(portion.recipeName || portion.sourceLabel)
    : escapeHtml(portion.homeGroupName || portion.sourceLabel);
  const subBadge = portion.isSubRecipe ? '<span class="recipe-sub-badge">תת מתכון</span> ' : '';
  return `
    <div class="portion-catalog-row list-item${portion.isSubRecipe ? ' portion-catalog-row--sub-recipe' : ''}" data-portion-id="${portion.id}">
      <div class="portion-order-actions">
        <button type="button" class="btn btn-secondary btn-sm portion-move-up" data-id="${portion.id}" title="העלה"${index === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" class="btn btn-secondary btn-sm portion-move-down" data-id="${portion.id}" title="הורד"${index >= total - 1 ? ' disabled' : ''}>↓</button>
      </div>
      <div class="list-item-info">
        <div class="list-item-name">${subBadge}🍽 ${escapeHtml(portionPresetLabel(portion))}</div>
        <div class="list-item-meta">${metaLine}</div>
        <div class="list-item-meta portion-link-line">
          ${scopeBadge}
          <strong>${escapeHtml(portion.linkLabel)}</strong>
          ${portion.linkPath ? `<span class="form-hint"> · ${escapeHtml(portion.linkPath)}</span>` : ''}
        </div>
      </div>
      <div class="list-item-actions">
        ${portion.sourceKind === 'recipe' ? `
        <button type="button" class="btn btn-secondary btn-sm portion-ingredients-btn" data-id="${portion.id}"
          title="רכיבי מתכון">📋</button>` : ''}
        <button type="button" class="btn btn-secondary btn-sm portion-edit-link" data-id="${portion.id}" title="שיוך">🔗</button>
      </div>
    </div>`;
}

function renderPortionSection(id, title, sectionPortions, open) {
  const body = sectionPortions.length
    ? `<div class="portion-catalog-list">${sectionPortions.map((p, i) => renderPortionRow(p, i, sectionPortions.length)).join('')}</div>`
    : '<p class="form-hint portion-empty">אין מנות בקטגוריה זו</p>';
  const extraClass = id === 'recipe' ? 'portion-source-section--recipe' : 'portion-source-section--flow';
  return `
    <section class="card backup-section portion-source-section ${extraClass}${open ? '' : ' is-collapsed'}" data-portion-section="${id}">
      <button type="button" class="backup-section-header" aria-expanded="${open}">
        <span class="backup-section-title">${title} <span class="portion-section-count">(${sectionPortions.length})</span></span>
      </button>
      <div class="backup-section-body">
        ${body}
      </div>
    </section>`;
}

function bindPortionSectionToggles(container) {
  container.querySelectorAll('[data-portion-section] .backup-section-header').forEach((btn) => {
    btn.addEventListener('click', () => {
      const section = btn.closest('[data-portion-section]');
      const id = section?.dataset.portionSection;
      if (!id) return;
      const opening = section.classList.contains('is-collapsed');
      section.classList.toggle('is-collapsed', !opening);
      btn.setAttribute('aria-expanded', String(opening));
      setPortionSectionOpen(id, opening);
    });
  });
}

export async function renderRecipesPortions(container, { productCatalog }) {
  const rerender = () => renderRecipesPortions(container, { productCatalog });
  const portions = await getPortionPresetsCatalog();
  const recipePortions = portions.filter((p) => p.sourceKind === 'recipe');
  const flowPortions = portions.filter((p) => p.sourceKind !== 'recipe');
  const sectionsOpen = getPortionSectionsOpen();

  container.innerHTML = `
    <div class="card portion-station-intro">
      <div class="card-title">מנות לייצור</div>
      <p class="form-hint" style="margin:0">מנות מחולקות לפי מקור — מתכונים או תזרים. לחץ על כותרת הקטגוריה לצמצום/הרחבה. סדר ושייך לפי הצורך.</p>
    </div>
    ${renderPortionSection('recipe', '📖 מנות ממתכונים', recipePortions, sectionsOpen.recipe)}
    ${renderPortionSection('flow', '🔄 מנות מתזרים', flowPortions, sectionsOpen.flow)}`;

  const movePortion = async (id, direction, sectionKind) => {
    const sectionPortions = sectionKind === 'recipe' ? recipePortions : flowPortions;
    const ids = sectionPortions.map((p) => p.id);
    const idx = ids.indexOf(Number(id));
    if (idx < 0) return;
    const swap = idx + direction;
    if (swap < 0 || swap >= ids.length) return;
    [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
    const recipeIds = sectionKind === 'recipe' ? ids : recipePortions.map((p) => p.id);
    const flowIds = sectionKind === 'flow' ? ids : flowPortions.map((p) => p.id);
    try {
      await setPortionPresetCatalogOrder([...recipeIds, ...flowIds]);
      showToast('סדר עודכן ✓');
      rerender();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  };

  bindPortionSectionToggles(container);

  container.querySelectorAll('.portion-move-up').forEach((btn) => {
    const section = btn.closest('[data-portion-section]')?.dataset.portionSection;
    btn.addEventListener('click', () => movePortion(Number(btn.dataset.id), -1, section));
  });
  container.querySelectorAll('.portion-move-down').forEach((btn) => {
    const section = btn.closest('[data-portion-section]')?.dataset.portionSection;
    btn.addEventListener('click', () => movePortion(Number(btn.dataset.id), 1, section));
  });
  container.querySelectorAll('.portion-edit-link').forEach((btn) => {
    btn.addEventListener('click', () => {
      const portion = portions.find((p) => p.id === Number(btn.dataset.id));
      if (portion) openPortionLinkForm({ portion, productCatalog, onSaved: rerender });
    });
  });

  wirePortionIngredientsButtons(container, { onSaved: rerender });
}
