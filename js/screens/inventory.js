import { escapeHtml, showToast, formatDateTime, weekStartISO, todayISO } from '../utils.js?v=468';
import { openModal, closeModal } from '../modal.js?v=468';
import { requestAutoBackupNow } from '../backup-service.js?v=468';
import {
  getInventoryStockRows,
  getInventoryMovements,
  adjustInventoryStock,
  addInventoryItemToShortages,
  inventoryLowCount,
  inventoryMovementKindLabel,
  computeWeeklyInventoryGaps,
  formatWhatsAppGapOrderText,
} from '../inventory-db.js?v=468';
import { getSupplierCategories, findRawMaterialsByBarcode } from '../kitchen-db.js?v=468';
import { getCurrentUserRole } from '../auth.js?v=468';
import { canAdjustInventory, PERMISSION_DENIED_MESSAGE } from '../permissions.js?v=468';
import { openBarcodeScanner } from '../barcode-scan.js?v=468';

const TAB_SUBTITLES = {
  stock: 'יתרות חומרי גלם והתאמות מלאי',
  movements: 'יומן תנועות מלאי',
  gap: 'פער מול תחזית רכש שבועית',
};

export function inventoryMeta() {
  const tab = sessionStorage.getItem('yitzurInventoryTab') || 'stock';
  return {
    title: 'מלאי',
    subtitle: TAB_SUBTITLES[tab] || TAB_SUBTITLES.stock,
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
      <button type="button" class="login-gate-tab ${active === 'gap' ? 'active' : ''}" data-inv-tab="gap">פער הזמנה</button>
      <button type="button" class="login-gate-tab ${active === 'movements' ? 'active' : ''}" data-inv-tab="movements">יומן תנועות</button>
    </div>`;
}

function stockCard(row, { allowAdjust = true } = {}) {
  const m = row.material;
  return `
    <div class="card inventory-card" data-material-id="${m.id}">
      <div class="accounts-card-head">
        <div>
          <div class="card-title" style="margin-bottom:4px">${escapeHtml(m.name)}</div>
          <p class="form-hint" style="margin:0">${escapeHtml(row.categoryName)}</p>
          <p class="form-hint" style="margin:4px 0 0">
            במלאי: <strong>${formatQty(row.qtyOnHand, row.unit)}</strong>
            ${row.minQty != null ? ` · מינימום: ${formatQty(row.minQty, row.unit)}` : ''}
          </p>
          ${row.lastAdjustedAt ? `<p class="form-hint" style="margin:4px 0 0">עודכן: ${escapeHtml(formatDateTime(row.lastAdjustedAt))}${row.lastAdjustmentReason ? ` · ${escapeHtml(row.lastAdjustmentReason)}` : ''}</p>` : ''}
        </div>
        ${stockBadge(row)}
      </div>
      <div class="accounts-actions">
        ${allowAdjust ? `<button type="button" class="btn btn-primary inventory-adjust" data-material-id="${m.id}">התאם מלאי</button>` : ''}
        <button type="button" class="btn btn-secondary inventory-to-shortage" data-material-id="${m.id}">הוסף לחוסרים</button>
        <button type="button" class="btn btn-secondary inventory-show-moves" data-material-id="${m.id}" data-material-name="${escapeHtml(m.name)}">יומן</button>
      </div>
    </div>`;
}

const INV_SUPPLIER_COLLAPSE_KEY = 'yitzurInventorySupplierCollapsed';

function getCollapsedSupplierIds() {
  try {
    const raw = sessionStorage.getItem(INV_SUPPLIER_COLLAPSE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveCollapsedSupplierIds(set) {
  try {
    sessionStorage.setItem(INV_SUPPLIER_COLLAPSE_KEY, JSON.stringify([...set]));
  } catch { /* ignore */ }
}

function groupStockRowsBySupplier(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.supplierId != null ? String(row.supplierId) : 'none';
    if (!map.has(key)) {
      map.set(key, {
        key,
        supplierId: row.supplierId,
        supplierName: row.supplierName || 'ללא ספק',
        raw: [],
        packaging: [],
        cleaning: [],
      });
    }
    const g = map.get(key);
    if (row.isPackaging) g.packaging.push(row);
    else if (row.isCleaning) g.cleaning.push(row);
    else g.raw.push(row);
  }

  const sortByName = (a, b) => String(a.material.name || '').localeCompare(String(b.material.name || ''), 'he');
  const groups = [...map.values()];
  for (const g of groups) {
    g.raw.sort(sortByName);
    g.packaging.sort(sortByName);
    g.cleaning.sort(sortByName);
    g.lowCount = [...g.raw, ...g.packaging, ...g.cleaning].filter((r) => r.isLow).length;
    g.totalCount = g.raw.length + g.packaging.length + g.cleaning.length;
  }
  groups.sort((a, b) => {
    if (a.key === 'none') return 1;
    if (b.key === 'none') return -1;
    return a.supplierName.localeCompare(b.supplierName, 'he');
  });
  return groups;
}

function stockSectionHtml(title, sectionRows, { allowAdjust }) {
  if (!sectionRows.length) return '';
  return `
    <div class="inventory-kind-section">
      <h4 class="inventory-kind-title">${escapeHtml(title)}
        <span class="inventory-kind-count">(${sectionRows.length})</span>
      </h4>
      <div class="inventory-kind-list">
        ${sectionRows.map((r) => stockCard(r, { allowAdjust })).join('')}
      </div>
    </div>`;
}

function stockSupplierGroupHtml(group, { allowAdjust, collapsed }) {
  const meta = [];
  if (group.raw.length) meta.push(`${group.raw.length} חומרי גלם`);
  if (group.packaging.length) meta.push(`${group.packaging.length} אריזות`);
  if (group.cleaning.length) meta.push(`${group.cleaning.length} ניקיון`);
  if (group.lowCount) meta.push(`${group.lowCount} מתחת למינימום`);

  return `
    <section class="inventory-supplier-group${collapsed ? ' is-collapsed' : ''}" data-supplier-key="${escapeHtml(group.key)}">
      <button type="button" class="inventory-supplier-toggle" aria-expanded="${collapsed ? 'false' : 'true'}">
        <span class="inventory-supplier-chevron" aria-hidden="true"></span>
        <span class="inventory-supplier-heading">
          <span class="inventory-supplier-name">${escapeHtml(group.supplierName)}</span>
          <span class="inventory-supplier-meta">${escapeHtml(meta.join(' · '))}</span>
        </span>
      </button>
      <div class="inventory-supplier-body">
        ${stockSectionHtml('חומרי גלם', group.raw, { allowAdjust })}
        ${stockSectionHtml('אריזות', group.packaging, { allowAdjust })}
        ${stockSectionHtml('חומרי ניקיון', group.cleaning, { allowAdjust })}
      </div>
    </section>`;
}

function movementCard(m) {
  const deltaClass = Number(m.delta) > 0 ? 'lots-hit' : (Number(m.delta) < 0 ? '' : '');
  const lotBits = [];
  if (m.packagingBatchNumber) lotBits.push(`מנה <span dir="ltr">${escapeHtml(m.packagingBatchNumber)}</span>`);
  if (m.runBatchNumber) lotBits.push(`אצווה <span dir="ltr">${escapeHtml(m.runBatchNumber)}</span>`);
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
          ${lotBits.length ? `<p class="form-hint" style="margin:4px 0 0">${lotBits.join(' · ')}</p>` : ''}
          ${m.reason ? `<p class="form-hint" style="margin:4px 0 0">${escapeHtml(m.reason)}</p>` : ''}
          ${m.userEmail ? `<p class="form-hint" style="margin:4px 0 0">${escapeHtml(m.userName || m.userEmail)}</p>` : ''}
        </div>
      </div>
    </div>`;
}

async function openReceiveByBarcodeModal(onDone) {
  if (!canAdjustInventory(getCurrentUserRole())) {
    showToast(PERMISSION_DENIED_MESSAGE);
    return;
  }
  openBarcodeScanner({
    onDecode: async (text) => {
      try {
        const matches = await findRawMaterialsByBarcode(text);
        if (!matches.length) {
          showToast('לא נמצא חומר עם הברקוד הזה');
          return;
        }
        const mat = matches[0];
        const rows = await getInventoryStockRows({ search: mat.name });
        const row = rows.find((r) => Number(r.material?.id) === Number(mat.id))
          || {
            material: mat,
            qtyOnHand: 0,
            unit: mat.unit || '',
            minQty: null,
            balance: null,
            isLow: false,
          };
        // פותח התאמה עם רמז לקבלה
        await openAdjustModal(row, onDone, { receiveHint: true, scannedBarcode: text });
      } catch (err) {
        showToast(err.message || 'שגיאה בסריקה');
      }
    },
  });
}

async function openAdjustModal(row, onDone, { receiveHint = false, scannedBarcode = '' } = {}) {
  const m = row.material;
  const { renderLotPickerFieldHTML, bindLotPickerFields } = await import('../lot-picker.js?v=468');
  openModal({
    title: receiveHint ? `קבלה בסריקה — ${m.name}` : `התאמת מלאי — ${m.name}`,
    bodyHTML: `
      <p class="form-hint">נוכחי: <strong>${formatQty(row.qtyOnHand, row.unit)}</strong>
        ${scannedBarcode ? ` · ברקוד <span dir="ltr">${escapeHtml(scannedBarcode)}</span>` : ''}
      </p>
      ${receiveHint ? '<p class="form-hint">הזן כמות חיובית לקבלה (או השתמש ב«הגדר כמות סופית»).</p>' : ''}
      <div class="form-group">
        <label for="inv-delta">שינוי (+/−)</label>
        <input type="number" id="inv-delta" step="any" placeholder="לדוגמה 5 או -2" dir="ltr" value="${receiveHint ? '' : ''}">
      </div>
      <div class="form-group">
        <label for="inv-set">או הגדר כמות סופית</label>
        <input type="number" id="inv-set" step="any" min="0" placeholder="אופציונלי" dir="ltr" value="">
      </div>
      <div class="form-group">
        <label for="inv-lot">מספר מנה (בקבלה בלבד — אופציונלי)</label>
        ${renderLotPickerFieldHTML({
    inputHtml: '<input type="text" id="inv-lot" placeholder="מספר על האריזה">',
  })}
      </div>
      <div class="form-group">
        <label for="inv-min">כמות מינימום (התראה)</label>
        <input type="number" id="inv-min" step="any" min="0" dir="ltr" value="${row.minQty != null ? escapeHtml(String(row.minQty)) : ''}">
      </div>
      <div class="form-group">
        <label for="inv-reason">סיבה</label>
        <input type="text" id="inv-reason" maxlength="200" placeholder="ספירה / קבלה / תיקון" value="${receiveHint ? 'קבלה בסריקת ברקוד' : ''}">
      </div>
      <p class="form-hint inv-adjust-error" style="display:none;color:var(--danger)"></p>
    `,
    footerHTML: `
      <button type="button" class="btn btn-secondary" id="inv-cancel">ביטול</button>
      <button type="button" class="btn btn-primary" id="inv-save">${receiveHint ? 'קבל למלאי' : 'שמור'}</button>
    `,
  });

  bindLotPickerFields(document.getElementById('modal-body'));
  document.getElementById('inv-cancel')?.addEventListener('click', () => closeModal());
  document.getElementById('inv-save')?.addEventListener('click', async () => {
    const errEl = document.querySelector('.inv-adjust-error');
    const deltaVal = document.getElementById('inv-delta')?.value;
    const setVal = document.getElementById('inv-set')?.value;
    const minVal = document.getElementById('inv-min')?.value;
    const reason = document.getElementById('inv-reason')?.value || '';
    const packagingBatchNumber = document.getElementById('inv-lot')?.value?.trim();
    try {
      const hasSet = setVal !== '' && setVal != null;
      const hasDelta = deltaVal !== '' && deltaVal != null;
      if (!hasSet && !hasDelta) {
        throw new Error('הזן שינוי או כמות סופית');
      }
      const unit = row.unit || m.unit || '';
      if (!hasSet && packagingBatchNumber && Number(deltaVal) > 0) {
        const { receiveInventoryLot } = await import('../inventory-db.js?v=468');
        await receiveInventoryLot({
          rawMaterialId: m.id, qty: deltaVal, unit, packagingBatchNumber, reason,
        });
      } else {
        await adjustInventoryStock({
          rawMaterialId: m.id,
          delta: hasSet ? undefined : deltaVal,
          setQty: hasSet ? setVal : null,
          minQty: minVal,
          reason,
          unit,
        });
      }
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
  const allowAdjust = canAdjustInventory(getCurrentUserRole());

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
  const collapsed = getCollapsedSupplierIds();
  const groups = groupStockRowsBySupplier(rows);
  const catOptions = [
    `<option value="">כל הקטגוריות</option>`,
    ...cats.map((c) => `<option value="${c.id}" ${String(c.id) === String(categoryId) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`),
  ].join('');

  const groupsHtml = groups.length
    ? groups.map((g) => stockSupplierGroupHtml(g, {
      allowAdjust,
      collapsed: collapsed.has(g.key),
    })).join('')
    : '<div class="card"><p class="form-hint">אין חומרי גלם להצגה. הוסף במחסן שבעמדת ספקים.</p></div>';

  return {
    html: `
      <div class="card">
        <div class="card-title">יתרות לפי ספקים</div>
        <p class="form-hint">מקובץ לפי ספק · בכל ספק: חומרי גלם ואז אריזות. אפשר למזער ספק בלחיצה על הכותרת.</p>
        <p class="form-hint" style="margin:0">מוצגים: <strong>${rows.length}</strong> · ספקים: <strong>${groups.length}</strong>${lowCount ? ` · מתחת למינימום: <strong style="color:var(--danger)">${lowCount}</strong>` : ''}</p>
        ${allowAdjust ? `
        <button type="button" class="btn btn-secondary btn-sm" id="inv-scan-receive" style="margin-top:10px;width:100%">
          📷 סרוק ברקוד לקבלה למלאי
        </button>` : ''}
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
      <div class="inventory-supplier-groups">
        ${groupsHtml}
      </div>
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
            <input type="search" id="inv-move-search" value="${escapeHtml(search)}" placeholder="חומר / סיבה / משתמש / מספר מנה">
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

async function renderGapTab(container) {
  const weekStart = container.dataset.invGapWeek || weekStartISO(todayISO());
  const showAll = container.dataset.invGapShowAll === '1';
  let result;
  try {
    result = await computeWeeklyInventoryGaps(weekStart, { onlyShortage: !showAll });
  } catch (err) {
    return {
      html: `
        <div class="card" style="border:2px solid var(--danger)">
          <div class="card-title">שגיאה בחישוב פער</div>
          <p>${escapeHtml(err.message || err)}</p>
        </div>`,
      rows: [],
      weekStart,
      waText: '',
    };
  }

  const waText = formatWhatsAppGapOrderText({ weekStart, rows: result.allRows });
  const rows = result.rows;

  return {
    weekStart,
    rows,
    waText,
    html: `
      <div class="card">
        <div class="card-title">פער מלאי מול תוכנית שבועית</div>
        <p class="form-hint">מחשב צורך מתוכנן (תוכנית ייצור בספקים → הזמנה) פחות יתרה במלאי. פער חיובי = להזמין.</p>
        <form id="inv-gap-filter" class="lots-search-form" style="margin-top:12px">
          <div class="form-group">
            <label for="inv-gap-week">תחילת שבוע</label>
            <input type="date" id="inv-gap-week" value="${escapeHtml(weekStart)}">
          </div>
          <label class="form-hint" style="display:flex;gap:8px;align-items:center;margin:8px 0">
            <input type="checkbox" id="inv-gap-show-all" ${showAll ? 'checked' : ''}>
            הצג גם חומרים שמכוסים במלאי
          </label>
          <button type="submit" class="btn btn-primary">חשב</button>
        </form>
        <p class="form-hint" style="margin:10px 0 0">
          חסרים: <strong style="color:var(--danger)">${result.shortageCount}</strong>
          · פריטים מוצגים: <strong>${rows.length}</strong>
        </p>
        <div class="accounts-actions" style="margin-top:10px">
          <button type="button" class="btn btn-secondary" id="inv-gap-copy" ${result.shortageCount ? '' : 'disabled'}>העתק הזמנת פער (WhatsApp)</button>
          <button type="button" class="btn btn-primary" id="inv-gap-add-all" ${result.shortageCount ? '' : 'disabled'}>הוסף את כל הפערים לחוסרים</button>
        </div>
      </div>
      ${rows.length ? rows.map(gapCard).join('') : `<div class="card"><p class="form-hint">${result.allRows.length ? 'אין פערים — המלאי מכסה את התוכנית.' : 'אין צרכים מתוכננים. הגדר תחזית רכש שבועית בעמדת ספקים ← הזמנה, עם מתכונים מקושרים.'}</p></div>`}
      <textarea id="inv-gap-wa-text" class="hidden" aria-hidden="true">${escapeHtml(waText)}</textarea>
    `,
  };
}

function gapCard(row) {
  const missing = row.gap > 0;
  return `
    <div class="card inventory-card" data-material-id="${row.rawMaterialId || ''}">
      <div class="accounts-card-head">
        <div>
          <div class="card-title" style="margin-bottom:4px">${escapeHtml(row.name)}</div>
          <p class="form-hint" style="margin:0">${escapeHtml(row.supplierCategoryName)}</p>
          <p class="form-hint" style="margin:4px 0 0">
            צורך: <strong>${formatQty(row.needed, row.unit)}</strong>
            · במלאי: <strong>${formatQty(row.qtyOnHand, row.unit)}</strong>
            · פער: <strong style="color:${missing ? 'var(--danger)' : 'var(--success, #059669)'}">${missing ? formatQty(row.gap, row.unit) : 'מכוסה'}</strong>
          </p>
          ${!row.hasBalance ? '<p class="form-hint" style="margin:4px 0 0">לא הוגדרה יתרה — נספר כ־0</p>' : ''}
          ${row.products?.length ? `<p class="form-hint" style="margin:4px 0 0">מוצרים: ${escapeHtml(row.products.map((p) => p.name).join(', '))}</p>` : ''}
        </div>
        <span class="accounts-status accounts-status--${missing ? 'danger' : 'ok'}">${missing ? 'להזמין' : 'מספיק'}</span>
      </div>
      ${missing && row.rawMaterialId && row.supplierId ? `
        <div class="accounts-actions">
          <button type="button" class="btn btn-secondary inventory-gap-to-shortage"
            data-material-id="${row.rawMaterialId}" data-order-qty="${row.orderQty}">
            הוסף לחוסרים (${formatQty(row.orderQty, row.unit)})
          </button>
        </div>` : ''}
      ${missing && row.rawMaterialId && !row.supplierId ? '<p class="form-hint">אין ספק משויך — שייך בספקים כדי להוסיף לחוסרים</p>' : ''}
    </div>`;
}

export async function renderInventory(container) {
  const tab = container.dataset.invTab || sessionStorage.getItem('yitzurInventoryTab') || 'stock';
  container.dataset.invTab = tab;
  sessionStorage.setItem('yitzurInventoryTab', tab);

  container.innerHTML = `<div class="card"><p class="form-hint">טוען מלאי...</p></div>`;

  let body = '';
  let stockRows = [];
  let gapRows = [];
  if (tab === 'movements') {
    const res = await renderMovementsTab(container);
    body = res.html;
  } else if (tab === 'gap') {
    const res = await renderGapTab(container);
    body = res.html;
    gapRows = res.rows || [];
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

  container.querySelectorAll('.inventory-supplier-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.inventory-supplier-group');
      if (!group) return;
      const key = group.dataset.supplierKey || '';
      group.classList.toggle('is-collapsed');
      const isCollapsed = group.classList.contains('is-collapsed');
      btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
      const set = getCollapsedSupplierIds();
      if (isCollapsed) set.add(key);
      else set.delete(key);
      saveCollapsedSupplierIds(set);
    });
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

  container.querySelector('#inv-gap-filter')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = container.querySelector('#inv-gap-week')?.value || todayISO();
    container.dataset.invGapWeek = weekStartISO(raw);
    container.dataset.invGapShowAll = container.querySelector('#inv-gap-show-all')?.checked ? '1' : '0';
    renderInventory(container);
  });

  container.querySelector('#inv-gap-copy')?.addEventListener('click', async () => {
    const text = container.querySelector('#inv-gap-wa-text')?.value || '';
    try {
      await navigator.clipboard.writeText(text);
      showToast('הועתק ללוח');
    } catch {
      showToast('לא ניתן להעתיק — העתק ידנית מהטקסט');
    }
  });

  container.querySelector('#inv-gap-add-all')?.addEventListener('click', async () => {
    const shortages = gapRows.filter((r) => r.gap > 0 && r.rawMaterialId && r.supplierId);
    if (!shortages.length) return showToast('אין פריטים להוספה');
    if (!confirm(`להוסיף ${shortages.length} פריטים לחוסרים?`)) return;
    let ok = 0;
    let skipped = 0;
    for (const row of shortages) {
      try {
        await addInventoryItemToShortages(row.rawMaterialId, row.orderQty);
        ok++;
      } catch {
        skipped++;
      }
    }
    requestAutoBackupNow();
    showToast(skipped ? `נוספו ${ok}, דולגו ${skipped} (כבר ברשימה / שגיאה)` : `נוספו ${ok} לחוסרים`);
  });

  container.querySelectorAll('.inventory-gap-to-shortage').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await addInventoryItemToShortages(Number(btn.dataset.materialId), btn.dataset.orderQty);
        showToast('נוסף לחוסרים');
        requestAutoBackupNow();
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelector('#inv-scan-receive')?.addEventListener('click', () => {
    openReceiveByBarcodeModal(() => renderInventory(container));
  });

  container.querySelectorAll('.inventory-adjust').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!canAdjustInventory(getCurrentUserRole())) {
        showToast(PERMISSION_DENIED_MESSAGE);
        return;
      }
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
