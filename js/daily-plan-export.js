import { escapeHtml } from './utils.js?v=283';

const DAILY_PLAN_PRINT_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4 portrait; margin: 8mm; }
  html, body {
    font-family: "Arial Hebrew", Arial, sans-serif;
    direction: rtl;
    color: #0f172a;
    background: #fff;
    line-height: 1.3;
  }
  body { padding: 10mm; font-size: 14pt; }
  .plan-doc { max-width: 100%; }
  .plan-header {
    text-align: center;
    border-bottom: 3px solid #1d4ed8;
    padding-bottom: 8px;
    margin-bottom: 10px;
  }
  .plan-header h1 {
    font-size: 22pt;
    font-weight: 800;
    margin-bottom: 4px;
  }
  .plan-header .plan-date {
    font-size: 16pt;
    font-weight: 600;
    color: #1e40af;
  }
  .plan-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 14px;
    align-items: start;
  }
  .plan-section {
    break-inside: avoid;
    margin-bottom: 8px;
  }
  .plan-section--full { grid-column: 1 / -1; }
  .plan-section-title {
    font-size: 16pt;
    font-weight: 800;
    color: #1d4ed8;
    border-bottom: 2px solid #bfdbfe;
    padding-bottom: 3px;
    margin-bottom: 6px;
  }
  .plan-list {
    list-style: none;
    padding: 0;
  }
  .plan-list li {
    font-size: 14pt;
    font-weight: 600;
    padding: 3px 0;
    border-bottom: 1px dotted #cbd5e1;
  }
  .plan-list li:last-child { border-bottom: none; }
  .plan-qty {
    font-weight: 800;
    color: #b45309;
    margin-right: 6px;
  }
  .plan-group-title {
    font-size: 12pt;
    font-weight: 700;
    color: #475569;
    margin: 6px 0 2px;
  }
  .plan-highlights {
    font-size: 14pt;
    font-weight: 600;
    white-space: pre-wrap;
    background: #fef9c3;
    border: 2px solid #facc15;
    border-radius: 8px;
    padding: 8px 10px;
    line-height: 1.35;
  }
  .plan-empty {
    font-size: 12pt;
    color: #64748b;
    font-style: italic;
  }
  .plan-footer {
    margin-top: 8px;
    font-size: 9pt;
    color: #94a3b8;
    text-align: center;
  }
  .plan-page-break {
    page-break-before: always;
    break-before: page;
  }
  .plan-page--flows {
    min-height: 0;
    padding-top: 4mm;
    display: flex;
    flex-direction: column;
  }
  .plan-flows-header {
    text-align: center;
    border-bottom: 3px solid #1d4ed8;
    padding-bottom: 6px;
    margin-bottom: 8px;
    flex-shrink: 0;
  }
  .plan-flows-header h2 {
    font-size: 18pt;
    font-weight: 800;
    color: #1d4ed8;
  }
  .plan-flows-grid {
    display: grid;
    grid-template-columns: repeat(var(--flow-cols, 1), minmax(0, 1fr));
    gap: 8px 10px;
    flex: 1;
    align-items: stretch;
    align-content: start;
  }
  .plan-flow-col {
    border: 2px solid #bfdbfe;
    border-radius: 8px;
    padding: 6px 8px;
    background: #f8fafc;
    break-inside: avoid;
    min-width: 0;
  }
  .plan-flow-col-title {
    font-size: 11pt;
    font-weight: 800;
    color: #1e40af;
    border-bottom: 1px solid #cbd5e1;
    padding-bottom: 4px;
    margin-bottom: 4px;
    line-height: 1.2;
  }
  .plan-flow-col-products {
    font-size: 8.5pt;
    font-weight: 600;
    color: #64748b;
    margin-bottom: 6px;
    line-height: 1.25;
  }
  .plan-flow-steps {
    list-style: none;
    padding: 0;
    counter-reset: flow-step;
  }
  .plan-flow-steps li {
    counter-increment: flow-step;
    font-size: 9.5pt;
    font-weight: 600;
    padding: 2px 0;
    border-bottom: 1px dotted #e2e8f0;
    line-height: 1.25;
    display: flex;
    gap: 4px;
    align-items: baseline;
  }
  .plan-flow-steps li:last-child { border-bottom: none; }
  .plan-flow-steps li::before {
    content: counter(flow-step);
    flex-shrink: 0;
    width: 1.4em;
    height: 1.4em;
    line-height: 1.4em;
    text-align: center;
    font-size: 8pt;
    font-weight: 800;
    color: #fff;
    background: #3b82f6;
    border-radius: 50%;
  }
  .plan-flow-step--production::after {
    content: " 📦";
    font-size: 8pt;
  }
  .plan-flow-step--portions::after {
    content: " 🍽";
    font-size: 8pt;
  }
  @media print {
    body { padding: 0; font-size: 13pt; }
    .plan-header h1 { font-size: 20pt; }
    .plan-section-title { font-size: 15pt; }
    .plan-list li { font-size: 13pt; padding: 2px 0; }
    .plan-highlights { font-size: 13pt; padding: 6px 8px; }
    .plan-page--flows {
      height: calc(100vh - 16mm);
      max-height: calc(100vh - 16mm);
      overflow: hidden;
      page-break-after: avoid;
      break-after: avoid;
    }
    .plan-flow-col-title { font-size: 10pt; }
    .plan-flow-steps li { font-size: 9pt; padding: 1px 0; }
  }
