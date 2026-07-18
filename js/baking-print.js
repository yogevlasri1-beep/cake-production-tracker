import { escapeHtml } from './utils.js?v=332';
import { RECIPE_OVEN_TYPES } from './kitchen-db.js?v=332';

const BAKING_PRINT_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    background: #fff;
    color: #0f172a;
    line-height: 1.45;
    padding: 18px;
    direction: rtl;
  }
  .baking-print-cover {
    margin-bottom: 18px;
    padding-bottom: 12px;
    border-bottom: 2px solid #c2410c;
  }
  .baking-print-cover h1 {
    font-size: 1.35rem;
    margin-bottom: 4px;
    color: #9a3412;
  }
  .baking-print-meta {
    font-size: 0.85rem;
    color: #64748b;
  }
  .baking-print-page {
    break-inside: avoid;
  }
  .baking-print-page + .baking-print-page {
    page-break-before: always;
    break-before: page;
    margin-top: 0;
    padding-top: 0;
  }
  .baking-print-oven-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin: 0 0 14px;
    padding: 10px 12px;
    border-radius: 10px;
    background: #fff7ed;
    border: 1px solid #fed7aa;
  }
  .baking-print-page--small .baking-print-oven-header {
    background: #f0f9ff;
    border-color: #bae6fd;
  }
  .baking-print-oven-header h2 {
    font-size: 1.2rem;
    color: #9a3412;
  }
  .baking-print-page--small .baking-print-oven-header h2 {
    color: #0369a1;
  }
  .baking-print-oven-count {
    font-size: 0.82rem;
    color: #64748b;
    white-space: nowrap;
  }
  .baking-print-group {
    margin-bottom: 16px;
  }
  .baking-print-group-title {
    font-size: 0.95rem;
    margin: 0 0 8px;
    color: #334155;
    border-bottom: 1px dashed #cbd5e1;
    padding-bottom: 4px;
  }
  .baking-print-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
    margin-bottom: 4px;
  }
  .baking-print-table th,
  .baking-print-table td {
    padding: 7px 8px;
    border-bottom: 1px solid #e2e8f0;
    text-align: right;
    vertical-align: top;
  }
  .baking-print-table th {
    background: #f8fafc;
    font-weight: 600;
    font-size: 0.8rem;
    color: #475569;
  }
  .baking-print-name {
    font-weight: 600;
  }
  .baking-print-path {
    display: block;
    margin-top: 2px;
    font-size: 0.78rem;
    font-weight: 400;
    color: #64748b;
  }
  .baking-print-empty {
    color: #64748b;
    font-size: 0.9rem;
    padding: 8px 0;
  }
  .baking-print-footer {
    margin-top: 20px;
    font-size: 0.72rem;
    color: #94a3b8;
    text-align: center;
  }
  @media print {
    body { padding: 0; }
    .baking-print-page + .baking-print-page {
      page-break-before: always;
      break-before: page;
    }
    .baking-print-group { break-inside: avoid; }
    .baking-print-table tr { break-inside: avoid; }
  }
