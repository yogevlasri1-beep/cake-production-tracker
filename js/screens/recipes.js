import {
  getRecipeGroups, getRecipeSubCategories, getRecipes, getRecipe,
  addRecipeGroup, addRecipeSubCategory, importRecipeGroupsFromProducts,
  importRecipeSubCategoriesFromProducts, deleteRecipeGroup, deleteRecipeSubCategory,
  addRecipe, updateRecipe, deleteRecipe, addRecipeIngredient, deleteRecipeIngredient,
  updateRecipeIngredient, syncProductCostFromRecipe, getRawMaterials,
  setRecipeOrder, importParsedRecipes, scaleRecipeIngredients,
  findOrCreateWordImportCategory, IMPORT_WORD_GROUP, IMPORT_WORD_SUB,
  RECIPE_WEIGHT_UNITS, normalizeRecipeUnitKind,
} from '../kitchen-db.js';
import { getProducts, getCategoryGroups, getCategories } from '../db.js';
import { parseRecipesFromDocxFile, buildRecipeBookHtml } from '../recipe-import.js';
import { escapeHtml, showToast, formatMoney } from '../utils.js';
import { openModal, closeModal } from '../modal.js';
import { bindRecipeDragList } from '../product-drag.js';

export function recipesMeta() {
  return { title: 'מתכונים', subtitle: 'קטגוריות, ייבוא Word, ספר מתכונים ומחשבון יחס' };
}