`;

function sortByOrder(a, b) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
}

function checklistDedupeKey(item) {
  if (item.itemKind === 'flow_preparation') {
    return `prep:${item.flowId || ''}:${item.flowPreparationId || item.label}`;
  }
  if (item.itemKind === 'flow_cleaning') {
    return `clean:${item.flowId || ''}:${item.flowCleaningTaskId || item.label}`;
  }
  return `other:${item.id}`;
}

function dedupeChecklistItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = checklistDedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function groupChecklistForExport(items, flowNames) {
  const byFlow = new Map();
  const orphans = [];
  for (const item of dedupeChecklistItems(items)) {
    const fid = item.flowId || null;
    if (fid) {
      if (!byFlow.has(fid)) byFlow.set(fid, []);
      byFlow.get(fid).push(item);
    } else {
      orphans.push(item);
    }
  }
  const groups = [...byFlow.entries()].map(([flowId, groupItems]) => ({
    title: flowNames?.get(flowId) || 'תזרים',
    items: groupItems.map((i) => i.label),
  }));
  return { groups, orphans };
}

/** מפרק פריטי תוכנית לסקשנים להדפסה */
export function organizeDailyPlanForExport(items, products, plan, { dayOffset = null, flowNames = null } = {}) {
  let filtered = items;
  if (dayOffset != null) {
    filtered = items.filter((i) => (i.dayOffset ?? 0) === dayOffset);
  }
  filtered = filtered.slice().sort(sortByOrder);

  const productsInPlan = filtered.filter((i) => i.itemKind === 'product');
  const preparations = filtered.filter((i) => i.itemKind === 'flow_preparation');
  const cleanings = filtered.filter((i) => i.itemKind === 'flow_cleaning');
  const manualTasks = filtered.filter((i) => i.itemKind === 'text');
  const extraTasks = filtered.filter((i) => ['flow_step', 'portion'].includes(i.itemKind));

  const prepGrouped = groupChecklistForExport(preparations, flowNames);
  const cleanGrouped = groupChecklistForExport(cleanings, flowNames);

  return {
    highlights: (plan?.notes || '').trim(),
    products: productsInPlan.map((item) => {
      const portionPart = item.portionName
        ? ` · ${item.portionName}${item.portionWeight != null ? ` (${item.portionWeight} ק"ג)` : ''}`
        : '';
      const qtyPart = item.quantity
        ? (item.portionPresetId ? ` × ${item.quantity} מנות` : ` × ${item.quantity}`)
        : '';
      return {
        label: `${item.label}${portionPart}${qtyPart}`,
        quantity: null,
      };
    }),
    taskGroups: [
      ...prepGrouped.groups,
      ...(prepGrouped.orphans.length ? [{ title: 'הכנות', items: prepGrouped.orphans.map((i) => i.label) }] : []),
      ...(manualTasks.length ? [{ title: 'ידני', items: manualTasks.map((i) => i.label) }] : []),
      ...(extraTasks.length ? [{ title: 'נוסף', items: extraTasks.map((i) => i.label) }] : []),
    ],
    cleaningGroups: [
      ...cleanGrouped.groups,
      ...(cleanGrouped.orphans.length ? [{ title: 'כללי', items: cleanGrouped.orphans.map((i) => i.label) }] : []),
    ],
  };
}

function renderPlanList(items, { qtyField = false } = {}) {
  if (!items?.length) return '<p class="plan-empty">—</p>';
  return `<ul class="plan-list">${items.map((item) => {
    const label = typeof item === 'string' ? item : item.label;
    const qty = typeof item === 'object' && item.quantity ? item.quantity : null;
    return `<li>${qty ? `<span class="plan-qty">×${escapeHtml(String(qty))}</span>` : ''}${escapeHtml(label)}</li>`;
  }).join('')}</ul>`;
}

function renderGroupedList(groups) {
  if (!groups?.length) return '<p class="plan-empty">—</p>';
  return groups.map((group) => `
    <div class="plan-group">
      <div class="plan-group-title">${escapeHtml(group.title)}</div>
      ${renderPlanList(group.items)}
    </div>`).join('');
}

export function buildDailyPlanBodyHtml(organized) {
  const { products, taskGroups, cleaningGroups, highlights } = organized;
  const allTasks = taskGroups.flatMap((g) => g.items);
  const allClean = cleaningGroups.flatMap((g) => g.items);

  return `
    <div class="plan-grid">
      <section class="plan-section plan-section--full">
        <h2 class="plan-section-title">📦 מוצרים לייצור היום</h2>
        ${renderPlanList(products, { qtyField: true })}
      </section>
      <section class="plan-section">
        <h2 class="plan-section-title">✅ משימות</h2>
        ${allTasks.length
    ? (taskGroups.length > 1 || taskGroups[0]?.title !== 'ידני'
      ? renderGroupedList(taskGroups)
      : renderPlanList(allTasks))
    : '<p class="plan-empty">—</p>'}
      </section>
      <section class="plan-section plan-section--full">
        <h2 class="plan-section-title">📝 הדגשים</h2>
        ${highlights
    ? `<div class="plan-highlights">${escapeHtml(highlights)}</div>`
    : '<p class="plan-empty">—</p>'}
      </section>
      <section class="plan-section">
        <h2 class="plan-section-title">🧹 נקיונות</h2>
        ${allClean.length
    ? (cleaningGroups.length > 1 ? renderGroupedList(cleaningGroups) : renderPlanList(allClean))
    : '<p class="plan-empty">—</p>'}
      </section>
    </div>`;
}

export function buildDailyPlanFlowsPageHtml(flowsData) {
  if (!flowsData?.length) return '';

  const cols = Math.min(flowsData.length, 4);
  const columns = flowsData.map(({ flow, steps, products }) => {
    const productLine = products.map((p) => (
      p.quantity ? `${p.label} ×${p.quantity}` : p.label
    )).join(' · ');
    const stepItems = steps.length
      ? steps.map((step) => {
        const flags = [
          step.tracksProduction ? 'plan-flow-step--production' : '',
          step.tracksPortions ? 'plan-flow-step--portions' : '',
        ].filter(Boolean).join(' ');
        return `<li class="${flags}">${escapeHtml(step.name)}</li>`;
      }).join('')
      : '<li style="font-style:italic;color:#64748b">אין שלבים</li>';

    return `
      <section class="plan-flow-col">
        <h3 class="plan-flow-col-title">${escapeHtml(flow.name)}</h3>
        ${productLine ? `<p class="plan-flow-col-products">${escapeHtml(productLine)}</p>` : ''}
        <ol class="plan-flow-steps">${stepItems}</ol>
      </section>`;
  }).join('');

  return `
    <div class="plan-page-break plan-page--flows" style="--flow-cols:${cols}">
      <header class="plan-flows-header">
        <h2>🔄 תזרימי ייצור</h2>
      </header>
      <div class="plan-flows-grid">${columns}</div>
    </div>`;
}

export function buildStandaloneDailyPlanHtml({ dateLabel, subtitle, bodyHtml, flowsPageHtml = '', exportedAt }) {
  const when = exportedAt || new Date().toLocaleString('he-IL');
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>תוכנית יומית · ${escapeHtml(dateLabel)}</title>
  <style>${DAILY_PLAN_PRINT_CSS}</style>
</head>
<body>
  <article class="plan-doc">
    <header class="plan-header">
      <h1>תוכנית יומית</h1>
      <p class="plan-date">${escapeHtml(dateLabel)}</p>
      ${subtitle ? `<p style="font-size:11pt;color:#64748b;margin-top:4px">${escapeHtml(subtitle)}</p>` : ''}
    </header>
    <main>${bodyHtml}</main>
    <footer class="plan-footer">מעקב יצור · ${escapeHtml(when)}</footer>
    ${flowsPageHtml}
  </article>
</body>
</html>`;
}

