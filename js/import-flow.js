import { parseImportFile, previewText } from './import.js?v=296';
import { importProductionRows } from './db.js?v=296';
import { showToast, escapeHtml } from './utils.js?v=296';
import { openModal, closeModal } from './modal.js?v=296';

export async function openProductionImportModal(file, { onComplete }) {
  const parsed = await parseImportFile(file);
  const { sample, total, categories, products } = previewText(parsed);

  if (total === 0) {
    throw new Error('לא נמצאו רישומי ייצור בקובץ.\n\nצריך עמודות: כמות · מוצר · תאריך');
  }

  return new Promise((resolve, reject) => {
    openModal({
      title: 'אישור ייבוא ייצור',
      bodyHTML: `
        <p style="line-height:1.6;margin-bottom:10px">
          זוהו <strong>${total}</strong> רישומי ייצור
          · <strong>${categories.length}</strong> קטגוריות
          · <strong>${products.length}</strong> מוצרים
        </p>
        <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:8px">
          פורמט: ${escapeHtml(parsed.label || '—')}
        </p>
        <p style="font-size:0.82rem;color:var(--primary-dark);margin-bottom:10px">
          מוצרים שלא קיימים ייווצרו · רישום קיים לאותו יום+מוצר — הכמויות יתווספו
        </p>
        <div style="background:var(--bg);border-radius:10px;padding:12px;font-size:0.82rem;white-space:pre-line">${escapeHtml(sample)}</div>`,
      footerHTML: `
        <button type="button" class="btn btn-secondary modal-cancel">ביטול</button>
        <button type="button" class="btn btn-primary" id="confirm-production-import">ייבא ${total} רישומים</button>`,
    });

    document.querySelector('.modal-cancel')?.addEventListener('click', () => {
      closeModal();
      resolve(null);
    });

    const btn = document.getElementById('confirm-production-import');
    btn?.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'מייבא...';
      try {
        const prodRows = parsed.rows.filter((r) => r.date && r.quantity > 0 && r.product);
        const result = await importProductionRows(prodRows);
        closeModal();
        const parts = [`${result.imported} רישומים`];
        if (result.merged) parts.push(`${result.merged} עודכנו`);
        if (result.newProducts) parts.push(`${result.newProducts} מוצרים חדשים`);
        if (result.newCategories) parts.push(`${result.newCategories} קטגוריות חדשות`);
        if (result.skipped) parts.push(`${result.skipped} דולגו`);
        showToast(`יובא בהצלחה: ${parts.join(' · ')} ✓`);
        await onComplete?.(result);
        resolve(result);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = `ייבא ${total} רישומים`;
        reject(err);
      }
    });
  });
}

export function openImportErrorModal(message) {
  openModal({
    title: 'שגיאה בייבוא',
    bodyHTML: `<p style="white-space:pre-line;font-size:0.9rem;line-height:1.6">${escapeHtml(message || 'שגיאה בייבוא')}</p>`,
    footerHTML: `<button type="button" class="btn btn-primary modal-cancel">הבנתי</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
}

export async function handleProductionImportFile(file, options = {}) {
  try {
    await openProductionImportModal(file, options);
  } catch (err) {
    openImportErrorModal(err.message || 'שגיאה בייבוא');
    throw err;
  }
}
