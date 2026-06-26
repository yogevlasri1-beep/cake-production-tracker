import {
  getSupplierCategories, getSuppliers, addSupplierCategory, addSupplier, updateSupplier, deleteSupplier,
  getRawMaterials, addRawMaterial, updateRawMaterial, deleteRawMaterial,
  getWeeklyPlan, setWeeklyPlanItem, computeWeeklyMaterialNeeds, formatWhatsAppOrderText,
  getRecipeForProduct, setSupplierOrder, setRawMaterialOrder,
} from '../kitchen-db.js';
import { getProducts } from '../db.js';
import { escapeHtml, showToast, formatMoney, weekStartISO, formatDate } from '../utils.js';
import { openModal, closeModal } from '../modal.js';
import { requestAutoBackupNow } from '../backup-service.js';
import { bindSupplierDragList, bindMaterialDragList } from '../product-drag.js';

export function suppliersMeta() {
  return { title: 'ספקים', subtitle: 'חומרי גלם, תוכנית שבועית והזמנות' };
}

const TABS = [
  { id: 'materials', label: 'חומרי גלם' },
  { id: 'suppliers', label: 'ספקים' },
  { id: 'plan', label: 'תוכנית שבועית' },
  { id: 'order', label: 'רשימת הזמנה' },
];

export async function renderSuppliers(container) {
  const tab = container.dataset.supplierTab || 'plan';
  const weekStart = container.dataset.planWeek || weekStartISO();
  const selectedMatCat = container.dataset.matCat || '';
  const selectedSupCat = container.dataset.supCat || '';

  const [supCats, matCats, products] = await Promise.all([
    getSupplierCategories(),
    getSupplierCategories(),
    getProducts(true),
  ]);

  if (!selectedMatCat && supCats.length) container.dataset.matCat = String(supCats[0].id);
  if (!selectedSupCat && supCats.length) container.dataset.supCat = String(supCats[0].id);

  container.innerHTML = `
    <div class="card workspace-tabs-card">
      <div class="workspace-tab-row">
        ${TABS.map((t) => `
          <button type="button" class="workspace-tab${tab === t.id ? ' active' : ''}" data-tab="${t.id}">
            ${t.label}
          </button>`).join('')}
      </div>
    </div>
    <div id="supplier-tab-body"><p style="text-align:center;padding:24px;color:var(--text-muted)">טוען...</p></div>`;

  container.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.supplierTab = btn.dataset.tab;
      renderSuppliers(container);
    });
  });

  const body = document.getElementById('supplier-tab-body');
  if (tab === 'materials') await renderMaterialsTab(body, container, supCats, selectedMatCat || container.dataset.matCat);
  else if (tab === 'suppliers') await renderSuppliersTab(body, container, supCats, selectedSupCat || container.dataset.supCat);
  else if (tab === 'plan') await renderPlanTab(body, container, products, weekStart);
  else await renderOrderTab(body, container, weekStart);
}