`;

function sourceLabel(source) {
  if (source === 'product') return 'שיוך מוצר';
  if (source === 'category') return 'שיוך קטגוריה';
  if (source === 'group') return 'מירושת קבוצה';
  return '';
}

function groupByCatalogGroup(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.groupName || item.categoryPath?.split(' › ')[0] || 'ללא קבוצה';
    if (!map.has(key)) map.set(key, { key, label: key, items: [] });
    map.get(key).items.push(item);
  }
  return [...map.values()];
}

function groupByCategoryPath(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.categoryPath || 'אחר';
    if (!map.has(key)) map.set(key, { key, label: key, items: [] });
    map.get(key).items.push(item);
  }
  return [...map.values()];
}

function formatParam(value, suffix) {
  if (value == null || value === '') return '—';
  return `${value}${suffix}`;
}

function renderGroupTable(group, viewMode) {
  const isCategory = viewMode === 'category';
  const nameHeader = isCategory ? 'קטגוריה' : 'מוצר';
  const rows = group.items.map((item) => {
    const primary = isCategory
      ? (item.categoryName || item.productName || '')
      : (item.productName || '');
    const secondary = isCategory
      ? [item.baking?.profileName, sourceLabel(item.source)].filter(Boolean).join(' · ')
      : [item.categoryPath, item.baking?.profileName, sourceLabel(item.source)].filter(Boolean).join(' · ');
    return `
      <tr>
        <td>
          <span class="baking-print-name">${escapeHtml(primary)}</span>
          ${secondary ? `<span class="baking-print-path">${escapeHtml(secondary)}</span>` : ''}
        </td>
        <td>${escapeHtml(formatParam(item.baking?.bakeTempC, '°'))}</td>
        <td>${escapeHtml(formatParam(item.baking?.bakeTimeMinutes, ' דק׳'))}</td>
        <td>${escapeHtml(formatParam(item.baking?.bakeSteamSeconds, ' שנ׳'))}</td>
        <td>${escapeHtml(formatParam(item.baking?.bakeDryMinutes, ' דק׳'))}</td>
      </tr>`;
  }).join('');

  return `
    <div class="baking-print-group">
      <h3 class="baking-print-group-title">${escapeHtml(group.label)}</h3>
      <table class="baking-print-table">
        <thead>
          <tr>
            <th>${nameHeader}</th>
            <th>טמפ׳</th>
            <th>זמן</th>
            <th>קיטור</th>
            <th>יבוש</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderOvenPage(ovenType, items, viewMode) {
  const label = RECIPE_OVEN_TYPES[ovenType] || ovenType;
  const unit = viewMode === 'category' ? 'קטגוריות' : 'מוצרים';
  const groups = viewMode === 'category'
    ? groupByCatalogGroup(items)
    : groupByCategoryPath(items);
  const body = items.length
    ? groups.map((g) => renderGroupTable(g, viewMode)).join('')
    : `<p class="baking-print-empty">אין ${unit} לתנור זה</p>`;

  return `
    <section class="baking-print-page baking-print-page--${ovenType}">
      <div class="baking-print-oven-header">
        <h2>${escapeHtml(label)}</h2>
        <span class="baking-print-oven-count">${items.length} ${unit}</span>
      </div>
      ${body}
    </section>`;
}

export function buildBakingPrintHtml({
  viewMode = 'category',
  largeItems = [],
  smallItems = [],
  printedAt = '',
} = {}) {
  const modeLabel = viewMode === 'product' ? 'מפורט למוצרים' : 'לפי קטגוריות';
  const title = `רשימת אפיות · ${modeLabel}`;

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${BAKING_PRINT_CSS}</style>
</head>
<body>
  <header class="baking-print-cover">
    <h1>${escapeHtml(title)}</h1>
    <p class="baking-print-meta">הודפס: ${escapeHtml(printedAt || '')} · תנור גדול ותנור קטן בעמודים נפרדים</p>
  </header>
  ${renderOvenPage('large', largeItems, viewMode)}
  ${renderOvenPage('small', smallItems, viewMode)}
  <footer class="baking-print-footer">מעקב יצור — עמדת אפיות</footer>
</body>
</html>`;
}

export async function shareBakingHtml(html, {
  viewMode = 'category',
  filename,
  shareText,
} = {}) {
  const modeLabel = viewMode === 'product' ? 'מוצרים' : 'קטגוריות';
  const datePart = new Date().toISOString().slice(0, 10);
  const safeName = (filename && filename.endsWith('.html'))
    ? filename
    : (filename || `apiyot-${modeLabel}-${datePart}.html`);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const file = new File([blob], safeName, { type: 'text/html' });
  const text = shareText || `רשימת אפיות · ${modeLabel}`;

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: safeName, text });
      return 'share';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
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
