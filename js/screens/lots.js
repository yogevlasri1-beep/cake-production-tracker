import { escapeHtml, formatDate, showToast } from '../utils.js?v=424';
import { searchLotTrace, lotTraceEmptyHint } from '../lot-trace.js?v=424';

export function lotsMeta() {
  return {
    title: 'מעקב אצוות',
    subtitle: 'אצוות ייצור ↔ מספרי מנה של חומרי גלם',
  };
}

function statusLabel(status) {
  if (status === 'active') return 'פעיל';
  if (status === 'completed') return 'הושלם';
  return status || '—';
}

function productsHtml(lines) {
  if (!lines?.length) return '<p class="form-hint" style="margin:0">אין רשומות ייצור מקושרות</p>';
  return `<ul class="lots-list">${lines.map((l) => (
    `<li>${escapeHtml(l.name)}${l.quantity ? ` · ${escapeHtml(String(l.quantity))}` : ''}</li>`
  )).join('')}</ul>`;
}

function materialsHtml(materials) {
  if (!materials?.length) {
    return '<p class="form-hint" style="margin:0">לא נרשמו מספרי מנה על חומרי גלם בתזרים זה</p>';
  }
  return `<ul class="lots-list">${materials.map((m) => (
    `<li class="${m.matched ? 'lots-hit' : ''}">
      <span dir="ltr"><strong>${escapeHtml(m.packagingBatchNumber)}</strong></span>
      — ${escapeHtml(m.ingredientName)}
      ${m.supplierName ? ` · ${escapeHtml(m.supplierName)}` : ''}
      ${m.portionName ? ` · מנה: ${escapeHtml(m.portionName)}` : ''}
    </li>`
  )).join('')}</ul>`;
}

function productionCard(hit) {
  return `
    <div class="card lots-card">
      <div class="accounts-card-head">
        <div>
          <div class="card-title" style="margin-bottom:4px">אצווה <span dir="ltr">${escapeHtml(hit.batchNumber)}</span></div>
          <p class="form-hint" style="margin:0">${escapeHtml(formatDate(hit.date))} · ${escapeHtml(hit.flowName)}${hit.scopeLabel ? ` · ${escapeHtml(hit.scopeLabel)}` : ''}</p>
          <p class="form-hint" style="margin:4px 0 0">סטטוס: ${escapeHtml(statusLabel(hit.status))}
            ${hit.portionCount ? ` · מנות: ${hit.portionCount}` : ''}
            ${hit.productionQty ? ` · כמות יצור: ${hit.productionQty}` : ''}
          </p>
        </div>
        <button type="button" class="btn btn-secondary lots-open-run" data-run-id="${hit.runId}">פתח תזרים</button>
      </div>
      <h4 class="lots-subhead">חומרי גלם (מספרי מנה)</h4>
      ${materialsHtml(hit.materials)}
      <h4 class="lots-subhead">מוצרים שיוצרו</h4>
      ${productsHtml(hit.productLines)}
    </div>`;
}

function materialCard(hit) {
  return `
    <div class="card lots-card">
      <div class="card-title" style="margin-bottom:4px">מספר מנה <span dir="ltr">${escapeHtml(hit.packagingBatchNumber)}</span></div>
      <p class="form-hint" style="margin:0">${escapeHtml(hit.ingredientName)}${hit.supplierName ? ` · ${escapeHtml(hit.supplierName)}` : ''}</p>
      <p class="form-hint">נכנס לתזרים: <strong>${escapeHtml(hit.flowName)}</strong>
        ${hit.runBatchNumber ? ` · אצווה <span dir="ltr">${escapeHtml(hit.runBatchNumber)}</span>` : ' · בלי מספר אצווה'}
        · ${escapeHtml(formatDate(hit.runDate))} · ${escapeHtml(statusLabel(hit.runStatus))}
      </p>
      ${hit.productLines?.length ? `<h4 class="lots-subhead">מוצרים באצווה זו</h4>${productsHtml(hit.productLines)}` : ''}
      <div class="accounts-actions">
        <button type="button" class="btn btn-secondary lots-open-run" data-run-id="${hit.runId}">פתח תזרים</button>
        ${hit.runBatchNumber ? `<button type="button" class="btn btn-secondary lots-search-batch" data-batch="${escapeHtml(hit.runBatchNumber)}">חפש אצווה ${escapeHtml(hit.runBatchNumber)}</button>` : ''}
      </div>
    </div>`;
}

