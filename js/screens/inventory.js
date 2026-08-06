import { escapeHtml, showToast, formatDateTime } from '../utils.js?v=419';
import { openModal, closeModal } from '../modal.js?v=419';
import { requestAutoBackupNow } from '../backup-service.js?v=419';
import {
  getInventoryStockRows,
  getInventoryMovements,
  adjustInventoryStock,
  addInventoryItemToShortages,
  inventoryLowCount,
  inventoryMovementKindLabel,
} from '../inventory-db.js?v=419';
import { getSupplierCategories } from '../kitchen-db.js?v=419';

export function inventoryMeta() {
  const tab = sessionStorage.getItem('yitzurInventoryTab') || 'stock';
  return {
    title: 'מלאי',
    subtitle: tab === 'movements' ? 'יומן תנועות מלאי' : 'יתרות חומרי גלם והתאמות מלאי',
  };
}

function stockBadge(row) {
  if (row.isLow) {
    return `<span class="accounts-status accounts-status--danger">מתחת למינימום</span>`;
  }
  if (!row.balance) {
    return `<span class="accounts-status accounts-status--warn">לא הוגדר</span>`;
  }
  return `<span class="accounts-status accounts-status--ok">תקין</span>`;
}

function formatQty(n, unit) {
  const q = Number(n);
  const s = Number.isFinite(q) ? String(q) : '0';
  return unit ? `${s} ${escapeHtml(unit)}` : s;
}

function formatDelta(delta, unit) {
  const d = Number(delta) || 0;
  const sign = d > 0 ? '+' : '';
  return `${sign}${formatQty(d, unit)}`;
}

function tabsHtml(active) {
  return `
    <div class="inventory-tabs" role="tablist">
      <button type="button" class="login-gate-tab ${active === 'stock' ? 'active' : ''}" data-inv-tab="stock">יתרות</button>
      <button type="button" class="login-gate-tab ${active === 'movements' ? 'active' : ''}" data-inv-tab="movements">יומן תנועות</button>
    </div>`;
}

function stockCard(row) {
  const m = row.material;
  return `
    <div class="card inventory-card" data-material-id="${m.id}">
      <div class="accounts-card-head">
        <div>
          <div class="card-title" style="margin-bottom:4px">${escapeHtml(m.name)}</div>
          <p class="form-hint" style="margin:0">${escapeHtml(row.categoryName)}${row.supplierName ? ` · ${escapeHtml(row.supplierName)}` : ''}</p>
          <p class="form-hint" style="margin:4px 0 0">
            במלאי: <strong>${formatQty(row.qtyOnHand, row.unit)}</strong>
            ${row.minQty != null ? ` · מינימום: ${formatQty(row.minQty, row.unit)}` : ''}
          </p>
          ${row.lastAdjustedAt ? `<p class="form-hint" style="margin:4px 0 0">עודכן: ${escapeHtml(formatDateTime(row.lastAdjustedAt))}${row.lastAdjustmentReason ? ` · ${escapeHtml(row.lastAdjustmentReason)}` : ''}</p>` : ''}
        </div>
        ${stockBadge(row)}
      </div>
      <div class="accounts-actions">
        <button type="button" class="btn btn-primary inventory-adjust" data-material-id="${m.id}">התאם מלאי</button>
        <button type="button" class="btn btn-secondary inventory-to-shortage" data-material-id="${m.id}">הוסף לחוסרים</button>
        <button type="button" class="btn btn-secondary inventory-show-moves" data-material-id="${m.id}" data-material-name="${escapeHtml(m.name)}">יומן</button>
      </div>
    </div>`;
}

