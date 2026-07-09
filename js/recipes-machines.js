import {
  getProductionMachines, getProductionMachine, addProductionMachine, updateProductionMachine, deleteProductionMachine,
  getProductionMachineFields, addProductionMachineField, updateProductionMachineField, deleteProductionMachineField,
  getProductionMachineAssignments, addProductionMachineAssignment, updateProductionMachineAssignment, deleteProductionMachineAssignment,
  MACHINE_MEASURE_WEIGHT, MACHINE_MEASURE_LENGTH, MACHINE_UNIT_OPTIONS,
  getMachineMeasureLabel, getMachineUnitLabel, getRecipeForProduct,
} from './kitchen-db.js?v=275';
import { escapeHtml, showToast } from './utils.js?v=275';
import { openModal, closeModal } from './modal.js?v=275';

function machineUnitOptionsHTML(measureKind, selected) {
  const kind = measureKind === MACHINE_MEASURE_LENGTH ? MACHINE_MEASURE_LENGTH : MACHINE_MEASURE_WEIGHT;
  return (MACHINE_UNIT_OPTIONS[kind] || []).map((u) =>
    `<option value="${u.id}"${u.id === selected ? ' selected' : ''}>${escapeHtml(u.label)}</option>`).join('');
}

function buildProductSelectHTML(productCatalog, selectedId, { excludeIds = [] } = {}) {
  const excluded = new Set(excludeIds.map(Number));
  const parts = ['<option value="">בחר מוצר...</option>'];
  for (const group of productCatalog.groups || []) {
    for (const cat of group.categories || []) {
      const products = (cat.products || []).filter((p) => p.active !== false && !excluded.has(p.id));
      if (!products.length) continue;
      parts.push(`<optgroup label="${escapeHtml(`${group.name} › ${cat.name}`)}">`);
      for (const p of products) {
        const sel = Number(selectedId) === p.id ? ' selected' : '';
        parts.push(`<option value="${p.id}"${sel}>${escapeHtml(p.name)}</option>`);
      }
      parts.push('</optgroup>');
    }
  }
  for (const cat of productCatalog.ungrouped || []) {
    const products = (cat.products || []).filter((p) => p.active !== false && !excluded.has(p.id));
    if (!products.length) continue;
    parts.push(`<optgroup label="${escapeHtml(cat.name)}">`);
    for (const p of products) {
      const sel = Number(selectedId) === p.id ? ' selected' : '';
      parts.push(`<option value="${p.id}"${sel}>${escapeHtml(p.name)}</option>`);
    }
    parts.push('</optgroup>');
  }
  return parts.join('');
}

function renderMachineFieldRow(field) {
  return `
    <div class="machine-field-row list-item" data-field-id="${field.id}">
      <div class="list-item-info">
        <div class="list-item-name">${escapeHtml(field.name)}</div>
        <div class="list-item-meta">${escapeHtml(getMachineMeasureLabel(field.measureKind))} · ${escapeHtml(getMachineUnitLabel(field.measureKind, field.unit))}</div>
      </div>
      <div class="list-item-actions">
        <button type="button" class="btn btn-secondary btn-sm machine-edit-field" data-id="${field.id}" title="ערוך">✏️</button>
        <button type="button" class="btn btn-danger btn-sm machine-del-field" data-id="${field.id}" title="מחק">🗑</button>
      </div>
    </div>`;
}