async function renderMaterialsTab(body, container, categories, selectedCat) {
  const [materials, suppliers] = await Promise.all([
    getRawMaterials(Number(selectedCat)),
    getSuppliers(),
  ]);
  const supMap = new Map(suppliers.map((s) => [s.id, s.name]));
  const catMap = new Map(categories.map((c) => [c.id, c.name]));

  body.innerHTML = `
    <div class="card">
      <div class="card-title">קטגוריות חומרי גלם</div>
      <div class="workspace-chip-row">
        ${categories.map((c) => `
          <button type="button" class="workspace-chip${String(c.id) === String(selectedCat) ? ' active' : ''}"
            data-mat-cat="${c.id}">${escapeHtml(c.name)}</button>`).join('')}
        <button type="button" class="workspace-chip workspace-chip--add" id="add-sup-cat-mat">+ קטגוריה</button>
      </div>
    </div>
    <div class="card">
      <div class="filter-row" style="margin-bottom:12px">
        <div class="card-title" style="margin:0;flex:1">${escapeHtml(catMap.get(Number(selectedCat)) || 'חומרים')}</div>
        <button type="button" class="btn btn-primary btn-sm" id="add-material">+ חומר</button>
      </div>
      <p class="form-hint" style="margin-bottom:8px">גרור ☰ לשינוי סדר חומרי גלם</p>
      ${materials.length === 0
    ? '<p class="form-hint">אין חומרים — הוסף חומרי גלם לפי קטגוריה</p>'
    : `<div class="material-list" data-cat-id="${selectedCat}">
        ${materials.map((m, i) => `
        <div class="list-item material-list-item" data-material-id="${m.id}">
          <button type="button" class="material-drag-handle" aria-label="גרור לשינוי סדר">☰</button>
          <span class="material-order-num" aria-hidden="true">${i + 1}</span>
          <div class="list-item-info">
            <div class="list-item-name">${escapeHtml(m.name)}</div>
            <div class="list-item-meta">
              ${formatMoney(m.unitPrice)}/${escapeHtml(m.unit)}
              ${m.supplierId ? ` · ${escapeHtml(supMap.get(m.supplierId) || '')}` : ''}
            </div>
          </div>
          <div class="list-item-actions">
            <button type="button" class="btn btn-danger btn-sm del-mat" data-id="${m.id}">🗑</button>
          </div>
        </div>`).join('')}
      </div>`}
    </div>`;

  body.querySelectorAll('[data-mat-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.matCat = btn.dataset.matCat;
      renderSuppliers(container);
    });
  });

  document.getElementById('add-sup-cat-mat')?.addEventListener('click', () => {
    const name = prompt('שם קטגוריית ספקים:');
    if (!name?.trim()) return;
    addSupplierCategory(name.trim()).then(() => renderSuppliers(container)).catch((e) => showToast(e.message));
  });

  document.getElementById('add-material')?.addEventListener('click', () => {
    openModal({
      title: 'חומר גלם חדש',
      bodyHTML: `
        <div class="form-group"><label>שם</label><input type="text" id="mat-name"></div>
        <div class="form-group"><label>יחידה</label><input type="text" id="mat-unit" value="ק&quot;ג" placeholder="ק&quot;ג / יח"></div>
        <div class="form-group"><label>מחיר ליחידה (₪)</label><input type="number" id="mat-price" min="0" step="0.01"></div>
        <div class="form-group"><label>ספק (רשות)</label>
          <select id="mat-supplier"><option value="">—</option>
            ${suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>`,
      footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-mat">שמור</button>`,
    });
    document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('save-mat')?.addEventListener('click', async () => {
      try {
        await addRawMaterial({
          supplierCategoryId: Number(selectedCat),
          name: document.getElementById('mat-name').value,
          unit: document.getElementById('mat-unit').value,
          unitPrice: document.getElementById('mat-price').value,
          supplierId: document.getElementById('mat-supplier').value || null,
        });
        closeModal();
        showToast('נוסף ✓');
        requestAutoBackupNow().catch(() => {});
        renderSuppliers(container);
      } catch (e) {
        showToast(e.message || 'שגיאה');
      }
    });
  });

  body.querySelectorAll('.del-mat').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק?')) return;
      await deleteRawMaterial(Number(btn.dataset.id));
      renderSuppliers(container);
    });
  });

  if (materials.length) {
    bindMaterialDragList(body, Number(selectedCat), async (orderedIds) => {
      await setRawMaterialOrder(Number(selectedCat), orderedIds);
    });
  }
}

