import {
  getPortionPresetIngredientsFormData,
  savePortionPresetIngredientSettings,
} from './kitchen-db.js?v=283';
import { escapeHtml, showToast, formatDecimal } from './utils.js?v=283';
import { openModal, closeModal } from './modal.js?v=283';
import { requestAutoBackupNow } from './backup-service.js?v=283';

function supplierFieldHTML(row, index) {
  const { supplierOptions, rawMaterialId } = row;
  if (!supplierOptions.length) {
    return '<span class="form-hint">אין ספק</span>';
  }
  if (supplierOptions.length === 1) {
    const opt = supplierOptions[0];
    return `
      <span class="portion-ing-supplier-label">${escapeHtml(opt.supplierName)}</span>
      <input type="hidden" class="portion-ing-supplier" data-index="${index}" value="${opt.id}">`;
  }
  const options = supplierOptions.map((opt) => `
    <option value="${opt.id}" ${Number(rawMaterialId) === opt.id ? 'selected' : ''}>
      ${escapeHtml(opt.label)}
    </option>`).join('');
  return `
    <select class="portion-ing-supplier" data-index="${index}">
      <option value="">בחר ספק...</option>
      ${options}
    </select>`;
}

function buildIngredientsTableHTML(rows) {
  return `
    <div class="portion-ingredients-table-wrap">
      <table class="portion-ingredients-table">
        <thead>
          <tr>
            <th>רכיב</th>
            <th>במתכון</th>
            <th>מנות על האריזה</th>
            <th>ספק</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, index) => `
          <tr data-ingredient-id="${row.recipeIngredientId}">
            <td><strong>${escapeHtml(row.name)}</strong></td>
            <td>${formatDecimal(row.quantity)} ${escapeHtml(row.unit || '')}</td>
            <td>
              <input type="number" class="portion-ing-packaging" data-index="${index}"
                min="0.1" step="0.1" inputmode="decimal" placeholder="למשל 10"
                value="${row.packagingPortionCount !== '' && row.packagingPortionCount != null ? escapeHtml(String(row.packagingPortionCount)) : ''}"
                aria-label="מספר מנות על האריזה — ${escapeHtml(row.name)}">
            </td>
            <td>${supplierFieldHTML(row, index)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

export async function openPortionIngredientsModal({ portionPresetId, portionName = '', onSaved } = {}) {
  const pid = Number(portionPresetId);
  if (!pid) return;

  let rows;
  try {
    rows = await getPortionPresetIngredientsFormData(pid);
  } catch (err) {
    showToast(err.message || 'שגיאה');
    return;
  }
  if (!rows.length) {
    showToast('אין רכיבים במתכון');
    return;
  }

  const title = portionName
    ? `רכיבי מתכון · ${portionName}`
    : 'רכיבי מתכון';

  openModal({
    title: escapeHtml(title),
    modalClass: 'modal-portion-ingredients',
    bodyHTML: `
      <p class="form-hint" style="margin-top:0">רשום כמה מנות מופיע על אריזת כל חומר גלם, ובחר ספק כשיש יותר מאחד.</p>
      ${buildIngredientsTableHTML(rows)}`,
    footerHTML: `
      <button type="button" class="btn btn-secondary modal-cancel">ביטול</button>
      <button type="button" class="btn btn-primary" id="save-portion-ingredients">שמור</button>`,
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
      showToast('נשמר ✓');
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
      if (!id) return;
      openPortionIngredientsModal({
        portionPresetId: id,
        portionName: btn.dataset.portionName || '',
        onSaved,
      });
    });
  });
}