function renderAssignmentRow(row) {
  const fieldCells = row.fields.map((f) => {
    const val = f.value != null && f.value !== '' ? f.value : '—';
    return `<td><span class="machine-assignment-val">${escapeHtml(String(val))}</span> <span class="machine-assignment-unit">${escapeHtml(f.unitLabel)}</span></td>`;
  }).join('');
  const recipeLine = row.recipeName
    ? `<span class="machine-assignment-recipe">📖 ${escapeHtml(row.recipeName)}</span>`
    : '<span class="form-hint">ללא מתכון משויך</span>';
  return `
    <tr class="machine-assignment-row" data-assignment-id="${row.id}">
      <td class="machine-assignment-product">
        <strong>${escapeHtml(row.productName)}</strong>
        <div>${recipeLine}</div>
      </td>
      ${fieldCells}
      <td class="machine-assignment-actions">
        <button type="button" class="btn btn-secondary btn-sm machine-edit-assignment" data-id="${row.id}" title="ערוך">✏️</button>
        <button type="button" class="btn btn-danger btn-sm machine-del-assignment" data-id="${row.id}" title="מחק">🗑</button>
      </td>
    </tr>`;
}

function openMachineForm(container, { machine, onSaved }) {
  openModal({
    title: machine ? 'עריכת מכונה' : 'מכונה חדשה',
    bodyHTML: `
      <div class="form-group">
        <label for="machine-name">שם מכונה</label>
        <input type="text" id="machine-name" maxlength="80" placeholder="לדוגמה: רונדו ליין" value="${escapeHtml(machine?.name || '')}">
      </div>
      <div class="form-group">
        <label for="machine-notes">הערות</label>
        <textarea id="machine-notes" rows="2" placeholder="פרטים כלליים על המכונה...">${escapeHtml(machine?.notes || '')}</textarea>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-machine-form">שמור</button>`,
  });
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-machine-form')?.addEventListener('click', async () => {
    const name = document.getElementById('machine-name')?.value;
    const notes = document.getElementById('machine-notes')?.value;
    try {
      if (machine?.id) {
        await updateProductionMachine(machine.id, { name, notes });
      } else {
        const id = await addProductionMachine({ name, notes });
        container.dataset.machineDetailId = String(id);
      }
      closeModal();
      showToast('נשמר ✓');
      onSaved?.();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

function openMachineFieldForm({ machineId, field, onSaved }) {
  const measureKind = field?.measureKind || MACHINE_MEASURE_WEIGHT;
  openModal({
    title: field ? 'עריכת פרמטר' : 'פרמטר חדש',
    bodyHTML: `
      <div class="form-group">
        <label for="machine-field-name">שם פרמטר</label>
        <input type="text" id="machine-field-name" maxlength="80" placeholder="לדוגמה: עובי בצק" value="${escapeHtml(field?.name || '')}">
      </div>
      <div class="form-group">
        <label>סוג מדידה</label>
        <div class="machine-measure-row">
          <label class="checkbox-label">
            <input type="radio" name="machine-field-measure" value="${MACHINE_MEASURE_WEIGHT}" ${measureKind !== MACHINE_MEASURE_LENGTH ? 'checked' : ''}>
            משקל
          </label>
          <label class="checkbox-label">
            <input type="radio" name="machine-field-measure" value="${MACHINE_MEASURE_LENGTH}" ${measureKind === MACHINE_MEASURE_LENGTH ? 'checked' : ''}>
            אורך
          </label>
        </div>
      </div>
      <div class="form-group">
        <label for="machine-field-unit">יחידה</label>
        <select id="machine-field-unit">${machineUnitOptionsHTML(measureKind, field?.unit)}</select>
      </div>`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-machine-field-form">שמור</button>`,
  });

  const syncUnits = () => {
    const kind = document.querySelector('input[name="machine-field-measure"]:checked')?.value || MACHINE_MEASURE_WEIGHT;
    const sel = document.getElementById('machine-field-unit');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = machineUnitOptionsHTML(kind, current);
    if (![...sel.options].some((o) => o.value === current)) sel.selectedIndex = 0;
  };
  document.querySelectorAll('input[name="machine-field-measure"]').forEach((el) => {
    el.addEventListener('change', syncUnits);
  });

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-machine-field-form')?.addEventListener('click', async () => {
    const name = document.getElementById('machine-field-name')?.value;
    const measureKind = document.querySelector('input[name="machine-field-measure"]:checked')?.value;
    const unit = document.getElementById('machine-field-unit')?.value;
    try {
      if (field?.id) {
        await updateProductionMachineField(field.id, { name, measureKind, unit });
      } else {
        await addProductionMachineField(machineId, { name, measureKind, unit });
      }
      closeModal();
      showToast('נשמר ✓');
      onSaved?.();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

function assignmentValuesFormHTML(fields, valueMap = {}) {
  if (!fields.length) return '<p class="form-hint">הוסף פרמטרים למכונה לפני שיוך מוצרים</p>';
  return fields.map((f) => `
    <div class="form-group machine-value-field" data-field-id="${f.id}">
      <label>${escapeHtml(f.name)} <span class="form-hint">(${escapeHtml(getMachineMeasureLabel(f.measureKind))} · ${escapeHtml(getMachineUnitLabel(f.measureKind, f.unit))})</span></label>
      <input type="number" class="machine-assignment-value-input" data-field-id="${f.id}" step="0.001" inputmode="decimal"
        value="${valueMap[f.id] != null ? escapeHtml(String(valueMap[f.id])) : ''}" placeholder="ערך">
    </div>`).join('');
}

function readAssignmentValuesFromForm() {
  const values = {};
  document.querySelectorAll('.machine-assignment-value-input').forEach((input) => {
    const fid = Number(input.dataset.fieldId);
    if (!fid) return;
    if (input.value !== '') values[fid] = input.value;
  });
  return values;
}

function openAssignmentForm({ machineId, fields, productCatalog, assignment, assignedProductIds = [], onSaved }) {
  const valueMap = {};
  if (assignment) {
    for (const f of assignment.fields) valueMap[f.id] = f.value;
  }
  const excludeIds = assignment ? assignedProductIds.filter((id) => id !== assignment.productId) : assignedProductIds;
  openModal({
    title: assignment ? 'עריכת שיוך מוצר' : 'שיוך מוצר למכונה',
    bodyHTML: `
      <div class="form-group">
        <label for="machine-assignment-product">מוצר</label>
        <select id="machine-assignment-product">${buildProductSelectHTML(productCatalog, assignment?.productId, { excludeIds })}</select>
      </div>
      <div id="machine-assignment-recipe-hint" class="form-hint" style="margin-bottom:10px"></div>
      ${assignmentValuesFormHTML(fields, valueMap)}`,
    footerHTML: `
      <button class="btn btn-secondary modal-cancel">ביטול</button>
      <button class="btn btn-primary" id="save-machine-assignment-form">שמור</button>`,
  });

  const updateRecipeHint = async () => {
    const pid = Number(document.getElementById('machine-assignment-product')?.value);
    const hint = document.getElementById('machine-assignment-recipe-hint');
    if (!hint) return;
    if (!pid) {
      hint.textContent = '';
      return;
    }
    const recipe = await getRecipeForProduct(pid);
    hint.innerHTML = recipe
      ? `מתכון משויך: <strong>${escapeHtml(recipe.name)}</strong> (יתווסף אוטומטית)`
      : 'אין מתכון משויך למוצר זה';
  };
  document.getElementById('machine-assignment-product')?.addEventListener('change', updateRecipeHint);
  updateRecipeHint();

  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('save-machine-assignment-form')?.addEventListener('click', async () => {
    const productId = document.getElementById('machine-assignment-product')?.value;
    const values = readAssignmentValuesFromForm();
    try {
      if (assignment?.id) {
        await updateProductionMachineAssignment(assignment.id, { productId, values });
      } else {
        await addProductionMachineAssignment(machineId, productId, values);
      }
      closeModal();
      showToast('נשמר ✓');
      onSaved?.();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
}

async function renderMachineDetail(container, machineId, productCatalog, rerender) {
  const machine = await getProductionMachine(machineId);
  if (!machine) {
    delete container.dataset.machineDetailId;
    return rerender();
  }
  const [fields, assignments] = await Promise.all([
    getProductionMachineFields(machineId),
    getProductionMachineAssignments(machineId),
  ]);

  const tableHead = fields.length
    ? `<tr><th>מוצר / מתכון</th>${fields.map((f) =>
      `<th>${escapeHtml(f.name)}<br><span class="machine-col-unit">${escapeHtml(getMachineUnitLabel(f.measureKind, f.unit))}</span></th>`).join('')}<th></th></tr>`
    : '';

  container.innerHTML = `
    <div class="card machine-detail-card">
      <div class="filter-row" style="margin-bottom:8px">
        <button type="button" class="btn btn-secondary btn-sm" id="machine-back-list">← חזרה</button>
        <div style="flex:1">
          <div class="card-title" style="margin:0">⚙️ ${escapeHtml(machine.name)}</div>
          ${machine.notes ? `<p class="form-hint" style="margin:4px 0 0">${escapeHtml(machine.notes)}</p>` : ''}
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="machine-edit-info">✏️ ערוך</button>
        <button type="button" class="btn btn-danger btn-sm" id="machine-delete">🗑</button>
      </div>
    </div>

    <div class="card machine-fields-card">
      <div class="section-header">
        <h2>פרמטרים למכונה</h2>
        <button type="button" class="btn btn-primary btn-sm" id="machine-add-field">+ פרמטר</button>
      </div>
      <p class="form-hint">הגדר שדות כמו עובי בצק, אורך מוצר, רוחב — ובחר לכל אחד משקל (ק"ג/גרם) או אורך (מ"מ/ס"מ)</p>
      ${fields.length
    ? `<div class="machine-field-list">${fields.map(renderMachineFieldRow).join('')}</div>`
    : '<p class="form-hint machine-empty">אין פרמטרים — הוסף פרמטר ראשון</p>'}
    </div>

    <div class="card machine-assignments-card">
      <div class="section-header">
        <h2>מוצרים משויכים</h2>
        <button type="button" class="btn btn-primary btn-sm" id="machine-add-assignment"${fields.length ? '' : ' disabled'}>+ מוצר</button>
      </div>
      ${assignments.length && fields.length ? `
      <div class="machine-assignment-table-wrap">
        <table class="machine-assignment-table">
          <thead>${tableHead}</thead>
          <tbody>${assignments.map(renderAssignmentRow).join('')}</tbody>
        </table>
      </div>` : `
      <p class="form-hint machine-empty">${fields.length ? 'אין מוצרים משויכים עדיין' : 'הוסף פרמטרים לפני שיוך מוצרים'}</p>`}
    </div>`;

  document.getElementById('machine-back-list')?.addEventListener('click', () => {
    delete container.dataset.machineDetailId;
    rerender();
  });
  document.getElementById('machine-edit-info')?.addEventListener('click', () => {
    openMachineForm(container, { machine, onSaved: rerender });
  });
  document.getElementById('machine-delete')?.addEventListener('click', async () => {
    if (!confirm(`למחוק את «${machine.name}» וכל הפרמטרים והשיוכים?`)) return;
    try {
      await deleteProductionMachine(machineId);
      delete container.dataset.machineDetailId;
      showToast('נמחק');
      rerender();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });
  document.getElementById('machine-add-field')?.addEventListener('click', () => {
    openMachineFieldForm({ machineId, onSaved: rerender });
  });
  container.querySelectorAll('.machine-edit-field').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const field = fields.find((f) => f.id === Number(btn.dataset.id));
      if (field) openMachineFieldForm({ machineId, field, onSaved: rerender });
    });
  });
  container.querySelectorAll('.machine-del-field').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק פרמטר? הערכים במוצרים המשויכים יימחקו.')) return;
      try {
        await deleteProductionMachineField(Number(btn.dataset.id));
        showToast('נמחק');
        rerender();
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });
  document.getElementById('machine-add-assignment')?.addEventListener('click', () => {
    openAssignmentForm({
      machineId,
      fields,
      productCatalog,
      assignedProductIds: assignments.map((a) => a.productId),
      onSaved: rerender,
    });
  });
  container.querySelectorAll('.machine-edit-assignment').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = assignments.find((a) => a.id === Number(btn.dataset.id));
      if (row) {
        openAssignmentForm({
          machineId,
          fields,
          productCatalog,
          assignment: row,
          assignedProductIds: assignments.map((a) => a.productId),
          onSaved: rerender,
        });
      }
    });
  });
  container.querySelectorAll('.machine-del-assignment').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('להסיר את המוצר מהמכונה?')) return;
      try {
        await deleteProductionMachineAssignment(Number(btn.dataset.id));
        showToast('הוסר');
        rerender();
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });
}