async function renderSuppliersTab(body, container, categories, selectedCat) {
  const suppliers = await getSuppliers(Number(selectedCat));
  const catMap = new Map(categories.map((c) => [c.id, c.name]));

  body.innerHTML = `
    <div class="card">
      <div class="workspace-chip-row">
        ${categories.map((c) => `
          <button type="button" class="workspace-chip${String(c.id) === String(selectedCat) ? ' active' : ''}"
            data-sup-cat="${c.id}">${escapeHtml(c.name)}</button>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="filter-row" style="margin-bottom:12px">
        <div class="card-title" style="margin:0;flex:1">ספקים · ${escapeHtml(catMap.get(Number(selectedCat)) || '')}</div>
        <button type="button" class="btn btn-primary btn-sm" id="add-supplier">+ ספק</button>
      </div>
      <p class="form-hint" style="margin-bottom:8px">גרור ☰ לשינוי סדר ספקים</p>
      ${suppliers.length === 0
    ? '<p class="form-hint">אין ספקים בקטגוריה</p>'
    : `<div class="supplier-list" data-cat-id="${selectedCat}">
        ${suppliers.map((s, i) => `
        <div class="list-item supplier-list-item" data-supplier-id="${s.id}">
          <button type="button" class="supplier-drag-handle" aria-label="גרור לשינוי סדר">☰</button>
          <span class="supplier-order-num" aria-hidden="true">${i + 1}</span>
          <div class="list-item-info">
            <div class="list-item-name">${escapeHtml(s.name)}</div>
            <div class="list-item-meta">
              ${s.whatsapp ? `📱 ${escapeHtml(s.whatsapp)}` : (s.phone ? `📞 ${escapeHtml(s.phone)}` : 'ללא טלפון')}
            </div>
          </div>
          <div class="list-item-actions">
            ${s.whatsapp ? `<a class="btn btn-secondary btn-sm" href="https://wa.me/${s.whatsapp.replace(/\D/g, '')}" target="_blank" rel="noopener">וואטסאפ</a>` : ''}
            <button type="button" class="btn btn-danger btn-sm del-sup" data-id="${s.id}">🗑</button>
          </div>
        </div>`).join('')}
      </div>`}
    </div>`;

  body.querySelectorAll('[data-sup-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.supCat = btn.dataset.supCat;
      renderSuppliers(container);
    });
  });

  document.getElementById('add-supplier')?.addEventListener('click', () => {
    openModal({
      title: 'ספק חדש',
      bodyHTML: `
        <div class="form-group"><label>שם</label><input type="text" id="sup-name"></div>
        <div class="form-group"><label>וואטסאפ / טלפון</label><input type="tel" id="sup-wa" placeholder="972501234567"></div>
        <div class="form-group"><label>הערות</label><input type="text" id="sup-notes"></div>`,
      footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-sup">שמור</button>`,
    });
    document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('save-sup')?.addEventListener('click', async () => {
      try {
        await addSupplier({
          categoryId: Number(selectedCat),
          name: document.getElementById('sup-name').value,
          whatsapp: document.getElementById('sup-wa').value,
          notes: document.getElementById('sup-notes').value,
        });
        closeModal();
        showToast('נוסף ✓');
        renderSuppliers(container);
      } catch (e) {
        showToast(e.message || 'שגיאה');
      }
    });
  });

  body.querySelectorAll('.del-sup').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק ספק?')) return;
      await deleteSupplier(Number(btn.dataset.id));
      renderSuppliers(container);
    });
  });

  if (suppliers.length) {
    bindSupplierDragList(body, Number(selectedCat), async (orderedIds) => {
      await setSupplierOrder(Number(selectedCat), orderedIds);
    });
  }
}

