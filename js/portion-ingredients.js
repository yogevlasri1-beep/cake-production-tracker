import {
  getPortionPresetIngredientsFormData,
  savePortionPresetIngredientSettings,
} from './kitchen-db.js?v=350';
import {
  saveRunPortionIngredientBatches,
  saveRunStepPortionIngredientBatches,
  getProductionRun,
  getRunPortionLogs,
  getStepPortionBatches,
} from './db.js?v=350';
import { escapeHtml, showToast, formatDecimal } from './utils.js?v=350';
import { openModal, closeModal } from './modal.js?v=350';
import { requestAutoBackupNow } from './backup-service.js?v=350';

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

function packagingNumbersFieldHTML(row, index) {
  const nums = (row.packagingBatchNumbers || []).length
    ? row.packagingBatchNumbers
    : [row.packagingBatchNumber || ''];
  const list = nums.length ? nums : [''];
  return `
    <div class="portion-packaging-numbers" data-index="${index}">
      <span class="portion-packaging-count-label">מספרי מנה (אריזה)</span>
      <div class="portion-packaging-number-list">
        ${list.map((num, numIndex) => `
          <div class="portion-packaging-number-row">
            <input type="text" class="portion-ing-packaging" data-index="${index}" data-num="${numIndex}"
              inputmode="text" autocomplete="off" placeholder="מספר על האריזה"
              value="${num ? escapeHtml(String(num)) : ''}"
              aria-label="מספר מנה על האריזה — ${escapeHtml(row.name)}">
            <button type="button" class="btn btn-secondary btn-sm portion-packaging-num-remove"
              data-index="${index}" title="הסר מספר" aria-label="הסר מספר"${list.length <= 1 ? ' disabled' : ''}>×</button>
          </div>`).join('')}
      </div>
      <button type="button" class="btn btn-secondary btn-sm portion-packaging-num-add" data-index="${index}">
        + הוסף מספר מנה
      </button>
    </div>`;
}

/** רשימת חומרי גלם לתהליך — מספרי מנה על האריזה (מעקב משרד הבריאות) */
function buildRunBatchListHTML(rows) {
  return `
    <ul class="portion-packaging-list">
      ${rows.map((row, index) => `
      <li class="portion-packaging-item" data-ingredient-id="${row.recipeIngredientId}">
        <div class="portion-packaging-item-main portion-packaging-item-main--stack">
          <div class="portion-packaging-item-name">
            <strong>${escapeHtml(row.name)}</strong>
            <span class="form-hint portion-packaging-recipe-qty">${formatDecimal(row.quantity)} ${escapeHtml(row.unit || '')}</span>
          </div>
          ${packagingNumbersFieldHTML(row, index)}
        </div>
        ${supplierFieldHTML(row, index)}
      </li>`).join('')}
    </ul>`;
}

function bindPackagingNumberControls(modalRoot) {
  const root = modalRoot || document;
  root.querySelectorAll('.portion-packaging-num-add').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = btn.dataset.index;
      const wrap = root.querySelector(`.portion-packaging-numbers[data-index="${index}"] .portion-packaging-number-list`);
      if (!wrap) return;
      const numIndex = wrap.querySelectorAll('.portion-packaging-number-row').length;
      const row = document.createElement('div');
      row.className = 'portion-packaging-number-row';
      row.innerHTML = `
        <input type="text" class="portion-ing-packaging" data-index="${index}" data-num="${numIndex}"
          inputmode="text" autocomplete="off" placeholder="מספר על האריזה">
        <button type="button" class="btn btn-secondary btn-sm portion-packaging-num-remove"
          data-index="${index}" title="הסר מספר" aria-label="הסר מספר">×</button>`;
      wrap.appendChild(row);
      wrap.querySelectorAll('.portion-packaging-num-remove').forEach((b) => { b.disabled = false; });
      row.querySelector('input')?.focus();
      row.querySelector('.portion-packaging-num-remove')?.addEventListener('click', onRemove);
    });
  });

  function onRemove(e) {
    const btn = e.currentTarget;
    const index = btn.dataset.index;
    const wrap = root.querySelector(`.portion-packaging-numbers[data-index="${index}"] .portion-packaging-number-list`);
    const row = btn.closest('.portion-packaging-number-row');
    if (!wrap || !row) return;
    if (wrap.querySelectorAll('.portion-packaging-number-row').length <= 1) {
      row.querySelector('input').value = '';
      return;
    }
    row.remove();
    const left = wrap.querySelectorAll('.portion-packaging-num-remove');
    if (left.length === 1) left[0].disabled = true;
  }

  root.querySelectorAll('.portion-packaging-num-remove').forEach((btn) => {
    btn.addEventListener('click', onRemove);
  });
}

function readPackagingNumbersFromModal(modalRoot, index) {
  return [...modalRoot.querySelectorAll(`.portion-ing-packaging[data-index="${index}"]`)]
    .map((el) => String(el.value || '').trim())
    .filter(Boolean);
}

