import {
  getRecipeCategories, getRecipes, getRecipe, addRecipeCategory,
  addRecipe, updateRecipe, deleteRecipe, addRecipeIngredient, deleteRecipeIngredient,
  syncProductCostFromRecipe, getRawMaterials,
} from '../kitchen-db.js';
import { getProducts } from '../db.js';
import { escapeHtml, showToast, formatMoney } from '../utils.js';
import { openModal, closeModal } from '../modal.js';

export function recipesMeta() {
  return { title: 'מתכונים', subtitle: 'קטגוריות, מתכונים וקישור למוצרים' };
}

export async function renderRecipes(container) {
  const selectedCat = container.dataset.recipeCat || '';
  const [categories, recipes, products] = await Promise.all([
    getRecipeCategories(),
    getRecipes(selectedCat ? Number(selectedCat) : null),
    getProducts(true),
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const catMap = new Map(categories.map((c) => [c.id, c.name]));

  if (!selectedCat && categories.length) {
    container.dataset.recipeCat = String(categories[0].id);
    return renderRecipes(container);
  }

  container.innerHTML = `
    <div class="card">
      <div class="card-title">קטגוריות מתכונים</div>
      <div class="workspace-chip-row">
        ${categories.map((c) => `
          <button type="button" class="workspace-chip${String(c.id) === selectedCat ? ' active' : ''}"
            data-recipe-cat="${c.id}">${escapeHtml(c.name)}</button>`).join('')}
        <button type="button" class="workspace-chip workspace-chip--add" id="add-recipe-cat">+ קטגוריה</button>
      </div>
    </div>

    <div class="card">
      <div class="filter-row" style="margin-bottom:12px">
        <div class="card-title" style="margin:0;flex:1">מתכונים${selectedCat ? ` · ${escapeHtml(catMap.get(Number(selectedCat)) || '')}` : ''}</div>
        <button type="button" class="btn btn-primary btn-sm" id="add-recipe-btn">+ מתכון</button>
      </div>
      ${recipes.length === 0
    ? '<p class="form-hint">אין מתכונים — הוסף מתכון וקשר למוצר לסנכרון כמויות</p>'
    : recipes.map((r) => {
      const prod = r.linkedProductId ? productMap.get(r.linkedProductId) : null;
      return `
        <div class="list-item" data-recipe-id="${r.id}">
          <div class="list-item-info">
            <div class="list-item-name">${escapeHtml(r.name)}</div>
            <div class="list-item-meta">
              ${prod ? `🔗 ${escapeHtml(prod.name)}` : 'ללא מוצר'}
              · ${r.yieldPortions || 1} מנות
            </div>
          </div>
          <div class="list-item-actions">
            <button type="button" class="btn btn-secondary btn-sm edit-recipe" data-id="${r.id}">✏️</button>
            <button type="button" class="btn btn-danger btn-sm delete-recipe" data-id="${r.id}">🗑</button>
          </div>
        </div>`;
    }).join('')}
    </div>`;

  container.querySelectorAll('[data-recipe-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.recipeCat = btn.dataset.recipeCat;
      renderRecipes(container);
    });
  });

  document.getElementById('add-recipe-cat')?.addEventListener('click', () => {
    const name = prompt('שם קטגוריה חדשה:');
    if (!name?.trim()) return;
    addRecipeCategory(name.trim())
      .then(() => { showToast('נוסף ✓'); renderRecipes(container); })
      .catch((e) => showToast(e.message || 'שגיאה'));
  });

  document.getElementById('add-recipe-btn')?.addEventListener('click', () => {
    openRecipeForm(container, { categoryId: Number(selectedCat), products });
  });

  container.querySelectorAll('.edit-recipe').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const recipe = await getRecipe(Number(btn.dataset.id));
      if (recipe) openRecipeForm(container, { recipe, products });
    });
  });

  container.querySelectorAll('.delete-recipe').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק מתכון?')) return;
      try {
        await deleteRecipe(Number(btn.dataset.id));
        showToast('נמחק');
        renderRecipes(container);
      } catch (e) {
        showToast(e.message || 'שגיאה');
      }
    });
  });
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
        ${ingredients.length ? ingredients.map((ing) => `
          <div class="filter-row" style="margin-bottom:6px">
            <span style="flex:1;font-size:0.9rem">${escapeHtml(ing.name)} — ${ing.quantity} ${escapeHtml(ing.unit)}</span>
            <button type="button" class="btn btn-danger btn-sm del-ing" data-id="${ing.id}">🗑</button>
          </div>`).join('') : '<p class="form-hint">אין חומרים — הוסף למטה</p>'}
        <div class="filter-row" style="margin-top:8px">
          <select id="new-ing-mat" style="flex:1">
            <option value="">בחר מחסן / חומר...</option>
            ${mats.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}
          </select>
          <input type="number" id="new-ing-qty" min="0.001" step="0.001" placeholder="כמות" style="width:80px">
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

  document.getElementById('add-ing-btn')?.addEventListener('click', async () => {
    const matId = Number(document.getElementById('new-ing-mat')?.value);
    const qty = document.getElementById('new-ing-qty')?.value;
    const mat = mats.find((m) => m.id === matId);
    if (!mat || !qty) return showToast('בחר חומר וכמות');
    try {
      await addRecipeIngredient(recipe.id, {
        rawMaterialId: mat.id,
        name: mat.name,
        quantity: qty,
        unit: mat.unit,
      });
      closeModal();
      openRecipeForm(container, { recipe: await getRecipe(recipe.id), products });
      showToast('נוסף ✓');
    } catch (e) {
      showToast(e.message || 'שגיאה');
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
    } catch (e) {
      showToast(e.message || 'שגיאה');
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
    } catch (e) {
      showToast(e.message || 'שגיאה');
    }
  });
}