async function renderPlanTab(body, container, products, weekStart) {
  const plan = await getWeeklyPlan(weekStart);
  const planMap = new Map(plan.items.map((i) => [i.productId, i.plannedPortions]));

  body.innerHTML = `
    <div class="card">
      <div class="card-title">תוכנית ייצור שבועית</div>
      <p class="form-hint" style="margin-bottom:10px">שבוע שמתחיל ב-${formatDate(weekStart)} — הזן כמה מנות מתכנן לייצר</p>
      <div class="form-group">
        <label>תחילת שבוע</label>
        <input type="date" id="plan-week" value="${weekStart}">
      </div>
      ${products.length === 0
    ? '<p class="form-hint">אין מוצרים — הוסף במסך מוצרים (תיעוד יצור)</p>'
    : products.map((p) => {
      const recipe = planMap.has(p.id);
      return `
        <div class="list-item plan-product-row">
          <div class="list-item-info">
            <div class="list-item-name">${escapeHtml(p.name)}</div>
            <div class="list-item-meta plan-recipe-hint" data-pid="${p.id}">בודק מתכון...</div>
          </div>
          <input type="number" class="plan-portions-input" data-pid="${p.id}" min="0" step="1"
            value="${planMap.get(p.id) ?? ''}" placeholder="0">
        </div>`;
    }).join('')}
    </div>`;

  document.getElementById('plan-week')?.addEventListener('change', (e) => {
    container.dataset.planWeek = e.target.value;
    renderSuppliers(container);
  });

  for (const el of body.querySelectorAll('.plan-recipe-hint')) {
    const pid = Number(el.dataset.pid);
    const r = await getRecipeForProduct(pid);
    el.textContent = r ? `📒 ${r.name} (${r.yieldPortions} מנות)` : '⚠️ אין מתכון מקושר';
  }

  body.querySelectorAll('.plan-portions-input').forEach((input) => {
    input.addEventListener('change', async () => {
      try {
        await setWeeklyPlanItem(plan.id, Number(input.dataset.pid), input.value);
        requestAutoBackupNow().catch(() => {});
        showToast('נשמר ✓');
      } catch (e) {
        showToast(e.message || 'שגיאה');
      }
    });
  });
}

async function renderOrderTab(body, container, weekStart) {
  const { categories } = await computeWeeklyMaterialNeeds(weekStart);
  const text = formatWhatsAppOrderText({ weekStart, categories });

  body.innerHTML = `
    <div class="card">
      <div class="card-title">רשימת הזמנה — שבוע ${formatDate(weekStart)}</div>
      <p class="form-hint" style="margin-bottom:12px">מחושב מתוכנית השבועית + מתכונים מקושרים למוצרים</p>
      ${categories.length === 0
    ? '<p class="form-hint">אין פריטים — מלא תוכנית שבועית וקשר מתכונים למוצרים</p>'
    : categories.map((cat) => `
        <div class="order-category-block">
          <h3 class="order-category-title">${escapeHtml(cat.categoryName)}</h3>
          <ul class="order-items-list">
            ${cat.items.map((item) => `
              <li><strong>${escapeHtml(item.name)}</strong>: ${item.totalQty} ${escapeHtml(item.unit)}</li>`).join('')}
          </ul>
        </div>`).join('')}
      <textarea id="wa-order-text" class="wa-order-text" rows="10" readonly>${escapeHtml(text)}</textarea>
      <button type="button" class="btn btn-primary" id="copy-wa-order" style="width:100%;margin-top:8px">📋 העתק לוואטסאפ</button>
      <button type="button" class="btn btn-secondary" id="share-wa-order" style="width:100%;margin-top:8px">שתף...</button>
    </div>`;

  document.getElementById('copy-wa-order')?.addEventListener('click', async () => {
    const ta = document.getElementById('wa-order-text');
    try {
      await navigator.clipboard.writeText(ta.value);
      showToast('הועתק ✓ — הדבק בוואטסאפ');
    } catch {
      ta.select();
      document.execCommand('copy');
      showToast('הועתק ✓');
    }
  });

  document.getElementById('share-wa-order')?.addEventListener('click', async () => {
    const ta = document.getElementById('wa-order-text');
    if (navigator.share) {
      try {
        await navigator.share({ title: 'הזמנת חומרי גלם', text: ta.value });
      } catch {
        /* cancelled */
      }
    } else {
      document.getElementById('copy-wa-order')?.click();
    }
  });
}