function groupExistingBatchNumbers(existingBatches = []) {
  const map = new Map();
  for (const b of existingBatches || []) {
    const id = Number(b.recipeIngredientId);
    if (!id) continue;
    if (!map.has(id)) map.set(id, { numbers: [], rawMaterialId: b.rawMaterialId || null });
    const entry = map.get(id);
    const num = String(b.packagingBatchNumber || '').trim();
    if (num && !entry.numbers.includes(num)) entry.numbers.push(num);
    if (b.rawMaterialId) entry.rawMaterialId = b.rawMaterialId;
  }
  return map;
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

  const modalRoot = document.querySelector('.modal-portion-ingredients') || document;
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-portion-ingredients')?.addEventListener('click', async () => {
    const payload = rows.map((row, index) => {
      const packagingEl = modalRoot.querySelector(`.portion-ing-packaging[data-index="${index}"]`);
      const supplierEl = modalRoot.querySelector(`.portion-ing-supplier[data-index="${index}"]`);
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

/** מעקב מספרי מנה לתהליך יצור (רשומת מנה בסעיף מנות או בשלב) */
export async function openRunPortionIngredientBatchesModal({
  runId,
  logId,
  stepIndex,
  batchIndex,
  portionPresetId,
  portionName = '',
  existingBatches = [],
  onSaved,
} = {}) {
  const pid = Number(portionPresetId);
  const rid = Number(runId);
  const isStep = stepIndex != null && batchIndex != null;
  const lid = Number(logId);
  if (!pid || !rid) return;
  if (!isStep && !lid) return;

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

  const existingMap = groupExistingBatchNumbers(existingBatches);
  rows = rows.map((row) => {
    const saved = existingMap.get(Number(row.recipeIngredientId));
    if (!saved) {
      const fallback = row.packagingPortionCount != null && row.packagingPortionCount !== ''
        ? [String(row.packagingPortionCount)]
        : [''];
      return {
        ...row,
        packagingBatchNumbers: fallback,
        packagingBatchNumber: fallback[0] || '',
      };
    }
    return {
      ...row,
      packagingBatchNumbers: saved.numbers.length ? saved.numbers : [''],
      packagingBatchNumber: saved.numbers[0] || '',
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
        (למעקב משרד הבריאות — לא כמות). אפשר להוסיף יותר ממספר אחד עם +.
      </p>
      ${buildRunBatchListHTML(rows)}`,
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">ביטול</button>
      <button type="button" class="btn btn-primary" id="save-run-portion-batches">שמור רשימה</button>`,
  });

  const modalRoot = document.querySelector('.modal-portion-ingredients') || document;
  bindPackagingNumberControls(modalRoot);
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-run-portion-batches')?.addEventListener('click', async () => {
    const payload = rows.map((row, index) => {
      const supplierEl = modalRoot.querySelector(`.portion-ing-supplier[data-index="${index}"]`);
      const rawMaterialId = supplierEl?.value || null;
      let supplierName = '';
      if (rawMaterialId) {
        const opt = row.supplierOptions?.find((o) => String(o.id) === String(rawMaterialId));
        supplierName = opt?.supplierName || '';
      }
      return {
        recipeIngredientId: row.recipeIngredientId,
        name: row.name,
        packagingBatchNumbers: readPackagingNumbersFromModal(modalRoot, index),
        rawMaterialId,
        supplierName,
      };
    });
    try {
      if (isStep) {
        await saveRunStepPortionIngredientBatches(rid, Number(stepIndex), Number(batchIndex), payload);
      } else {
        await saveRunPortionIngredientBatches(rid, lid, payload);
      }
      requestAutoBackupNow().catch(() => {});
      closeModal();
      showToast('רשימת מנות נשמרה ✓');
      onSaved?.();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

export function formatIngredientBatchesSummaryHTML(batches = []) {
  const rows = (batches || []).filter((b) => String(b.packagingBatchNumber || '').trim());
  if (!rows.length) return '';
  const byIng = new Map();
  for (const b of rows) {
    const key = `${b.recipeIngredientId || ''}:${b.name || 'חומר גלם'}`;
    if (!byIng.has(key)) {
      byIng.set(key, {
        name: b.name || 'חומר גלם',
        supplierName: b.supplierName || '',
        numbers: [],
      });
    }
    const entry = byIng.get(key);
    const num = String(b.packagingBatchNumber).trim();
    if (!entry.numbers.includes(num)) entry.numbers.push(num);
    if (b.supplierName) entry.supplierName = b.supplierName;
  }
  return `
    <ul class="run-portion-ing-batch-summary">
      ${[...byIng.values()].map((e) => `
        <li class="run-portion-ing-batch-summary-item">
          <span class="run-portion-ing-batch-summary-name">${escapeHtml(e.name)}</span>
          <span class="run-portion-ing-batch-summary-nums">${e.numbers.map((n) => escapeHtml(n)).join(' · ')}</span>
          ${e.supplierName ? `<span class="run-portion-ing-batch-summary-sup">${escapeHtml(e.supplierName)}</span>` : ''}
        </li>`).join('')}
    </ul>`;
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

  root.querySelectorAll('.run-step-portion-batch-list-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const presetId = Number(btn.dataset.presetId);
      const runId = Number(btn.dataset.runId);
      const stepIndex = Number(btn.dataset.step);
      const batchIndex = Number(btn.dataset.batch);
      if (!presetId || !runId || !Number.isFinite(stepIndex) || !Number.isFinite(batchIndex)) {
        showToast('מנה לא מקושרת למתכון');
        return;
      }
      let existingBatches = [];
      try {
        const run = await getProductionRun(runId);
        const step = run?.steps?.[stepIndex];
        const batch = getStepPortionBatches(step)[batchIndex];
        existingBatches = batch?.ingredientBatches || [];
      } catch {
        existingBatches = [];
      }
      openRunPortionIngredientBatchesModal({
        runId,
        stepIndex,
        batchIndex,
        portionPresetId: presetId,
        portionName: btn.dataset.portionName || '',
        existingBatches,
        onSaved,
      });
    });
  });

  root.querySelectorAll('.portion-ingredients-btn, .flow-portion-ingredients-btn').forEach((btn) => {
    if (btn.classList.contains('run-portion-batch-list-btn')) return;
    if (btn.classList.contains('run-step-portion-batch-list-btn')) return;
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
