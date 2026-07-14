import { escapeHtml } from './utils.js?v=296';

const RATIO_PRINT_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    background: #fff;
    color: #0f172a;
    line-height: 1.5;
    padding: 20px;
    max-width: 720px;
    margin: 0 auto;
    direction: rtl;
  }
  .ratio-print-header {
    border-bottom: 2px solid #2563eb;
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  .ratio-print-header h1 {
    font-size: 1.25rem;
    margin-bottom: 4px;
  }
  .ratio-print-meta {
    font-size: 0.85rem;
    color: #64748b;
  }
  .ratio-print-banner {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 16px;
    font-size: 0.92rem;
  }
  .ratio-print-banner strong { color: #1d4ed8; }
  .ratio-print-factor {
    display: inline-block;
    margin-top: 6px;
    padding: 2px 10px;
    background: #2563eb;
    color: #fff;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 700;
  }
  .ratio-print-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
    margin-bottom: 16px;
  }
  .ratio-print-table th,
  .ratio-print-table td {
    padding: 8px 10px;
    border-bottom: 1px solid #e2e8f0;
    text-align: right;
  }
  .ratio-print-table th {
    background: #f8fafc;
    font-weight: 600;
  }
  .ratio-print-table tr.ratio-print-anchor td {
    background: #fef9c3;
    font-weight: 600;
  }
  .ratio-print-table tfoot td {
    font-weight: 700;
    border-top: 2px solid #cbd5e1;
    padding-top: 10px;
  }
  .ratio-print-summary {
    margin: 14px 0;
    padding: 12px;
    background: #f8fafc;
    border-radius: 8px;
    font-size: 0.9rem;
  }
  .ratio-print-extra {
    margin: 8px 0;
    font-size: 0.88rem;
    color: #334155;
  }
  .ratio-print-footer {
    margin-top: 24px;
    font-size: 0.75rem;
    color: #94a3b8;
    text-align: center;
  }
  @media print {
    body { padding: 0; max-width: none; }
    .ratio-print-banner { break-inside: avoid; }
    .ratio-print-table { break-inside: avoid; }
  }
`;

export function buildRatioPrintHtml(snapshot) {
  const {
    recipeName,
    anchorName,
    anchorUnit,
    baseQty,
    targetQty,
    ratioFactor,
    rows = [],
    totalText = '',
    extras = [],
    printedAt,
  } = snapshot;

  const tableRows = rows.map((row) => `
    <tr class="${row.isAnchor ? 'ratio-print-anchor' : ''}">
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.origQty)} ${escapeHtml(row.unit)}</td>
      <td><strong>${escapeHtml(row.scaledQty)}</strong> ${escapeHtml(row.unit)}</td>
    </tr>`).join('');

  const extrasHtml = extras.filter(Boolean).map((line) =>
    `<p class="ratio-print-extra">${line}</p>`).join('');

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>מחשבון יחס · ${escapeHtml(recipeName || '')}</title>
  <style>${RATIO_PRINT_CSS}</style>
</head>
<body>
  <header class="ratio-print-header">
    <h1>מחשבון יחס · ${escapeHtml(recipeName || '')}</h1>
    <p class="ratio-print-meta">הודפס: ${escapeHtml(printedAt || '')}</p>
  </header>
  <div class="ratio-print-banner">
    שינוי יחס לפי <strong>${escapeHtml(anchorName || '')}</strong>:
    מ-<strong>${escapeHtml(String(baseQty ?? ''))}</strong> ${escapeHtml(anchorUnit || '')}
    ל-<strong>${escapeHtml(String(targetQty ?? ''))}</strong> ${escapeHtml(anchorUnit || '')}
    <div class="ratio-print-factor">×${escapeHtml(String(ratioFactor ?? ''))}</div>
  </div>
  <table class="ratio-print-table">
    <thead>
      <tr>
        <th>חומר גלם</th>
        <th>מקור</th>
        <th>מחושב</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
    ${totalText ? `<tfoot><tr><td colspan="3">${escapeHtml(totalText)}</td></tr></tfoot>` : ''}
  </table>
  ${extrasHtml}
  <footer class="ratio-print-footer">מעקב יצור — מחשבון יחס</footer>
</body>
</html>`;
}

export function printRatioHtml(html) {
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