async function shareOrDownloadBlob(blob, filename, shareText) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename, text: shareText });
      return 'share';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 2000);
  return 'download';
}

export async function saveDailyPlanAsHtml({ dateLabel, subtitle, bodyHtml, flowsPageHtml, filename }) {
  const html = buildStandaloneDailyPlanHtml({ dateLabel, subtitle, bodyHtml, flowsPageHtml });
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const safeName = filename.endsWith('.html') ? filename : `${filename}.html`;
  return shareOrDownloadBlob(blob, safeName, `תוכנית יומית · ${dateLabel}`);
}

export function printDailyPlanHtml(html) {
  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  const trigger = () => {
    win.focus();
    win.print();
  };
  if (win.document.readyState === 'complete') trigger();
  else win.addEventListener('load', trigger, { once: true });
  return true;
}

export function buildDailyPlanExportHtml({ dateLabel, subtitle, items, products, plan, flowNames, flowsData }) {
  const organized = organizeDailyPlanForExport(items, products, plan, { flowNames });
  const bodyHtml = buildDailyPlanBodyHtml(organized);
  const flowsPageHtml = buildDailyPlanFlowsPageHtml(flowsData);
  return buildStandaloneDailyPlanHtml({ dateLabel, subtitle, bodyHtml, flowsPageHtml });
}
