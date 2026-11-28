import { getAllFlowsOverview, getProductionRun } from '../db.js?v=558';
import { getRecipes } from '../kitchen-db.js?v=558';
import { escapeHtml, formatDate, formatDecimal, formatDuration, formatMoney, runDurationMs, showToast, todayISO } from '../utils.js?v=558';
import {
  addProcessWaste,
  assignProcessUse,
  createProcessFlow,
  deleteProcessFlow,
  flowRollingAverage,
  listProcessFlows,
  listProcessRuns,
  mixProcessRuns,
  openProcessRunsForFlow,
  processRemainingKg,
  removeProcessUse,
  removeProcessUseFromProduct,
  saveProcessWeights,
  startProcessRun,
  updateProcessFlow,
} from '../process-materials.js?v=558';
import { expiryStatus, isProcessFlow, isProcessRun, kgFromOutputPercent, processFlowConflict, processFlowConflictMessage } from '../process-materials-math.js?v=558';

const MODE_KEY = 'yitzur-flow-kind-tab';

export function getMaterialMode() {
  try {
    return sessionStorage.getItem(MODE_KEY) === 'materials' ? 'materials' : 'products';
  } catch {
    return 'products';
  }
}

export function setMaterialMode(mode) {
  sessionStorage.setItem(MODE_KEY, mode === 'materials' ? 'materials' : 'products');
}

export function materialModeTabsHTML(mode = getMaterialMode()) {
  return `
    <div class="flow-scope-tabs process-kind-tabs" role="tablist" aria-label="סוג תזרים">
      <button type="button" class="flow-scope-tab process-kind-tab${mode !== 'materials' ? ' active' : ''}" data-material-mode="products">מוצרים</button>
      <button type="button" class="flow-scope-tab process-kind-tab${mode === 'materials' ? ' active' : ''}" data-material-mode="materials">חומרים בתהליך</button>
    </div>`;
}

export function bindMaterialModeTabs(container, rerender) {
  container.querySelectorAll('.process-kind-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.materialMode;
      if (!next || next === getMaterialMode()) return;
      setMaterialMode(next);
      rerender();
    });
  });
}

function expiryLabel(run, today) {
  if (!run?.expiresAt) return 'בלי תוקף';
  const status = expiryStatus(run.expiresAt, today);
  const date = formatDate(run.expiresAt);
  if (status === 'expired') return `פג תוקף ${date}`;
  if (status === 'today') return `תוקף היום ${date}`;
  if (status === 'tomorrow') return `תוקף מחר ${date}`;
  return `בתוקף עד ${date}`;
}

function moneyLabel(value) {
  return value != null && Number(value) > 0 ? formatMoney(value) : '—';
}

