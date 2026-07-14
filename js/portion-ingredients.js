import {
  getPortionPresetIngredientsFormData,
  savePortionPresetIngredientSettings,
} from './kitchen-db.js?v=300';
import { escapeHtml, showToast, formatDecimal } from './utils.js?v=300';
import { openModal, closeModal } from './modal.js?v=300';
import { requestAutoBackupNow } from './backup-service.js?v=300';

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

/** רשימת חומרי גלם — שם + מספר מנה על האריזה */
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

export function bindPortionIngredientsButtons(root, { onSaved } = {}) {
  if (!root) return;
  root.querySelectorAll('.portion-ingredients-btn, .flow-portion-ingredients-btn').forEach((btn) => {
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