function movementCard(m) {
  const deltaClass = Number(m.delta) > 0 ? 'lots-hit' : (Number(m.delta) < 0 ? '' : '');
  return `
    <div class="card inventory-card">
      <div class="accounts-card-head">
        <div>
          <div class="card-title" style="margin-bottom:4px">${escapeHtml(m.materialName || `חומר #${m.rawMaterialId}`)}</div>
          <p class="form-hint" style="margin:0">${escapeHtml(formatDateTime(m.at))} · ${escapeHtml(inventoryMovementKindLabel(m.kind))}</p>
          <p class="form-hint" style="margin:4px 0 0">
            <span class="${deltaClass}"><strong>${formatDelta(m.delta, m.unit)}</strong></span>
            · לפני: ${formatQty(m.qtyBefore, m.unit)} → אחרי: ${formatQty(m.qtyAfter, m.unit)}
          </p>
          ${m.reason ? `<p class="form-hint" style="margin:4px 0 0">${escapeHtml(m.reason)}</p>` : ''}
          ${m.userEmail ? `<p class="form-hint" style="margin:4px 0 0">${escapeHtml(m.userName || m.userEmail)}</p>` : ''}
        </div>
      </div>
    </div>`;
}

function openAdjustModal(row, onDone) {
  const m = row.material;
  openModal({
    title: `התאמת מלאי — ${m.name}`,
    bodyHTML: `
      <p class="form-hint">נוכחי: <strong>${formatQty(row.qtyOnHand, row.unit)}</strong></p>
      <div class="form-group">
        <label for="inv-delta">שינוי (+/−)</label>
        <input type="number" id="inv-delta" step="any" placeholder="לדוגמה 5 או -2" dir="ltr">
      </div>
      <div class="form-group">
        <label for="inv-set">או הגדר כמות סופית</label>
        <input type="number" id="inv-set" step="any" min="0" placeholder="אופציונלי" dir="ltr" value="">
      </div>
      <div class="form-group">
        <label for="inv-min">כמות מינימום (התראה)</label>
        <input type="number" id="inv-min" step="any" min="0" dir="ltr" value="${row.minQty != null ? escapeHtml(String(row.minQty)) : ''}">
      </div>
      <div class="form-group">
        <label for="inv-reason">סיבה</label>
        <input type="text" id="inv-reason" maxlength="200" placeholder="ספירה / קבלה / תיקון">
      </div>
      <p class="form-hint inv-adjust-error" style="display:none;color:var(--danger)"></p>
    `,
    footerHTML: `
      <button type="button" class="btn btn-secondary" id="inv-cancel">ביטול</button>
      <button type="button" class="btn btn-primary" id="inv-save">שמור</button>
    `,
  });

  document.getElementById('inv-cancel')?.addEventListener('click', () => closeModal());
  document.getElementById('inv-save')?.addEventListener('click', async () => {
    const errEl = document.querySelector('.inv-adjust-error');
    const deltaVal = document.getElementById('inv-delta')?.value;
    const setVal = document.getElementById('inv-set')?.value;
    const minVal = document.getElementById('inv-min')?.value;
    const reason = document.getElementById('inv-reason')?.value || '';
    try {
      const hasSet = setVal !== '' && setVal != null;
      const hasDelta = deltaVal !== '' && deltaVal != null;
      if (!hasSet && !hasDelta) {
        throw new Error('הזן שינוי או כמות סופית');
      }
      await adjustInventoryStock({
        rawMaterialId: m.id,
        delta: hasSet ? undefined : deltaVal,
        setQty: hasSet ? setVal : null,
        minQty: minVal,
        reason,
        unit: row.unit || m.unit || '',
      });
      closeModal();
      showToast('המלאי עודכן');
      requestAutoBackupNow();
      onDone();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'שגיאה';
        errEl.style.display = 'block';
      } else {
        showToast(err.message || 'שגיאה');
      }
    }
  });
}

async function renderStockTab(container) {
  const search = container.dataset.invSearch || '';
  const categoryId = container.dataset.invCategory || '';
  const lowOnly = container.dataset.invLowOnly === '1';

  let cats = [];
  let rows = [];
  try {
    [cats, rows] = await Promise.all([
      getSupplierCategories(),
      getInventoryStockRows({ search, categoryId: categoryId || null, lowOnly }),
    ]);
  } catch (err) {
    return `
      <div class="card" style="border:2px solid var(--danger)">
        <div class="card-title">שגיאה בטעינת מלאי</div>
        <p>${escapeHtml(err.message || err)}</p>
      </div>`;
  }

  const lowCount = inventoryLowCount(rows);
  const catOptions = [
    `<option value="">כל הקטגוריות</option>`,
    ...cats.map((c) => `<option value="${c.id}" ${String(c.id) === String(categoryId) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`),
  ].join('');

  return {
    html: `
      <div class="card">
        <div class="card-title">יתרות חומרי גלם</div>
        <p class="form-hint">התאם מלאי אחרי ספירה או קבלה. חומר מתחת למינימום — אפשר להוסיף לחוסרים.</p>
        <p class="form-hint" style="margin:0">מוצגים: <strong>${rows.length}</strong>${lowCount ? ` · מתחת למינימום: <strong style="color:var(--danger)">${lowCount}</strong>` : ''}</p>
        <form id="inv-filter-form" class="lots-search-form" style="margin-top:12px">
          <div class="form-group">
            <label for="inv-search">חיפוש</label>
            <input type="search" id="inv-search" value="${escapeHtml(search)}" placeholder="שם חומר">
          </div>
          <div class="form-group">
            <label for="inv-category">קטגוריית ספק</label>
            <select id="inv-category">${catOptions}</select>
          </div>
          <label class="form-hint" style="display:flex;gap:8px;align-items:center;margin:8px 0">
            <input type="checkbox" id="inv-low-only" ${lowOnly ? 'checked' : ''}>
            הצג רק מתחת למינימום
          </label>
          <button type="submit" class="btn btn-primary">סנן</button>
        </form>
      </div>
      ${rows.length ? rows.map(stockCard).join('') : '<div class="card"><p class="form-hint">אין חומרי גלם להצגה. הוסף במחסן שבעמדת ספקים.</p></div>'}
    `,
    rows,
  };
}

async function renderMovementsTab(container) {
  const search = container.dataset.invMoveSearch || '';
  const materialId = container.dataset.invMoveMaterial || '';
  let moves = [];
  try {
    moves = await getInventoryMovements({
      rawMaterialId: materialId || null,
      search,
      limit: 250,
    });
  } catch (err) {
    return {
      html: `
        <div class="card" style="border:2px solid var(--danger)">
          <div class="card-title">שגיאה בטעינת יומן</div>
          <p>${escapeHtml(err.message || err)}</p>
        </div>`,
    };
  }

  return {
    html: `
      <div class="card">
        <div class="card-title">יומן תנועות מלאי</div>
        <p class="form-hint">כל התאמה (+/− / הגדרה) נרשמת כאן עם כמות לפני/אחרי, סיבה ומשתמש.</p>
        <form id="inv-move-filter" class="lots-search-form" style="margin-top:12px">
          <div class="form-group">
            <label for="inv-move-search">חיפוש</label>
            <input type="search" id="inv-move-search" value="${escapeHtml(search)}" placeholder="חומר / סיבה / משתמש">
          </div>
          ${materialId ? `<p class="form-hint">מסונן לפי חומר #${escapeHtml(materialId)} · <button type="button" class="btn btn-secondary" id="inv-clear-mat-filter">הצג הכל</button></p>` : ''}
          <button type="submit" class="btn btn-primary">סנן</button>
        </form>
        <p class="form-hint" style="margin:8px 0 0">מוצגות ${moves.length} תנועות אחרונות</p>
      </div>
      ${moves.length ? moves.map(movementCard).join('') : '<div class="card"><p class="form-hint">עדיין אין תנועות. בצע התאמת מלאי בטאב «יתרות».</p></div>'}
    `,
  };
}

export async function renderInventory(container) {
  const tab = container.dataset.invTab || sessionStorage.getItem('yitzurInventoryTab') || 'stock';
  container.dataset.invTab = tab;
  sessionStorage.setItem('yitzurInventoryTab', tab);

  container.innerHTML = `<div class="card"><p class="form-hint">טוען מלאי...</p></div>`;

  let body = '';
  let stockRows = [];
  if (tab === 'movements') {
    const res = await renderMovementsTab(container);
    body = res.html;
  } else {
    const res = await renderStockTab(container);
    body = res.html;
    stockRows = res.rows || [];
  }

  const titleEl = document.getElementById('page-subtitle');
  if (titleEl) titleEl.textContent = inventoryMeta().subtitle;

  container.innerHTML = `
    <div class="card">
      <div class="card-title">מלאי</div>
      ${tabsHtml(tab)}
    </div>
    ${body}
  `;

  container.querySelectorAll('[data-inv-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.invTab = btn.dataset.invTab;
      sessionStorage.setItem('yitzurInventoryTab', btn.dataset.invTab);
      renderInventory(container);
    });
  });

  container.querySelector('#inv-filter-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    container.dataset.invSearch = container.querySelector('#inv-search')?.value || '';
    container.dataset.invCategory = container.querySelector('#inv-category')?.value || '';
    container.dataset.invLowOnly = container.querySelector('#inv-low-only')?.checked ? '1' : '0';
    renderInventory(container);
  });

  container.querySelector('#inv-move-filter')?.addEventListener('submit', (e) => {
    e.preventDefault();
    container.dataset.invMoveSearch = container.querySelector('#inv-move-search')?.value || '';
    renderInventory(container);
  });

  container.querySelector('#inv-clear-mat-filter')?.addEventListener('click', () => {
    delete container.dataset.invMoveMaterial;
    renderInventory(container);
  });

  container.querySelectorAll('.inventory-adjust').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.materialId);
      const row = stockRows.find((r) => r.material.id === id);
      if (!row) return;
      openAdjustModal(row, () => renderInventory(container));
    });
  });

  container.querySelectorAll('.inventory-to-shortage').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await addInventoryItemToShortages(Number(btn.dataset.materialId));
        showToast('נוסף לחוסרים');
        requestAutoBackupNow();
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.inventory-show-moves').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.invTab = 'movements';
      container.dataset.invMoveMaterial = btn.dataset.materialId || '';
      sessionStorage.setItem('yitzurInventoryTab', 'movements');
      renderInventory(container);
    });
  });
}
