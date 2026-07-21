import {
  getPortionPresetIngredientsFormData,
  savePortionPresetIngredientSettings,
} from './kitchen-db.js?v=334';
import {
  saveRunPortionIngredientBatches,
  getProductionRun,
  getRunPortionLogs,
} from './db.js?v=334';
import { escapeHtml, showToast, formatDecimal } from './utils.js?v=334';
import { openModal, closeModal } from './modal.js?v=334';
import { requestAutoBackupNow } from './backup-service.js?v=334';

function supplierFieldHTML(row, index) {
  const { supplierOptions, rawMaterialId } = row;
  if (!supplierOptions.length) {
    return '';
  }
  if (supplierOptions.length === 1) {
    const opt = supplierOptions[0];
    return `
      <p class="portion-ing-supplier-one form-hint">ספק: ${escapeHtml(opt.supplierName)}</p>
      <input type="hidden" class="portion-ing-supplier" data-index="${index}" value="${opt.id}">`;
  }
  const options = supplierOptions.map((opt) => `
    <option value="${opt.id}" ${Number(rawMaterialId) === opt.id ? 'selected' : ''}>
      ${escapeHtml(opt.label)}
    </option>`).join('');
  return `
    <label class="portion-ing-supplier-label-wrap">
      <span class="form-hint">ספק</span>
      <select class="portion-ing-supplier" data-index="${index}">
        <option value="">בחר ספק...</option>
        ${options}
      </select>
    </label>`;
}

/** רשימת חומרי גלם — שם + מספר מנה על האריזה (הגדרת מנה) */
function buildPackagingListHTML(rows) {
  return `
    <ul class="portion-packaging-list">
      ${rows.map((row, index) => `
      <li class="portion-packaging-item" data-ingredient-id="${row.recipeIngredientId}">
        <div class="portion-packaging-item-main">
          <div class="portion-packaging-item-name">
            <strong>${escapeHtml(row.name)}</strong>
            <span class="form-hint portion-packaging-recipe-qty">${formatDecimal(row.quantity)} ${escapeHtml(row.unit || '')}</span>
          </div>
          <label class="portion-packaging-count-field">
            <span class="portion-packaging-count-label">מספר מנה</span>
            <input type="number" class="portion-ing-packaging" data-index="${index}"
              min="0.1" step="0.1" inputmode="decimal" placeholder="למשל 10"
              value="${row.packagingPortionCount !== '' && row.packagingPortionCount != null ? escapeHtml(String(row.packagingPortionCount)) : ''}"
              aria-label="מספר מנה — ${escapeHtml(row.name)}">
          </label>
        </div>
        ${supplierFieldHTML(row, index)}
      </li>`).join('')}
    </ul>`;
}

/** רשימת חומרי גלם לתהליך — מספר מנה על האריזה (מעקב משרד הבריאות) */
function buildRunBatchListHTML(rows) {
  return `
    <ul class="portion-packaging-list">
      ${rows.map((row, index) => `
      <li class="portion-packaging-item" data-ingredient-id="${row.recipeIngredientId}">
        <div class="portion-packaging-item-main">
          <div class="portion-packaging-item-name">
            <strong>${escapeHtml(row.name)}</strong>
            <span class="form-hint portion-packaging-recipe-qty">${formatDecimal(row.quantity)} ${escapeHtml(row.unit || '')}</span>
          </div>
          <label class="portion-packaging-count-field">
            <span class="portion-packaging-count-label">מספר מנה (אריזה)</span>
            <input type="text" class="portion-ing-packaging" data-index="${index}"
              inputmode="text" autocomplete="off" placeholder="מספר על האריזה"
              value="${row.packagingBatchNumber ? escapeHtml(String(row.packagingBatchNumber)) : ''}"
              aria-label="מספר מנה על האריזה — ${escapeHtml(row.name)}">
          </label>
        </div>
        ${supplierFieldHTML(row, index)}
      </li>`).join('')}
    </ul>`;
}