export async function renderRecipes(container) {
  const viewMode = container.dataset.recipeView || 'manage';
  const selectedGroup = container.dataset.recipeGroup || '';
  const selectedSub = container.dataset.recipeSub || '';

  const [groups, allSubs, products, productGroups, productCats] = await Promise.all([
    getRecipeGroups(),
    getRecipeSubCategories(null),
    getProducts(true),
    getCategoryGroups(),
    getCategories(),
  ]);

  if (!groups.length) {
    await addRecipeGroup({ name: 'כללי', linkedCategoryGroupId: null });
    return renderRecipes(container);
  }

  let groupId = selectedGroup ? Number(selectedGroup) : groups[0].id;
  if (!groups.some((g) => g.id === groupId)) groupId = groups[0].id;

  const subs = allSubs.filter((s) => s.groupId === groupId);
  let subId = selectedSub ? Number(selectedSub) : subs[0]?.id;
  if (!subs.some((s) => s.id === subId)) subId = subs[0]?.id;

  container.dataset.recipeGroup = String(groupId);
  if (subId) container.dataset.recipeSub = String(subId);

  if (viewMode === 'book') {
    return renderRecipeBook(container, { groups, allSubs, products });
  }

  const recipes = subId ? await getRecipes(subId) : [];
  const productMap = new Map(products.map((p) => [p.id, p]));
  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const subMap = new Map(subs.map((s) => [s.id, s]));

  container.innerHTML = `
    <div class="card">
      <div class="filter-row" style="margin-bottom:12px">
        <div class="card-title" style="margin:0;flex:1">מתכונים</div>
        <button type="button" class="btn btn-secondary btn-sm" id="recipe-book-btn">📖 ספר מתכונים</button>
        <button type="button" class="btn btn-secondary btn-sm" id="recipe-import-btn">📄 ייבוא Word</button>
        <button type="button" class="btn btn-secondary btn-sm" id="manage-recipe-cats">⚙️ קטגוריות</button>
      </div>
      <p class="form-hint">גרור ☰ לשינוי סדר מתכונים · מחשבון יחס משנה כמויות בלי לשמור את המתכון</p>
    </div>

    <div class="card">
      <div class="card-title">קטגוריה כללית</div>
      <div class="workspace-chip-row">
        ${groups.map((g) => `
          <button type="button" class="workspace-chip${g.id === groupId ? ' active' : ''}"
            data-recipe-group="${g.id}">${escapeHtml(g.name)}</button>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-title">תת-קטגוריה · ${escapeHtml(groupMap.get(groupId)?.name || '')}</div>
      <div class="workspace-chip-row">
        ${subs.map((s) => `
          <button type="button" class="workspace-chip${s.id === subId ? ' active' : ''}"
            data-recipe-sub="${s.id}">${escapeHtml(s.name)}</button>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="filter-row" style="margin-bottom:12px">
        <div class="card-title" style="margin:0;flex:1">
          מתכונים · ${escapeHtml(subMap.get(subId)?.name || '')}
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="add-recipe-btn"${subId ? '' : ' disabled'}>+ מתכון</button>
      </div>
      ${!recipes.length
    ? '<p class="form-hint">אין מתכונים — הוסף ידנית או ייבא מקובץ Word</p>'
    : `<div class="recipe-list" data-sub-id="${subId}">
        ${recipes.map((r, i) => {
      const prod = r.linkedProductId ? productMap.get(r.linkedProductId) : null;
      return `
          <div class="list-item recipe-list-item" data-recipe-id="${r.id}">
            <button type="button" class="recipe-drag-handle" aria-label="גרור לשינוי סדר">☰</button>
            <span class="recipe-order-num" aria-hidden="true">${i + 1}</span>
            <div class="list-item-info">
              <div class="list-item-name">${escapeHtml(r.name)}</div>
              <div class="list-item-meta">
                ${prod ? `🔗 ${escapeHtml(prod.name)}` : 'ללא מוצר'}
                · ${r.yieldPortions || 1} מנות
              </div>
            </div>
            <div class="list-item-actions">
              <button type="button" class="btn btn-secondary btn-sm ratio-recipe" data-id="${r.id}" title="מחשבון יחס">⚖️</button>
              <button type="button" class="btn btn-secondary btn-sm edit-recipe" data-id="${r.id}">✏️</button>
              <button type="button" class="btn btn-danger btn-sm delete-recipe" data-id="${r.id}">🗑</button>
            </div>
          </div>`;
    }).join('')}
      </div>`}
    </div>

    <input type="file" id="recipe-word-file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden>`;

  container.querySelectorAll('[data-recipe-group]').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.recipeGroup = btn.dataset.recipeGroup;
      delete container.dataset.recipeSub;
      renderRecipes(container);
    });
  });

  container.querySelectorAll('[data-recipe-sub]').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.recipeSub = btn.dataset.recipeSub;
      renderRecipes(container);
    });
  });

  document.getElementById('recipe-book-btn')?.addEventListener('click', () => {
    container.dataset.recipeView = 'book';
    renderRecipes(container);
  });

  document.getElementById('recipe-import-btn')?.addEventListener('click', () => {
    document.getElementById('recipe-word-file')?.click();
  });

  document.getElementById('recipe-word-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = await parseRecipesFromDocxFile(file);
      openImportPreview(container, parsed, { groupId, subId, groups, subs });
    } catch (err) {
      showToast(err.message || 'שגיאה בייבוא');
    }
  });

  document.getElementById('manage-recipe-cats')?.addEventListener('click', () => {
    openCategoryManager(container, { groups, productGroups, productCats, groupId });
  });

  document.getElementById('add-recipe-btn')?.addEventListener('click', () => {
    openRecipeForm(container, { categoryId: subId, products });
  });

  container.querySelectorAll('.edit-recipe').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const recipe = await getRecipe(Number(btn.dataset.id));
      if (recipe) openRecipeForm(container, { recipe, products });
    });
  });

  container.querySelectorAll('.ratio-recipe').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const recipe = await getRecipe(Number(btn.dataset.id));
      if (recipe) openRatioCalculator(recipe);
    });
  });

  container.querySelectorAll('.delete-recipe').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק מתכון?')) return;
      try {
        await deleteRecipe(Number(btn.dataset.id));
        showToast('נמחק');
        renderRecipes(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  if (subId && recipes.length) {
    bindRecipeDragList(container, subId, async (orderedIds) => {
      await setRecipeOrder(subId, orderedIds);
    });
  }
}

async function renderRecipeBook(container, { groups, allSubs, products }) {
  const allRecipes = await getRecipes(null);
  const details = await Promise.all(allRecipes.map((r) => getRecipe(r.id)));
  const productMap = new Map(products.map((p) => [p.id, p]));

  container.innerHTML = `
    <div class="card">
      <div class="filter-row">
        <div class="card-title" style="margin:0;flex:1">📖 ספר מתכונים</div>
        <button type="button" class="btn btn-secondary btn-sm" id="recipe-manage-btn">← ניהול</button>
        <button type="button" class="btn btn-primary btn-sm" id="export-recipe-book">⬇️ הורד HTML</button>
        <button type="button" class="btn btn-secondary btn-sm" id="print-recipe-book">🖨️ הדפס</button>
      </div>
    </div>
    <div class="card recipe-book-view" id="recipe-book-content">
      ${groups.map((group) => {
    const subs = allSubs.filter((s) => s.groupId === group.id);
    const groupRecipes = allRecipes.filter((r) => subs.some((s) => s.id === r.categoryId));
    if (!groupRecipes.length) return '';
    return `
        <section class="recipe-book-group">
          <h2 class="recipe-book-group-title">${escapeHtml(group.name)}</h2>
          ${subs.map((sub) => {
      const subRecipes = groupRecipes.filter((r) => r.categoryId === sub.id);
      if (!subRecipes.length) return '';
      return `
            <section class="recipe-book-sub">
              <h3 class="recipe-book-sub-title">${escapeHtml(sub.name)}</h3>
              ${subRecipes.map((r) => {
        const detail = details.find((d) => d.id === r.id);
        const prod = r.linkedProductId ? productMap.get(r.linkedProductId) : null;
        return `
                <article class="recipe-book-item">
                  <h4>${escapeHtml(r.name)}</h4>
                  ${prod ? `<p class="form-hint">מוצר: ${escapeHtml(prod.name)}</p>` : ''}
                  ${detail?.notes ? `<p class="recipe-book-notes">${escapeHtml(detail.notes)}</p>` : ''}
                  ${detail?.ingredients?.length ? `
                  <ul class="recipe-book-ingredients">
                    ${detail.ingredients.map((ing) => `
                      <li>${escapeHtml(ing.name)} — <strong>${ing.quantity}</strong> ${escapeHtml(ing.unit)}</li>`).join('')}
                  </ul>` : ''}
                </article>`;
      }).join('')}
            </section>`;
    }).join('')}
        </section>`;
  }).join('') || '<p class="form-hint">אין מתכונים לספר — הוסף מתכונים קודם</p>'}
    </div>`;

  document.getElementById('recipe-manage-btn')?.addEventListener('click', () => {
    container.dataset.recipeView = 'manage';
    renderRecipes(container);
  });

  document.getElementById('print-recipe-book')?.addEventListener('click', () => {
    window.print();
  });

  document.getElementById('export-recipe-book')?.addEventListener('click', async () => {
    const html = buildRecipeBookHtml({
      groups,
      subCategories: allSubs,
      recipes: allRecipes,
      recipeDetails: details,
    });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recipe-book.html';
    a.click();
    URL.revokeObjectURL(url);
    showToast('הורד ✓');
  });
}

function openCategoryManager(container, { groups, productGroups, productCats, groupId }) {
  const subsPromise = getRecipeSubCategories(groupId);

  subsPromise.then((subs) => {
    openModal({
      title: 'ניהול קטגוריות מתכונים',
      bodyHTML: `
        <div class="form-group">
          <label>קטגוריה כללית — חדשה</label>
          <div class="filter-row">
            <input type="text" id="new-recipe-group" placeholder="שם ידני" style="flex:1">
            <button type="button" class="btn btn-primary btn-sm" id="add-recipe-group-btn">+</button>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" id="import-groups-from-products" style="width:100%;margin-top:8px">
            ייבוא מקטגוריות כלליות של מוצרים
          </button>
        </div>
        <div class="form-group">
          <label>קטגוריות כלליות קיימות</label>
          ${groups.map((g) => {
        const linked = g.linkedCategoryGroupId
          ? productGroups.find((pg) => pg.id === g.linkedCategoryGroupId)?.name
          : null;
        return `<div class="filter-row" style="margin-bottom:4px">
            <span style="flex:1">${escapeHtml(g.name)}${linked ? ` <span class="form-hint">(${escapeHtml(linked)})</span>` : ''}</span>
            <button type="button" class="btn btn-danger btn-sm del-recipe-group" data-id="${g.id}">🗑</button>
          </div>`;
      }).join('')}
        </div>
        <hr>
        <div class="form-group">
          <label>תת-קטגוריה — חדשה (בקבוצה נוכחית)</label>
          <div class="filter-row">
            <input type="text" id="new-recipe-sub" placeholder="שם ידני" style="flex:1">
            <button type="button" class="btn btn-primary btn-sm" id="add-recipe-sub-btn">+</button>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" id="import-subs-from-products" style="width:100%;margin-top:8px">
            ייבוא מתוך קטגוריות מוצרים (לפי קישור)
          </button>
        </div>
        <div class="form-group">
          <label>תת-קטגוריות · ${escapeHtml(groups.find((g) => g.id === groupId)?.name || '')}</label>
          ${subs.map((s) => {
        const linked = s.linkedCategoryId
          ? productCats.find((c) => c.id === s.linkedCategoryId)?.name
          : null;
        return `<div class="filter-row" style="margin-bottom:4px">
            <span style="flex:1">${escapeHtml(s.name)}${linked ? ` <span class="form-hint">(${escapeHtml(linked)})</span>` : ''}</span>
            <button type="button" class="btn btn-danger btn-sm del-recipe-sub" data-id="${s.id}">🗑</button>
          </div>`;
      }).join('')}
        </div>`,
      footerHTML: '<button class="btn btn-primary modal-cancel">סגור</button>',
    });

    document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

    document.getElementById('add-recipe-group-btn')?.addEventListener('click', async () => {
      const name = document.getElementById('new-recipe-group')?.value.trim();
      if (!name) return showToast('הזן שם');
      try {
        await addRecipeGroup({ name, linkedCategoryGroupId: null });
        closeModal();
        showToast('נוסף ✓');
        renderRecipes(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });

    document.getElementById('import-groups-from-products')?.addEventListener('click', async () => {
      try {
        const n = await importRecipeGroupsFromProducts();
        closeModal();
        showToast(n ? `יובאו ${n} קטגוריות ✓` : 'אין קטגוריות חדשות לייבוא');
        renderRecipes(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });

    document.getElementById('add-recipe-sub-btn')?.addEventListener('click', async () => {
      const name = document.getElementById('new-recipe-sub')?.value.trim();
      if (!name) return showToast('הזן שם');
      try {
        await addRecipeSubCategory({ groupId, name, linkedCategoryId: null });
        closeModal();
        showToast('נוסף ✓');
        renderRecipes(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });

    document.getElementById('import-subs-from-products')?.addEventListener('click', async () => {
      try {
        const n = await importRecipeSubCategoriesFromProducts(groupId);
        closeModal();
        showToast(n ? `יובאו ${n} תת-קטגוריות ✓` : 'אין תת-קטגוריות חדשות לייבוא');
        renderRecipes(container);
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });

    document.querySelectorAll('.del-recipe-group').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('למחוק קטגוריה כללית וכל תת-הקטגוריות?')) return;
        try {
          await deleteRecipeGroup(Number(btn.dataset.id));
          closeModal();
          showToast('נמחק');
          renderRecipes(container);
        } catch (err) {
          showToast(err.message || 'שגיאה');
        }
      });
    });

    document.querySelectorAll('.del-recipe-sub').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('למחוק תת-קטגוריה?')) return;
        try {
          await deleteRecipeSubCategory(Number(btn.dataset.id));
          closeModal();
          showToast('נמחק');
          renderRecipes(container);
        } catch (err) {
          showToast(err.message || 'שגיאה');
        }
      });
    });
  });
}