export async function renderRecipesMachines(container, { productCatalog }) {
  const detailId = container.dataset.machineDetailId;
  const rerender = () => renderRecipesMachines(container, { productCatalog });

  if (detailId) {
    return renderMachineDetail(container, Number(detailId), productCatalog, rerender);
  }

  const machines = await getProductionMachines();
  const fieldCounts = new Map();
  const productCounts = new Map();
  await Promise.all(machines.map(async (m) => {
    const [fields, assignments] = await Promise.all([
      getProductionMachineFields(m.id),
      getProductionMachineAssignments(m.id),
    ]);
    fieldCounts.set(m.id, fields.length);
    productCounts.set(m.id, assignments.length);
  }));

  container.innerHTML = `
    <div class="card machine-station-intro">
      <div class="card-title">מכונות יצור</div>
      <p class="form-hint" style="margin:0">הגדר מכונות (למשל רונדו ליין), פרמטרים לכל מכונה, ושייך מוצרים עם הערכים שלהם. מתכון משויך למוצר יתווסף אוטומטית.</p>
    </div>
    <div class="card machine-list-card">
      <div class="section-header">
        <h2>רשימת מכונות</h2>
        <button type="button" class="btn btn-primary btn-sm" id="machine-add">+ מכונה</button>
      </div>
      ${machines.length ? `
      <div class="machine-catalog-list">
        ${machines.map((m) => `
        <div class="machine-catalog-row list-item machine-catalog-row--clickable" data-machine-id="${m.id}" role="button" tabindex="0">
          <div class="list-item-info">
            <div class="list-item-name">⚙️ ${escapeHtml(m.name)}</div>
            <div class="list-item-meta">${fieldCounts.get(m.id) || 0} פרמטרים · ${productCounts.get(m.id) || 0} מוצרים</div>
            ${m.notes ? `<div class="list-item-meta">${escapeHtml(m.notes)}</div>` : ''}
          </div>
          <div class="list-item-actions">
            <button type="button" class="btn btn-secondary btn-sm machine-edit" data-id="${m.id}" title="ערוך">✏️</button>
            <button type="button" class="btn btn-danger btn-sm machine-del" data-id="${m.id}" title="מחק">🗑</button>
          </div>
        </div>`).join('')}
      </div>` : '<p class="form-hint machine-empty">אין מכונות — הוסף מכונה ראשונה</p>'}
    </div>`;

  document.getElementById('machine-add')?.addEventListener('click', () => {
    openMachineForm(container, { onSaved: rerender });
  });

  container.querySelectorAll('.machine-catalog-row--clickable').forEach((row) => {
    const open = () => {
      container.dataset.machineDetailId = row.dataset.machineId;
      rerender();
    };
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      open();
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  });

  container.querySelectorAll('.machine-edit').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const machine = await getProductionMachine(Number(btn.dataset.id));
      if (machine) openMachineForm(container, { machine, onSaved: rerender });
    });
  });

  container.querySelectorAll('.machine-del').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const machine = await getProductionMachine(Number(btn.dataset.id));
      if (!machine) return;
      if (!confirm(`למחוק את «${machine.name}»?`)) return;
      try {
        await deleteProductionMachine(machine.id);
        showToast('נמחק');
        rerender();
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });
}