async function runSearch(container, query) {
  const resultsEl = container.querySelector('#lots-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = `<div class="card"><p class="form-hint">מחפש...</p></div>`;
  try {
    const result = await searchLotTrace(query);
    if (!result.query) {
      resultsEl.innerHTML = `<div class="card"><p class="form-hint">${escapeHtml(lotTraceEmptyHint())}</p></div>`;
      return;
    }
    if (!result.productionHits.length && !result.materialHits.length) {
      resultsEl.innerHTML = `
        <div class="card">
          <div class="card-title">לא נמצאו תוצאות</div>
          <p class="form-hint">אין אצווה או מספר מנה שתואמים ל«${escapeHtml(result.query)}». ודא שנרשם מספר אצווה בתזרים או מספר מנה על חומר גלם.</p>
        </div>`;
      return;
    }
    resultsEl.innerHTML = `
      <div class="card">
        <p class="form-hint" style="margin:0">נמצאו
          <strong>${result.productionHits.length}</strong> אצוות ייצור ·
          <strong>${result.materialHits.length}</strong> שימושי חומר גלם
          עבור «${escapeHtml(result.query)}»
        </p>
      </div>
      ${result.productionHits.length ? `<h3 class="accounts-section-title">אצוות ייצור</h3>${result.productionHits.map(productionCard).join('')}` : ''}
      ${result.materialHits.length ? `<h3 class="accounts-section-title">מספרי מנה (חומרי גלם) → לאן נכנסו</h3>${result.materialHits.map(materialCard).join('')}` : ''}
    `;
    bindResultActions(container, resultsEl);
  } catch (err) {
    resultsEl.innerHTML = `
      <div class="card" style="border:2px solid var(--danger)">
        <div class="card-title">שגיאה בחיפוש</div>
        <p>${escapeHtml(err.message || err)}</p>
      </div>`;
  }
}

function bindResultActions(container, resultsEl) {
  resultsEl.querySelectorAll('.lots-open-run').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const runId = btn.dataset.runId;
      const main = document.getElementById('main-content');
      if (main) {
        main.dataset.view = 'run';
        main.dataset.runId = String(runId);
      }
      try {
        const { navigateToWorkspace } = await import('../app.js?v=424');
        await navigateToWorkspace('production', 'process');
      } catch (err) {
        showToast(err.message || 'לא ניתן לפתוח תזרים');
      }
    });
  });
  resultsEl.querySelectorAll('.lots-search-batch').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = container.querySelector('#lots-query');
      if (input) input.value = btn.dataset.batch || '';
      runSearch(container, btn.dataset.batch || '');
    });
  });
}

export async function renderLots(container) {
  const previous = container.dataset.lotsQuery || '';
  container.innerHTML = `
    <div class="card">
      <div class="card-title">מעקב אצוות</div>
      <p class="form-hint">${escapeHtml(lotTraceEmptyHint())}</p>
      <form id="lots-search-form" class="lots-search-form">
        <div class="form-group" style="margin-bottom:10px">
          <label for="lots-query">מספר אצווה / מספר מנה</label>
          <input type="search" id="lots-query" value="${escapeHtml(previous)}" placeholder="לדוגמה 56 או LOT-123" autocomplete="off" dir="ltr">
        </div>
        <button type="submit" class="btn btn-primary">חפש</button>
      </form>
    </div>
    <div id="lots-results">
      <div class="card"><p class="form-hint">${escapeHtml(lotTraceEmptyHint())}</p></div>
    </div>
  `;

  container.querySelector('#lots-search-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = container.querySelector('#lots-query')?.value || '';
    container.dataset.lotsQuery = q;
    runSearch(container, q);
  });

  if (previous) await runSearch(container, previous);
}