export async function openPortionIngredientsModal({ portionPresetId, portionName = '', onSaved } = {}) {
  const pid = Number(portionPresetId);
  if (!pid) return;

  let rows;
  let presetName = portionName;
  try {
    const data = await getPortionPresetIngredientsFormData(pid);
    rows = data.rows;
    if (!presetName) presetName = data.presetName || '';
  } catch (err) {
    showToast(err.message || 'שגיאה');
    return;
  }
  if (!rows.length) {
    showToast('אין חומרי גלם במתכון של המנה');
    return;
  }

  const title = presetName
    ? `רשימת חומרי גלם · ${presetName}`
    : 'רשימת חומרי גלם';

  openModal({
    title: escapeHtml(title),
    modalClass: 'modal-portion-ingredients',
    bodyHTML: `
      <p class="form-hint" style="margin-top:0">לכל חומר גלם — רשום את <strong>מספר המנה</strong> שכתוב על האריזה.</p>
      ${buildPackagingListHTML(rows)}`,
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">ביטול</button>
      <button type="button" class="btn btn-primary" id="save-portion-ingredients">שמור רשימה</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-portion-ingredients')?.addEventListener('click', async () => {
    const payload = rows.map((row, index) => {
      const packagingEl = document.querySelector(`.portion-ing-packaging[data-index="${index}"]`);
      const supplierEl = document.querySelector(`.portion-ing-supplier[data-index="${index}"]`);
      return {
        recipeIngredientId: row.recipeIngredientId,
        packagingPortionCount: packagingEl?.value ?? '',
        rawMaterialId: supplierEl?.value || null,
      };
    });
    try {
      await savePortionPresetIngredientSettings(pid, payload);
      requestAutoBackupNow().catch(() => {});
      closeModal();
      showToast('רשימה נשמרה ✓');
      onSaved?.();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

/** מעקב מספרי מנה לתהליך יצור ספציפי (לא הגדרת מנה כללית) */
export async function openRunPortionIngredientBatchesModal({
  runId,
  logId,
  portionPresetId,
  portionName = '',
  existingBatches = [],
  onSaved,
} = {}) {
  const pid = Number(portionPresetId);
  const rid = Number(runId);
  const lid = Number(logId);
  if (!pid || !rid || !lid) return;

  let rows;
  let presetName = portionName;
  try {
    const data = await getPortionPresetIngredientsFormData(pid);
    rows = data.rows;
    if (!presetName) presetName = data.presetName || '';
  } catch (err) {
    showToast(err.message || 'שגיאה');
    return;
  }
  if (!rows.length) {
    showToast('אין חומרי גלם במתכון של המנה');
    return;
  }

  const existingMap = new Map(
    (existingBatches || []).map((b) => [Number(b.recipeIngredientId), b]),
  );
  rows = rows.map((row) => {
    const saved = existingMap.get(Number(row.recipeIngredientId));
    if (!saved) {
      return {
        ...row,
        packagingBatchNumber: row.packagingPortionCount != null && row.packagingPortionCount !== ''
          ? String(row.packagingPortionCount)
          : '',
      };
    }
    return {
      ...row,
      packagingBatchNumber: saved.packagingBatchNumber || '',
      rawMaterialId: saved.rawMaterialId || row.rawMaterialId,
    };
  });

  const title = presetName
    ? `מעקב מנות חומרי גלם · ${presetName}`
    : 'מעקב מנות חומרי גלם';

  openModal({
    title: escapeHtml(title),
    modalClass: 'modal-portion-ingredients',
    bodyHTML: `
      <p class="form-hint" style="margin-top:0">
        לכל חומר גלם — רשום את <strong>מספר המנה</strong> שכתוב על האריזה
        (למעקב משרד הבריאות — לא כמות).
      </p>
      ${buildRunBatchListHTML(rows)}`,
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">ביטול</button>
      <button type="button" class="btn btn-primary" id="save-run-portion-batches">שמור רשימה</button>`,
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-run-portion-batches')?.addEventListener('click', async () => {
    const payload = rows.map((row, index) => {
      const packagingEl = document.querySelector(`.portion-ing-packaging[data-index="${index}"]`);
      const supplierEl = document.querySelector(`.portion-ing-supplier[data-index="${index}"]`);
      const rawMaterialId = supplierEl?.value || null;
      let supplierName = '';
      if (rawMaterialId) {
        const opt = row.supplierOptions?.find((o) => String(o.id) === String(rawMaterialId));
        supplierName = opt?.supplierName || '';
      }
      return {
        recipeIngredientId: row.recipeIngredientId,
        name: row.name,
        packagingBatchNumber: packagingEl?.value ?? '',
        rawMaterialId,
        supplierName,
      };
    });
    try {
      await saveRunPortionIngredientBatches(rid, lid, payload);
      requestAutoBackupNow().catch(() => {});
      closeModal();
      showToast('רשימת מנות נשמרה ✓');
      onSaved?.();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

export function bindPortionIngredientsButtons(root, { onSaved } = {}) {
  if (!root) return;
  root.querySelectorAll('.run-portion-batch-list-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const presetId = Number(btn.dataset.presetId);
      const logId = Number(btn.dataset.logId);
      const runId = Number(btn.dataset.runId);
      if (!presetId || !logId || !runId) {
        showToast('מנה לא מקושרת למתכון');
        return;
      }
      let existingBatches = [];
      try {
        const run = await getProductionRun(runId);
        const log = getRunPortionLogs(run).find((l) => Number(l.id) === logId);
        existingBatches = log?.ingredientBatches || [];
      } catch {
        existingBatches = [];
      }
      openRunPortionIngredientBatchesModal({
        runId,
        logId,
        portionPresetId: presetId,
        portionName: btn.dataset.portionName || '',
        existingBatches,
        onSaved,
      });
    });
  });
  root.querySelectorAll('.portion-ingredients-btn, .flow-portion-ingredients-btn').forEach((btn) => {
    if (btn.classList.contains('run-portion-batch-list-btn')) return;
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.presetId || btn.dataset.id);
      if (!id) {
        showToast('בחר קודם מנה ממתכון');
        return;
      }
      openPortionIngredientsModal({
        portionPresetId: id,
        portionName: btn.dataset.portionName || '',
        onSaved,
      });
    });
  });
}