export async function renderMaterialsWorkspaceHTML() {
  const [flows, runs, overview, recipes] = await Promise.all([
    listProcessFlows(),
    listProcessRuns(),
    getAllFlowsOverview(),
    getRecipes(),
  ]);
  const today = todayISO();
  const productFlows = overview.filter((flow) => !isProcessFlow(flow));
  const averages = new Map();
  for (const flow of flows) {
    averages.set(flow.id, await flowRollingAverage(flow.id));
  }
  const recent = runs.slice(0, 40);

  return `
    <div class="section-header">
      <h2 style="font-size:1rem">חומרי גלם בתהליך</h2>
    </div>
    ${materialModeTabsHTML('materials')}
    <p class="form-hint">המנות בתזרים המוצר נשארות כמו שהיו. כאן נשמרים המשקל, התוקף והעלות. בתזרים המוצר מופיע רק עותק של האצווה והכמות.</p>

    <${flows.length ? 'details' : 'div'} class="card">
      <${flows.length ? 'summary' : 'div'} class="card-title">תזרים חדש</${flows.length ? 'summary' : 'div'}>
      <div class="form-group">
        <label for="pm-new-recipe">מתכון</label>
        <select id="pm-new-recipe">
          <option value="">בלי מתכון — אפשר לחבר אחר כך</option>
          ${recipes.map((recipe) => `<option value="${recipe.id}">${escapeHtml(recipe.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label for="pm-new-name">שם החומר</label>
        <input type="text" id="pm-new-name" placeholder="מתמלא אוטומטית מבחירת המתכון">
        <p class="form-hint" id="pm-new-name-hint">בחרו מתכון והשם יתמלא. אפשר לשנות אותו לפני השמירה.</p>
      </div>
      <div class="form-group">
        <label for="pm-new-days">ימי תוקף (רשות)</label>
        <input type="number" id="pm-new-days" min="1" step="1" inputmode="numeric" placeholder="אפשר להשאיר ריק">
        <p class="form-hint">לא חובה. אפשר לקבוע או לשנות אחר כך בעריכת התזרים.</p>
      </div>
      <div class="form-group">
        <label for="pm-new-yield">תפוקה רגילה אחרי עיבוד (%)</label>
        <input type="number" id="pm-new-yield" min="1" max="100" step="0.1" inputmode="decimal" placeholder="למשל 50">
        <p class="form-hint">סטייה של יותר מ־20% מהמספר הזה תבקש אישור. בתוך הטווח נשמר בשקט.</p>
      </div>
      <button type="button" class="btn btn-primary" id="pm-create" style="width:100%">צור תזרים</button>
    </${flows.length ? 'details' : 'div'}>

    ${flows.length ? flows.map((flow) => {
      const avg = averages.get(flow.id);
      const open = recent.filter((run) => Number(run.flowId) === Number(flow.id) && (processRemainingKg(run) == null || processRemainingKg(run) > 0));
      return `
        <div class="card" data-pm-flow="${flow.id}">
          <div class="card-title">${escapeHtml(flow.name)}</div>
          <p class="form-hint" style="margin-top:0">
            ${flow.shelfLifeDays ? `${flow.shelfLifeDays} ימי תוקף` : 'בלי תוקף מוגדר'}
            ${flow.expectedYieldPct ? ` · תפוקה רגילה ${formatDecimal(flow.expectedYieldPct)}%` : ''}
            ${avg != null ? ` · ממוצע 8 אצוות ${formatMoney(avg)} לק״ג` : ''}
          </p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
            <button type="button" class="btn btn-primary btn-sm pm-start" data-flow-id="${flow.id}">התחל אצווה</button>
            <button type="button" class="btn btn-secondary btn-sm pm-opening" data-flow-id="${flow.id}">אצווה שכבר במקרר</button>
            <div class="pm-opening-panel hidden" id="pm-opening-${flow.id}">
              <div class="form-group">
                <label>כמה ק״ג יש עכשיו במקרר</label>
                <input type="number" class="pm-opening-kg" min="0.001" step="0.001" inputmode="decimal" placeholder="למשל 12.5">
              </div>
              <div class="form-group">
                <label>עלות כוללת, אם ידועה</label>
                <input type="number" class="pm-opening-cost" min="0" step="0.01" inputmode="decimal" placeholder="אפשר להשאיר ריק">
              </div>
              <button type="button" class="btn btn-primary btn-sm pm-opening-save" data-flow-id="${flow.id}">שמור אצווה מהמקרר</button>
              <p class="form-hint">נרשם מה שיש במקרר, בלי ניפוק נוסף מהמלאי.</p>
            </div>
            <button type="button" class="btn btn-secondary btn-sm pm-edit" data-flow-id="${flow.id}">עריכה</button>
          </div>
          ${open.length ? `<p class="form-hint">פתוח: ${open.map((run) => `${escapeHtml(run.processBatchCode || run.batchNumber)} · ${processRemainingKg(run) == null ? 'בלי משקל יציאה' : `${formatDecimal(processRemainingKg(run))} ק״ג`}`).join(' · ')}</p>` : ''}
          <div class="pm-edit-panel hidden" id="pm-edit-${flow.id}">
            <div class="form-group">
              <label>שם</label>
              <input type="text" class="pm-edit-name" value="${escapeHtml(flow.name)}">
            </div>
            <div class="form-group">
              <label>מתכון</label>
              <select class="pm-edit-recipe">
                <option value="">בלי מתכון</option>
                ${recipes.map((recipe) => `<option value="${recipe.id}"${Number(flow.recipeId) === Number(recipe.id) ? ' selected' : ''}>${escapeHtml(recipe.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>ימי תוקף (רשות)</label>
              <input type="number" class="pm-edit-days" min="1" step="1" value="${flow.shelfLifeDays || ''}" placeholder="אפשר להשאיר ריק">
              <p class="form-hint">אצוות שכבר נפתחו שומרות את התוקף שנרשם להן. שינוי כאן חל על אצווה חדשה.</p>
            </div>
            <div class="form-group">
              <label>תפוקה רגילה (%)</label>
              <input type="number" class="pm-edit-yield" min="1" max="100" step="0.1" value="${flow.expectedYieldPct || ''}">
            </div>
            <div class="form-group">
              <label>משויך לתזרימי מוצר</label>
              <div class="pm-link-list">
                ${productFlows.map((productFlow) => `
                  <label class="checkbox-label">
                    <input type="checkbox" class="pm-link-flow" value="${productFlow.id}"${(flow.linkedProductFlowIds || []).map(Number).includes(Number(productFlow.id)) ? ' checked' : ''}>
                    <span>${escapeHtml(productFlow.name)}${productFlow.targetLabel ? ` · ${escapeHtml(productFlow.targetLabel)}` : ''}</span>
                  </label>`).join('') || '<p class="form-hint">אין תזרימי מוצר</p>'}
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button type="button" class="btn btn-primary btn-sm pm-save" data-flow-id="${flow.id}">שמור</button>
              <button type="button" class="btn btn-danger btn-sm pm-delete" data-flow-id="${flow.id}">מחק תזרים</button>
            </div>
          </div>
        </div>`;
    }).join('') : '<div class="card"><p class="form-hint">עדיין אין תזרים. צור אחד למעלה, למשל מילוי תפוחים.</p></div>'}

    <div class="card">
      <div class="card-title">מעקב אצוות</div>
      ${recent.length ? `
        <div class="run-portions-summary-table-wrap">
          <table class="run-portions-summary-table">
            <thead>
              <tr>
                <th>אצווה</th><th>חומר</th><th>תאריך</th><th>תוקף</th><th>יצא</th><th>נשאר</th><th>₪/ק״ג</th><th>זמן</th>
              </tr>
            </thead>
            <tbody>
              ${recent.map((run) => {
                const left = processRemainingKg(run);
                const dur = runDurationMs(run);
                return `
                  <tr class="pm-report-row" data-run-id="${run.id}" style="cursor:pointer">
                    <td>${escapeHtml(run.processBatchCode || run.batchNumber || '')}</td>
                    <td>${escapeHtml(run.flowName || '')}</td>
                    <td>${run.date ? formatDate(run.date) : '—'}</td>
                    <td>${escapeHtml(expiryLabel(run, today))}</td>
                    <td>${run.outputKg != null ? formatDecimal(run.outputKg) : '—'}</td>
                    <td>${left != null ? formatDecimal(left) : '—'}</td>
                    <td>${moneyLabel(run.costPerKg)}</td>
                    <td>${dur != null ? escapeHtml(formatDuration(dur)) : '—'}</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <p class="form-hint">לחיצה על שורה פותחת את האצווה. מספר המנה של היצרן והשיוך למוצרים נמצאים בתוכה.</p>` : '<p class="form-hint">עדיין אין אצוות.</p>'}
    </div>`;
}

export function bindMaterialsWorkspace(container, rerender) {
  bindMaterialModeTabs(container, rerender);

  const recipeSelect = document.getElementById('pm-new-recipe');
  const nameInput = document.getElementById('pm-new-name');
  const nameHint = document.getElementById('pm-new-name-hint');

  const refreshNameHint = async () => {
    if (!nameHint) return;
    const flows = await listProcessFlows();
    const kind = processFlowConflict(flows, {
      name: nameInput?.value,
      recipeId: recipeSelect?.value,
    });
    const message = processFlowConflictMessage(kind);
    nameHint.textContent = message || (nameInput?.value?.trim()
      ? 'אפשר לשנות את השם לפני השמירה.'
      : 'בחרו מתכון והשם יתמלא. אפשר לשנות אותו לפני השמירה.');
  };

  recipeSelect?.addEventListener('change', () => {
    const picked = recipeSelect.selectedOptions?.[0];
    if (picked?.value && nameInput) {
      nameInput.value = picked.textContent.trim();
      nameInput.dataset.autoName = nameInput.value;
    }
    refreshNameHint();
  });
  nameInput?.addEventListener('input', () => {
    if (nameInput.dataset.autoName && nameInput.value.trim() !== nameInput.dataset.autoName) {
      delete nameInput.dataset.autoName;
    }
    refreshNameHint();
  });

  document.getElementById('pm-create')?.addEventListener('click', async () => {
    try {
      const picked = recipeSelect?.selectedOptions?.[0];
      const typedName = nameInput?.value?.trim();
      const id = await createProcessFlow({
        name: typedName || (picked?.value ? picked.textContent.trim() : ''),
        recipeId: recipeSelect?.value,
        shelfLifeDays: document.getElementById('pm-new-days')?.value,
        expectedYieldPct: document.getElementById('pm-new-yield')?.value,
      });
      showToast('התזרים נוצר');
      container.dataset.view = 'list';
      rerender();
      return id;
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
    return null;
  });

  container.querySelectorAll('.pm-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById(`pm-edit-${btn.dataset.flowId}`)?.classList.toggle('hidden');
    });
  });

  container.querySelectorAll('.pm-edit-recipe').forEach((select) => {
    select.addEventListener('change', () => {
      const card = select.closest('[data-pm-flow]');
      const nameField = card?.querySelector('.pm-edit-name');
      const picked = select.selectedOptions?.[0];
      if (!picked?.value || !nameField) return;
      nameField.value = picked.textContent.trim();
    });
  });

  container.querySelectorAll('.pm-save').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-pm-flow]');
      try {
        await updateProcessFlow(btn.dataset.flowId, {
          name: card.querySelector('.pm-edit-name')?.value,
          recipeId: card.querySelector('.pm-edit-recipe')?.value,
          shelfLifeDays: card.querySelector('.pm-edit-days')?.value,
          expectedYieldPct: card.querySelector('.pm-edit-yield')?.value,
          linkedProductFlowIds: [...card.querySelectorAll('.pm-link-flow:checked')].map((input) => input.value),
        });
        showToast('נשמר');
        rerender();
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.pm-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק את תזרים החומר? אצוות שכבר נוצרו נשארות במעקב.')) return;
      try {
        await deleteProcessFlow(btn.dataset.flowId);
        showToast('התזרים נמחק');
        rerender();
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.pm-start').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const runId = await startProcessRun({ flowId: btn.dataset.flowId });
        container.dataset.view = 'run';
        container.dataset.runId = String(runId);
        rerender();
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.pm-opening').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById(`pm-opening-${btn.dataset.flowId}`)?.classList.toggle('hidden');
    });
  });

  container.querySelectorAll('.pm-opening-save').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const panel = document.getElementById(`pm-opening-${btn.dataset.flowId}`);
      btn.disabled = true;
      try {
        const runId = await startProcessRun({
          flowId: btn.dataset.flowId,
          opening: true,
          outputKg: panel?.querySelector('.pm-opening-kg')?.value,
          inputCost: panel?.querySelector('.pm-opening-cost')?.value,
        });
        container.dataset.view = 'run';
        container.dataset.runId = String(runId);
        rerender();
      } catch (err) {
        btn.disabled = false;
        showToast(err.message || 'שגיאה');
      }
    });
  });

  container.querySelectorAll('.pm-report-row').forEach((row) => {
    row.addEventListener('click', () => {
      container.dataset.view = 'run';
      container.dataset.runId = row.dataset.runId;
      rerender();
    });
  });
}

function allocationLinesHTML(rows, { removable = false, source = false } = {}) {
  if (!rows?.length) return '<p class="form-hint" style="margin:0">עדיין אין שיוך למוצר</p>';
  return `
    <ul class="flow-portion-batch-list">
      ${rows.map((row) => `
        <li class="flow-portion-batch-item">
          <span class="flow-portion-batch-name">${escapeHtml(source ? (row.productFlowName || 'מוצר') : (row.flowName || 'חומר'))}</span>
          <span class="flow-portion-batch-weight">${escapeHtml(source ? (row.productBatchNumber || '') : (row.sourceCode || ''))}</span>
          <span class="flow-portion-batch-extra">${row.pct != null ? `${formatDecimal(row.pct)}%` : ''} · ${formatDecimal(row.kg)} ק״ג</span>
          ${removable ? `<button type="button" class="btn btn-danger btn-sm pm-remove-use" data-alloc-id="${escapeHtml(row.id)}">הסר</button>` : ''}
        </li>`).join('')}
    </ul>`;
}

export async function renderProcessSlotHTML(run) {
  if (isProcessRun(run)) return renderProcessRunCardHTML(run);
  return renderProductUseCardHTML(run);
}

async function renderProcessRunCardHTML(run) {
  const fresh = await getProductionRun(run.id, { normalize: false }) || run;
  const today = todayISO();
  const left = processRemainingKg(fresh);
  const avg = fresh.flowId ? await flowRollingAverage(fresh.flowId) : null;
  const siblings = fresh.flowId
    ? (await openProcessRunsForFlow(fresh.flowId)).filter((item) => Number(item.id) !== Number(fresh.id) && item.remainingKg > 0)
    : [];
  const dur = runDurationMs(fresh);
  return `
    <div class="card pm-run-card">
      <div class="card-title">כרטיס אצווה ${escapeHtml(fresh.processBatchCode || fresh.batchNumber || '')}</div>
      <p class="form-hint" style="margin-top:0">${escapeHtml(fresh.flowName || '')} · ${escapeHtml(expiryLabel(fresh, today))}${dur != null ? ` · זמן ${escapeHtml(formatDuration(dur))}` : ''}</p>
      ${fresh.mixedFrom?.length ? `<p class="form-hint">עורבב מ־${fresh.mixedFrom.map((code) => escapeHtml(code)).join(' + ')}</p>` : ''}
      <div class="form-group">
        <label for="pm-input-kg">משקל שנכנס לבישול (ק״ג)</label>
        <input type="number" id="pm-input-kg" min="0.001" step="0.001" inputmode="decimal" value="${fresh.inputKg ?? ''}">
      </div>
      <div class="form-group">
        <label for="pm-output-kg">משקל אחרי עיבוד (ק״ג)</label>
        <input type="number" id="pm-output-kg" min="0.001" step="0.001" inputmode="decimal" value="${fresh.outputKg ?? ''}">
        <p class="form-hint">זה מה שאפשר לשייך למוצרים. בלי המספר הזה האצווה לא נפתחת לשימוש.</p>
      </div>
      <div class="form-group">
        <label for="pm-expires">תוקף</label>
        <input type="date" id="pm-expires" value="${fresh.expiresAt || ''}">
      </div>
      <div class="form-group">
        <label for="pm-supplier-lots">מספרי מנה של היצרן</label>
        <textarea id="pm-supplier-lots" rows="2" placeholder="מספר מהאריזה של התפוחים, שורה לכל מנה">${escapeHtml(fresh.supplierLots || '')}</textarea>
      </div>
      <button type="button" class="btn btn-primary btn-sm" id="pm-save-weights" style="width:100%">שמור משקלים</button>
      <p class="form-hint">
        תפוקה ${fresh.yieldPct != null ? `${formatDecimal(fresh.yieldPct)}%` : '—'}
        · עלות ${moneyLabel(fresh.inputCost)}
        · ${fresh.costPerKg != null ? `${formatMoney(fresh.costPerKg)} לק״ג` : '₪ לק״ג אחרי שמירת משקל יציאה'}
        ${avg != null ? ` · ממוצע ${formatMoney(avg)}` : ''}
        ${left != null ? ` · נשאר ${formatDecimal(left)} ק״ג` : ''}
      </p>
      ${fresh.yieldOutside ? '<p class="form-hint" style="color:var(--warning)">האצווה סומנה: התפוקה רחוקה מהרגיל</p>' : ''}
      <div class="run-portions-subsection-title">לאן הלך</div>
      <p class="form-hint">הכמויות כאן הן המקור. בתזרים המוצר מוצג עותק של אותה שורה.</p>
      ${allocationLinesHTML(fresh.processAllocations, { removable: true, source: true })}
      <div class="form-group" style="margin-top:8px">
        <label for="pm-waste-kg">נזרק / נשפך (ק״ג)</label>
        <input type="number" id="pm-waste-kg" min="0.001" step="0.001" inputmode="decimal">
      </div>
      <div class="form-group">
        <label for="pm-waste-reason">סיבה</label>
        <input type="text" id="pm-waste-reason" placeholder="נשפך, פג תוקף">
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="pm-add-waste">רשום פחת</button>
      ${(fresh.processWaste || []).length ? `<p class="form-hint">פחת: ${(fresh.processWaste || []).map((row) => `${formatDecimal(row.kg)} ק״ג${row.reason ? ` ${escapeHtml(row.reason)}` : ''}`).join(' · ')}</p>` : ''}
      ${siblings.length ? `
        <div class="form-group" style="margin-top:8px">
          <label for="pm-mix-with">ערבוב עם אצווה פתוחה של אותו חומר</label>
          <select id="pm-mix-with">
            <option value="">בחר אצווה</option>
            ${siblings.map((item) => `<option value="${item.id}">${escapeHtml(item.processBatchCode || item.batchNumber)} · ${formatDecimal(item.remainingKg)} ק״ג · ${escapeHtml(expiryLabel(item, today))}</option>`).join('')}
          </select>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="pm-mix">ערבב לאצווה חדשה</button>
        <p class="form-hint">התוקף של האצווה החדשה הוא המוקדם מבין השתיים. העלות היא ממוצע משוקלל, ורק אם לשתי האצוות יש מחיר.</p>` : ''}
    </div>`;
}

async function renderProductUseCardHTML(run) {
  const flows = await listProcessFlows();
  if (!flows.length) return '';
  const linked = flows.filter((flow) => (flow.linkedProductFlowIds || []).map(Number).includes(Number(run.flowId)));
  const pool = linked.length ? linked : flows;
  const batches = [];
  for (const flow of pool) {
    const open = await openProcessRunsForFlow(flow.id);
    for (const item of open) {
      if (!(item.remainingKg > 0)) continue;
      batches.push({ ...item, flowName: flow.name });
    }
  }
  batches.sort((a, b) => String(a.expiresAt || '9999').localeCompare(String(b.expiresAt || '9999')));
  const copies = run.processUseCopies || [];
  return `
    <div class="card pm-run-card">
      <div class="card-title">חומרי גלם בתהליך</div>
      <p class="form-hint" style="margin-top:0">עותק להצגה. המשקל האמיתי נשאר באצוות החומר, בלי ניפוק נוסף ובלי מנה כפולה. המנות הרגילות למטה נשארות.</p>
      ${allocationLinesHTML(copies, { removable: true })}
      ${batches.length ? `
        <div class="form-group" style="margin-top:8px">
          <label for="pm-pick-batch">אצווה פתוחה</label>
          <select id="pm-pick-batch">
            ${batches.map((item, index) => `<option value="${item.id}" data-output="${item.outputKg}" data-left="${item.remainingKg}">${index === 0 ? 'מומלץ · ' : ''}${escapeHtml(item.flowName)} · ${escapeHtml(item.processBatchCode || item.batchNumber)} · נשאר ${formatDecimal(item.remainingKg)} ק״ג</option>`).join('')}
          </select>
          ${linked.length ? '<p class="form-hint">האצווה הראשונה היא עם התוקף הקרוב.</p>' : '<p class="form-hint">אין שיוך מראש לתזרים הזה, לכן מוצגות כל האצוות הפתוחות. הראשונה היא עם התוקף הקרוב.</p>'}
        </div>
        <div class="pm-pct-row">
          <button type="button" class="btn btn-secondary btn-sm pm-pct" data-pct="100">100%</button>
          <button type="button" class="btn btn-secondary btn-sm pm-pct" data-pct="70">70%</button>
          <button type="button" class="btn btn-secondary btn-sm pm-pct" data-pct="50">50%</button>
          <button type="button" class="btn btn-secondary btn-sm pm-pct" data-pct="25">25%</button>
        </div>
        <p class="form-hint" id="pm-pct-preview">האחוז הוא מתוך המשקל שאחרי העיבוד, לא חישוב נוסף של תפוחים.</p>
        <div class="form-group">
          <label for="pm-use-pct">אחוז מהאצווה</label>
          <input type="number" id="pm-use-pct" min="0.1" max="100" step="0.1" inputmode="decimal" placeholder="70">
        </div>
        <div class="form-group">
          <label for="pm-use-kg">או ק״ג</label>
          <input type="number" id="pm-use-kg" min="0.001" step="0.001" inputmode="decimal" placeholder="משאיר את האחוז ריק">
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="pm-assign" style="width:100%">שייך לתזרים הזה</button>` : '<p class="form-hint">אין אצווה פתוחה עם יתרה. יוצרים אותה במתג «חומרים בתהליך».</p>'}
    </div>`;
}

export function bindProcessSlot(container, run, rerender) {
  const root = container.querySelector('.pm-run-card');
  if (!root) return;

  const preview = () => {
    const select = document.getElementById('pm-pick-batch');
    const option = select?.selectedOptions?.[0];
    const pct = Number(document.getElementById('pm-use-pct')?.value);
    const kgInput = Number(document.getElementById('pm-use-kg')?.value);
    const output = Number(option?.dataset.output);
    const left = Number(option?.dataset.left);
    const note = document.getElementById('pm-pct-preview');
    if (!note || !(output > 0)) return;
    const rounded = pct > 0 ? kgFromOutputPercent(output, pct) : (kgInput > 0 ? kgInput : null);
    if (!(rounded > 0)) return;
    note.textContent = rounded > left + 0.0005
      ? `זה ${formatDecimal(rounded)} ק״ג, ונשארו רק ${formatDecimal(left)} ק״ג`
      : `${pct > 0 ? `${pct}% = ` : ''}${formatDecimal(rounded)} ק״ג. בתזרים המוצר יופיע עותק, והיתרה תרד באצוות החומר בלבד.`;
  };

  document.getElementById('pm-save-weights')?.addEventListener('click', async () => {
    const button = document.getElementById('pm-save-weights');
    if (button) button.disabled = true;
    const save = async (confirmed) => saveProcessWeights(run.id, {
      inputKg: document.getElementById('pm-input-kg')?.value,
      outputKg: document.getElementById('pm-output-kg')?.value,
      supplierLots: document.getElementById('pm-supplier-lots')?.value,
      expiresAt: document.getElementById('pm-expires')?.value,
      confirmed,
    });
    try {
      await save(false);
      showToast('המשקלים נשמרו');
      rerender();
    } catch (err) {
      if (button) button.disabled = false;
      if (err.code === 'yield-confirm' && confirm(err.message)) {
        try {
          await save(true);
          showToast('נשמר וסומן כחריגת תפוקה');
          rerender();
        } catch (inner) {
          showToast(inner.message || 'שגיאה');
        }
        return;
      }
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('pm-add-waste')?.addEventListener('click', async () => {
    try {
      await addProcessWaste(run.id, {
        kg: document.getElementById('pm-waste-kg')?.value,
        reason: document.getElementById('pm-waste-reason')?.value,
      });
      showToast('הפחת נרשם על האצווה');
      rerender();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  document.getElementById('pm-mix')?.addEventListener('click', async () => {
    const other = document.getElementById('pm-mix-with')?.value;
    if (!other) {
      showToast('בחר אצווה לערבוב');
      return;
    }
    if (!confirm('לערבב את היתרות לאצווה חדשה? התוקף יהיה המוקדם מביניהן.')) return;
    try {
      const id = await mixProcessRuns(run.id, other);
      container.dataset.runId = String(id);
      container.dataset.view = 'run';
      showToast('נוצרה אצוות ערבוב');
      rerender();
    } catch (err) {
      showToast(err.message || 'שגיאה');
    }
  });

  root.querySelectorAll('.pm-pct').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('pm-use-pct');
      const kg = document.getElementById('pm-use-kg');
      if (input) input.value = btn.dataset.pct;
      if (kg) kg.value = '';
      preview();
    });
  });
  document.getElementById('pm-use-pct')?.addEventListener('input', () => {
    const kg = document.getElementById('pm-use-kg');
    if (kg && document.getElementById('pm-use-pct')?.value) kg.value = '';
    preview();
  });
  document.getElementById('pm-use-kg')?.addEventListener('input', () => {
    const pct = document.getElementById('pm-use-pct');
    if (pct && document.getElementById('pm-use-kg')?.value) pct.value = '';
    preview();
  });
  document.getElementById('pm-pick-batch')?.addEventListener('change', preview);

  document.getElementById('pm-assign')?.addEventListener('click', async () => {
    const button = document.getElementById('pm-assign');
    if (button) button.disabled = true;
    try {
      await assignProcessUse({
        sourceRunId: document.getElementById('pm-pick-batch')?.value,
        productRunId: run.id,
        pct: document.getElementById('pm-use-pct')?.value,
        kg: document.getElementById('pm-use-kg')?.value,
      });
      showToast('השיוך נשמר פעם אחת על אצוות החומר');
      rerender();
    } catch (err) {
      if (button) button.disabled = false;
      showToast(err.message || 'שגיאה');
    }
  });

  root.querySelectorAll('.pm-remove-use').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (isProcessRun(run)) await removeProcessUse(run.id, btn.dataset.allocId);
        else await removeProcessUseFromProduct(run.id, btn.dataset.allocId);
        showToast('השיוך הוסר');
        rerender();
      } catch (err) {
        showToast(err.message || 'שגיאה');
      }
    });
  });
}

export function expiryBannerHTML(notices) {
  if (!notices?.length) return '';
  const lines = notices.slice(0, 4).map((item) => {
    const when = item.status === 'expired' ? 'פג תוקף' : (item.status === 'today' ? 'תוקף היום' : 'תוקף מחר');
    const left = item.remainingKg != null ? ` · ${formatDecimal(item.remainingKg)} ק״ג` : '';
    return `${item.name} ${item.code} · ${when}${left}`;
  });
  return `
    <button type="button" class="card pm-expiry-banner" id="pm-expiry-banner">
      <strong>תוקף חומר בתהליך.</strong>
      <span>${escapeHtml(lines.join(' · '))}</span>
    </button>`;
}

export function bindExpiryBanner() {
  document.getElementById('pm-expiry-banner')?.addEventListener('click', () => {
    setMaterialMode('materials');
    document.querySelector('.nav-btn[data-screen="process"]')?.click();
  });
}
