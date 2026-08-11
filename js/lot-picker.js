import { escapeHtml, formatDecimal } from './utils.js?v=458';
import { openBarcodeScanner } from './barcode-scan.js?v=458';

let uid = 0;

/**
 * עוטף input קיים (מועבר כ-HTML מוכן, לא נבנה כאן) בכפתור סריקה, ואם יש rawMaterialId —
 * גם ב"בחר ממנות פעילות" (מאוכלס אח"כ ע"י bindLotPickerFields). לא נוגע בזהות/class/data של ה-input עצמו.
 */
export function renderLotPickerFieldHTML({ inputHtml, rawMaterialId = null }) {
  const wid = `lot-picker-${++uid}`;
  return `
    <div class="lot-picker-field" data-lot-picker-id="${wid}" data-raw-material-id="${rawMaterialId ?? ''}">
      <div class="lot-picker-input-row">
        ${inputHtml}
        <button type="button" class="btn btn-secondary btn-sm btn-icon lot-picker-scan-btn" title="סרוק מספר מנה">📷</button>
      </div>
      <div class="lot-picker-active-select-slot"></div>
    </div>`;
}

function setInputValue(input, value) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** מחווט כפתורי סריקה + טוען מנות פעילות (אם יש rawMaterialId) לכל שדות lot-picker-field בתוך root */
export async function bindLotPickerFields(root) {
  const wrappers = [...root.querySelectorAll('.lot-picker-field')];
  if (!wrappers.length) return;

  let listActiveLots = null;
  const materialIds = wrappers
    .map((w) => (w.dataset.rawMaterialId ? Number(w.dataset.rawMaterialId) : null))
    .filter(Boolean);
  if (materialIds.length) {
    ({ listActiveLots } = await import('./inventory-db.js?v=458'));
  }

  for (const wrap of wrappers) {
    const input = wrap.querySelector('input');
    if (!input) continue;

    wrap.querySelector('.lot-picker-scan-btn')?.addEventListener('click', () => {
      openBarcodeScanner({ onDecode: (text) => setInputValue(input, text) });
    });

    const rawMaterialId = wrap.dataset.rawMaterialId ? Number(wrap.dataset.rawMaterialId) : null;
    const slot = wrap.querySelector('.lot-picker-active-select-slot');
    if (!rawMaterialId || !slot || !listActiveLots) continue;

    try {
      const lots = await listActiveLots({ rawMaterialId });
      if (!lots.length) continue;
      slot.innerHTML = `
        <select class="lot-picker-active-select">
          <option value="">בחר ממנות פעילות...</option>
          ${lots.map((l) => `<option value="${escapeHtml(l.packagingBatchNumber)}">${escapeHtml(l.packagingBatchNumber)} · נותרו ${formatDecimal(l.qtyOnHand)}${l.unit ? ` ${escapeHtml(l.unit)}` : ''}${l.supplierName ? ` · ${escapeHtml(l.supplierName)}` : ''}</option>`).join('')}
        </select>`;
      slot.querySelector('.lot-picker-active-select')?.addEventListener('change', (e) => {
        if (!e.target.value) return;
        setInputValue(input, e.target.value);
      });
    } catch { /* best-effort — scan/manual entry still work */ }
  }
}