function openImportPreview(container, parsed, { groupId, subId, groups, subs }) {
  openModal({
    title: `ייבוא ${parsed.length} מתכונים מ-Word`,
    bodyHTML: `
      <div class="form-group">
        <label>יעד שמירה (ניתן למיין אחר כך)</label>
        <select id="import-group">
          <option value="word-import" selected>${escapeHtml(IMPORT_WORD_GROUP)} · ${escapeHtml(IMPORT_WORD_SUB)}</option>
          ${groups.filter((g) => g.name !== IMPORT_WORD_GROUP).map((g) => `
            <option value="${g.id}" ${g.id === groupId ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" id="import-sub-wrap">
        <label>תת-קטגוריה</label>
        <select id="import-sub">
          <option value="word-import" selected>${escapeHtml(IMPORT_WORD_SUB)}</option>
          ${subs.filter((s) => s.name !== IMPORT_WORD_SUB).map((s) => `
            <option value="${s.id}" ${s.id === subId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="import-add-materials" checked>
          הוסף חומרי גלם לספקים (קטגוריה "ייבוא ממתכונים")
        </label>
      </div>
      <div class="form-group" style="max-height:240px;overflow:auto">
        <label>תצוגה מקדימה (${parsed.length} מתכונים)</label>
        ${parsed.map((r) => `
          <div style="margin-bottom:12px;padding:8px;background:#f8fafc;border-radius:8px">
            <strong>${escapeHtml(r.title)}</strong>
            <ul style="margin:4px 0 0;padding-right:18px;font-size:0.85rem">
              ${(r.ingredients || []).map((ing) => `<li>${escapeHtml(ing.name)} — ${ing.quantity} ${escapeHtml(ing.unit)}</li>`).join('')}
              ${!(r.ingredients || []).length ? '<li class="form-hint">אין חומרים מזוהים</li>' : ''}
            </ul>
          </div>`).join('')}
      </div>
      <p class="form-hint">תומך בטבלאות Word עם עמודות "כמות" ו"חומר גלם". שורת סה"כ מדולגת.</p>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="confirm-recipe-import">ייבוא הכל</button>`,
  });

  const groupSelect = document.getElementById('import-group');
  const subWrap = document.getElementById('import-sub-wrap');
  groupSelect?.addEventListener('change', () => {
    if (subWrap) subWrap.style.display = groupSelect.value === 'word-import' ? 'none' : '';
  });
  if (subWrap) subWrap.style.display = 'none';

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  document.getElementById('confirm-recipe-import')?.addEventListener('click', async () => {
    let gid = document.getElementById('import-group')?.value;
    let sid = document.getElementById('import-sub')?.value;
    const addRawMaterials = document.getElementById('import-add-materials')?.checked !== false;
    try {
      if (gid === 'word-import' || !gid) {
        const loc = await findOrCreateWordImportCategory();
        gid = loc.groupId;
        sid = loc.subCategoryId;
      } else {
        gid = Number(gid);
        sid = sid && sid !== 'word-import' ? Number(sid) : null;
        if (!sid) {
          const subList = await getRecipeSubCategories(gid);
          sid = subList[0]?.id;
        }
      }
      const result = await importParsedRecipes(parsed, {
        groupId: gid,
        subCategoryId: sid,
        addRawMaterials,
      });
      closeModal();
      container.dataset.recipeGroup = String(gid);
      container.dataset.recipeSub = String(sid);
      const matMsg = result.rawMaterialsAdded ? ` · ${result.rawMaterialsAdded} חומרים חדשים בספקים` : '';
      showToast(`יובאו ${result.imported} מתכונים${matMsg} ✓`);
      renderRecipes(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

function openRatioCalculator(recipe) {
  const ingredients = recipe.ingredients || [];
  if (!ingredients.length) return showToast('אין חומרים במתכון');

  const renderTable = (anchorId, targetQty) => {
    try {
      const scaled = scaleRecipeIngredients(ingredients, anchorId, targetQty);
      return scaled.map((ing) => `
        <tr${ing.id === Number(anchorId) ? ' class="ratio-anchor-row"' : ''}>
          <td>${escapeHtml(ing.name)}</td>
          <td>${ing.quantity} ${escapeHtml(ing.unit)}</td>
          <td><strong>${ing.scaledQuantity}</strong> ${escapeHtml(ing.unit)}</td>
        </tr>`).join('');
    } catch {
      return '';
    }
  };

  const defaultAnchor = ingredients[0].id;
  const defaultQty = ingredients[0].quantity;

  openModal({
    title: `מחשבון יחס — ${escapeHtml(recipe.name)}`,
    bodyHTML: `
      <p class="form-hint">שינוי כאן לא שומר את המתכון — רק מחשב יחס לפי חומר בסיס</p>
      <div class="form-group">
        <label>חומר בסיס</label>
        <select id="ratio-anchor">
          ${ingredients.map((ing) => `
            <option value="${ing.id}" ${ing.id === defaultAnchor ? 'selected' : ''}>
              ${escapeHtml(ing.name)} (${ing.quantity} ${escapeHtml(ing.unit)})
            </option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>כמות יעד</label>
        <input type="number" id="ratio-target" min="0.001" step="0.001" value="${defaultQty}">
      </div>
      <table class="ratio-table" id="ratio-table">
        <thead><tr><th>חומר</th><th>מקור</th><th>מחושב</th></tr></thead>
        <tbody id="ratio-tbody">${renderTable(defaultAnchor, defaultQty)}</tbody>
      </table>`,
    footerHTML: '<button class="btn btn-primary modal-cancel">סגור</button>',
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  const refresh = () => {
    const anchorId = document.getElementById('ratio-anchor')?.value;
    const target = document.getElementById('ratio-target')?.value;
    const tbody = document.getElementById('ratio-tbody');
    if (!tbody) return;
    try {
      tbody.innerHTML = renderTable(anchorId, target);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="3">${escapeHtml(err.message)}</td></tr>`;
    }
  };

  document.getElementById('ratio-anchor')?.addEventListener('change', refresh);
  document.getElementById('ratio-target')?.addEventListener('input', refresh);
}

async function openRecipeForm(container, { recipe, categoryId, products }) {
  const isEdit = !!recipe;
  const ingredients = recipe?.ingredients || [];
  const mats = await getRawMaterials();

  openModal({
    title: isEdit ? 'עריכת מתכון' : 'מתכון חדש',
    bodyHTML: `
      <div class="form-group">
        <label>שם מתכון</label>
        <input type="text" id="recipe-name" value="${recipe ? escapeHtml(recipe.name) : ''}">
      </div>
      <div class="form-group">
        <label>מנות למתכון (בסיס)</label>
        <input type="number" id="recipe-yield" min="0.1" step="0.1" value="${recipe?.yieldPortions ?? 1}">
      </div>
      <div class="form-group">
        <label>מוצר מקושר (סנכרון)</label>
        <select id="recipe-product">
          <option value="">— ללא —</option>
          ${products.map((p) => `
            <option value="${p.id}" ${recipe?.linkedProductId === p.id ? 'selected' : ''}>
              ${escapeHtml(p.name)}
            </option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>הערות</label>
        <textarea id="recipe-notes" rows="2">${recipe ? escapeHtml(recipe.notes || '') : ''}</textarea>
      </div>
      ${isEdit ? `
      <div class="form-group">
        <label>חומרי גלם</label>
        ${ingredients.length ? ingredients.map((ing) => {
    const kind = ing.unitKind || normalizeRecipeUnitKind(ing.unit);
    return `
          <div class="filter-row recipe-ing-row" style="margin-bottom:6px" data-ing-id="${ing.id}">
            <span style="flex:1;font-size:0.9rem">${escapeHtml(ing.name)}</span>
            <input type="number" class="ing-qty" min="0.001" step="0.001" value="${ing.quantity}" style="width:72px">
            <select class="ing-unit" style="width:72px">
              ${RECIPE_WEIGHT_UNITS.map((u) => `
                <option value="${u.id}" ${kind === u.id ? 'selected' : ''}>${u.label}</option>`).join('')}
            </select>
            <button type="button" class="btn btn-danger btn-sm del-ing" data-id="${ing.id}">🗑</button>
          </div>`;
  }).join('') : '<p class="form-hint">אין חומרים — הוסף למטה</p>'}
        <div class="filter-row" style="margin-top:8px">
          <select id="new-ing-mat" style="flex:1">
            <option value="">בחר מחסן / חומר...</option>
            ${mats.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}
          </select>
          <input type="text" id="new-ing-name" placeholder="או שם ידני" style="flex:1">
          <input type="number" id="new-ing-qty" min="0.001" step="0.001" placeholder="כמות" style="width:72px">
          <select id="new-ing-unit" style="width:72px">
            ${RECIPE_WEIGHT_UNITS.map((u) => `<option value="${u.id}">${u.label}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-secondary btn-sm" id="add-ing-btn">+</button>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="sync-product-cost" style="width:100%;margin-top:8px">
          🔄 עדכן מחיר חומרי גלם במוצר
        </button>
      </div>` : ''}`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-recipe">שמור</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);

  document.querySelectorAll('.recipe-ing-row').forEach((row) => {
    const ingId = Number(row.dataset.ingId);
    row.querySelector('.ing-qty')?.addEventListener('change', async (e) => {
      try {
        await updateRecipeIngredient(ingId, { quantity: e.target.value });
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
    row.querySelector('.ing-unit')?.addEventListener('change', async (e) => {
      try {
        await updateRecipeIngredient(ingId, { unitKind: e.target.value });
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  document.getElementById('add-ing-btn')?.addEventListener('click', async () => {
    const matId = Number(document.getElementById('new-ing-mat')?.value);
    const manualName = document.getElementById('new-ing-name')?.value.trim();
    const qty = document.getElementById('new-ing-qty')?.value;
    const unitKind = document.getElementById('new-ing-unit')?.value || 'kg';
    const mat = mats.find((m) => m.id === matId);
    const name = mat?.name || manualName;
    if (!name || !qty) return showToast('הזן שם וכמות');
    try {
      await addRecipeIngredient(recipe.id, {
        rawMaterialId: mat?.id || null,
        name,
        quantity: qty,
        unitKind,
      });
      closeModal();
      openRecipeForm(container, { recipe: await getRecipe(recipe.id), products });
      showToast('נוסף ✓');
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.querySelectorAll('.del-ing').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await deleteRecipeIngredient(Number(btn.dataset.id));
      closeModal();
      openRecipeForm(container, { recipe: await getRecipe(recipe.id), products });
    });
  });

  document.getElementById('sync-product-cost')?.addEventListener('click', async () => {
    try {
      const total = await syncProductCostFromRecipe(recipe.id);
      showToast(`עודכן במוצר: ${formatMoney(total)} ✓`);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('save-recipe')?.addEventListener('click', async () => {
    const data = {
      name: document.getElementById('recipe-name').value.trim(),
      yieldPortions: document.getElementById('recipe-yield').value,
      linkedProductId: document.getElementById('recipe-product').value || null,
      notes: document.getElementById('recipe-notes').value,
    };
    try {
      if (isEdit) {
        await updateRecipe(recipe.id, data);
      } else {
        await addRecipe({ ...data, categoryId });
      }
      closeModal();
      showToast('נשמר ✓');
      renderRecipes(container);
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}
