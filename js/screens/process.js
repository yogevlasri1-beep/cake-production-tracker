import {
  getCategories, getProcessLogsForDate, addProcessLog, deleteProcessLog,
  getActivityPresets, getActivityPresetRecords, addActivityPreset,
  updateActivityPreset, deleteActivityPreset, updateProcessLog,
} from '../db.js';
import { todayISO, formatDate, showToast, escapeHtml } from '../utils.js';
import { openModal, closeModal } from '../modal.js';

function presetScopeLabel(categoryId, catMap) {
  return !categoryId || categoryId === 0 ? 'כללי' : (catMap.get(categoryId) || '');
}

export async function renderProcess(container) {
  const date = container.dataset.selectedDate || todayISO();
  const selectedCategory = container.dataset.selectedCategory || '';
  const showManage = container.dataset.showManage === '1';

  const [categories, logs] = await Promise.all([
    getCategories(),
    getProcessLogsForDate(date),
  ]);

  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const activities = selectedCategory ? await getActivityPresets(Number(selectedCategory)) : [];
  const presetRecords = selectedCategory
    ? (await getActivityPresetRecords(Number(selectedCategory)))
        .sort((a, b) => a.name.localeCompare(b.name, 'he'))
    : [];

  const categoryOptions = categories
    .map((c) => `<option value="${c.id}" ${String(c.id) === selectedCategory ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');

  const activityOptions = activities
    .map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`)
    .join('');

  const manageSection = selectedCategory ? `
    <div class="card">
      <div class="section-header">
        <h2 style="font-size:0.95rem">סוגי הכנה — ${escapeHtml(catMap.get(Number(selectedCategory)) || '')}</h2>
        <button class="btn btn-secondary btn-sm" id="toggle-manage">${showManage ? 'סגור' : 'נהל'}</button>
      </div>
      ${showManage ? `
        <div class="filter-row" style="margin-bottom:10px">
          <input type="text" id="new-preset-name" placeholder="סוג הכנה חדש">
          <button class="btn btn-primary btn-sm" id="add-preset">+ הוסף</button>
        </div>
        ${presetRecords.length === 0
          ? '<p style="color:var(--text-muted);font-size:0.85rem">אין סוגי הכנה — הוסף למטה</p>'
          : presetRecords.map((p) => `
            <div class="list-item">
              <div class="list-item-info">
                <div class="list-item-name">${escapeHtml(p.name)}</div>
                <div class="list-item-meta">${presetScopeLabel(p.categoryId, catMap)}</div>
              </div>
              <div class="list-item-actions">
                <button class="btn btn-secondary btn-sm edit-preset" data-id="${p.id}" data-name="${escapeHtml(p.name)}">✏️</button>
                <button class="btn btn-danger btn-sm delete-preset" data-id="${p.id}" data-name="${escapeHtml(p.name)}">🗑</button>
              </div>
            </div>`).join('')}
      ` : '<p style="font-size:0.82rem;color:var(--text-muted)">ערוך, הוסף או מחק סוגי הכנה לקטגוריה זו</p>'}
    </div>` : '';

  container.innerHTML = `
    <div class="card">
      <form id="process-form">
        <div class="form-group">
          <label for="process-date">תאריך</label>
          <input type="date" id="process-date" value="${date}" required>
        </div>
        <div class="form-group">
          <label for="process-category">קטגוריה</label>
          <select id="process-category" required ${categories.length === 0 ? 'disabled' : ''}>
            <option value="">בחר קטגוריה...</option>
            ${categoryOptions}
          </select>
        </div>
        <div class="form-group">
          <label for="process-activity">סוג הכנה</label>
          <select id="process-activity" required ${!selectedCategory ? 'disabled' : ''}>
            <option value="">${selectedCategory ? 'בחר הכנה...' : 'קודם בחר קטגוריה'}</option>
            ${activityOptions}
          </select>
        </div>
        <div class="form-group">
          <label for="process-qty">כמות <span style="font-weight:400;color:var(--text-muted)">(רשות)</span></label>
          <input type="number" id="process-qty" min="1" step="1" placeholder="לדוגמה: 10">
        </div>
        <div class="form-group">
          <label for="process-notes">הערות <span style="font-weight:400;color:var(--text-muted)">(רשות)</span></label>
          <input type="text" id="process-notes" placeholder="פרטים נוספים">
        </div>
        <button type="submit" class="btn btn-primary" ${categories.length === 0 ? 'disabled' : ''}>
          שמור תיעוד
        </button>
      </form>
    </div>

    ${manageSection}

    <div class="card">
      <div class="card-title">תיעוד ל-${formatDate(date)}</div>
      ${logs.length === 0
        ? '<p style="color:var(--text-muted);font-size:0.9rem;text-align:center;padding:12px">אין תיעוד לתאריך זה</p>'
        : logs.map((log) => `
          <div class="list-item">
            <div class="list-item-info">
              <div class="list-item-name">${escapeHtml(log.activity)}${log.quantity ? ` · <strong>${log.quantity}</strong>` : ''}</div>
              <div class="list-item-meta">
                <span class="category-chip">${escapeHtml(catMap.get(log.categoryId) || '')}</span>
                ${log.notes ? ` · ${escapeHtml(log.notes)}` : ''}
              </div>
            </div>
            <div class="list-item-actions">
              <button class="btn btn-secondary btn-sm edit-log" data-id="${log.id}">✏️</button>
              <button class="btn btn-danger btn-sm delete-log" data-id="${log.id}">🗑</button>
            </div>
          </div>`).join('')}
    </div>`;

  document.getElementById('process-date').addEventListener('change', (e) => {
    container.dataset.selectedDate = e.target.value;
    renderProcess(container);
  });

  document.getElementById('process-category').addEventListener('change', (e) => {
    container.dataset.selectedCategory = e.target.value;
    container.dataset.showManage = '0';
    renderProcess(container);
  });

  document.getElementById('toggle-manage')?.addEventListener('click', () => {
    container.dataset.showManage = showManage ? '0' : '1';
    renderProcess(container);
  });

  document.getElementById('add-preset')?.addEventListener('click', async () => {
    const name = document.getElementById('new-preset-name').value.trim();
    if (!name) return showToast('הזן שם');
    await addActivityPreset(selectedCategory, name);
    showToast('נוסף ✓');
    container.dataset.showManage = '1';
    renderProcess(container);
  });

  container.querySelectorAll('.edit-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      openModal({
        title: 'עריכת סוג הכנה',
        bodyHTML: `<div class="form-group"><label>שם</label><input type="text" id="edit-preset-name" value="${btn.dataset.name}"></div>`,
        footerHTML: `<button class="btn btn-secondary modal-cancel">ביטול</button><button class="btn btn-primary" id="save-preset">שמור</button>`,
      });
      document.querySelector('.modal-cancel').addEventListener('click', closeModal);
      document.getElementById('save-preset').addEventListener('click', async () => {
        await updateActivityPreset(Number(btn.dataset.id), document.getElementById('edit-preset-name').value);
        closeModal();
        showToast('עודכן ✓');
        renderProcess(container);
      });
    });
  });

  container.querySelectorAll('.delete-preset').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm(`למחוק "${btn.dataset.name}"?`)) {
        await deleteActivityPreset(Number(btn.dataset.id));
        showToast('נמחק');
        renderProcess(container);
      }
    });
  });

  document.getElementById('process-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = document.getElementById('process-date').value;
    const categoryId = document.getElementById('process-category').value;
    const activity = document.getElementById('process-activity').value;
    const quantity = document.getElementById('process-qty').value;
    const notes = document.getElementById('process-notes').value.trim();
    if (!categoryId || !activity) return showToast('בחר קטגוריה וסוג הכנה');

    await addProcessLog({ date: d, categoryId, activity, notes, quantity });
    showToast('תועד ✓');
    container.dataset.selectedDate = d;
    container.dataset.selectedCategory = categoryId;
    document.getElementById('process-qty').value = '';
    renderProcess(container);
  });

  container.querySelectorAll('.delete-log').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('למחוק את הרישום?')) {
        await deleteProcessLog(Number(btn.dataset.id));
        showToast('נמחק');
        renderProcess(container);
      }
    });
  });

  container.querySelectorAll('.edit-log').forEach((btn) => {
    btn.addEventListener('click', () => {
      const log = logs.find((l) => l.id === Number(btn.dataset.id));
      if (log) editLog(log, container);
    });
  });
}

function editLog(log, container) {
  openModal({
    title: 'עריכת תיעוד',
    bodyHTML: `
      <div class="form-group">
        <label>הכנה</label>
        <input type="text" id="edit-activity" value="${escapeHtml(log.activity)}">
      </div>
      <div class="form-group">
        <label for="edit-qty">כמות (רשות)</label>
        <input type="number" id="edit-qty" min="1" value="${log.quantity || ''}">
      </div>
      <div class="form-group">
        <label for="edit-notes">הערות</label>
        <input type="text" id="edit-notes" value="${escapeHtml(log.notes || '')}">
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="edit-save">שמור</button>`,
  });

  document.querySelector('.modal-cancel').addEventListener('click', closeModal);
  document.getElementById('edit-save').addEventListener('click', async () => {
    await updateProcessLog(log.id, {
      activity: document.getElementById('edit-activity').value.trim(),
      quantity: document.getElementById('edit-qty').value,
      notes: document.getElementById('edit-notes').value.trim(),
    });
    closeModal();
    showToast('עודכן ✓');
    renderProcess(container);
  });
}

export function processMeta() {
  return { title: 'תיעוד יצור', subtitle: 'תהליכי הכנה — לשימושך' };
}
