const REPORT_PAGE_CSS = `
  :root {
    --bg: #f0f4f8;
    --surface: #ffffff;
    --primary: #2563eb;
    --text: #0f172a;
    --text-muted: #64748b;
    --border: #e2e8f0;
    --radius: 16px;
    --shadow: 0 1px 3px rgba(15, 23, 42, 0.06), 0 4px 16px rgba(37, 99, 235, 0.06);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
    padding: 20px;
    max-width: 480px;
    margin: 0 auto;
    direction: rtl;
  }
  .report-doc-header {
    background: linear-gradient(135deg, #1d4ed8, #3b82f6);
    color: white;
    border-radius: var(--radius);
    padding: 18px 16px;
    margin-bottom: 16px;
  }
  .report-doc-header h1 { font-size: 1.15rem; margin-bottom: 4px; }
  .report-doc-header p { font-size: 0.85rem; opacity: 0.9; }
  .report-doc-footer {
    margin-top: 20px;
    font-size: 0.75rem;
    color: var(--text-muted);
    text-align: center;
  }
  .card {
    background: var(--surface);
    border-radius: var(--radius);
    padding: 16px;
    margin-bottom: 12px;
    box-shadow: var(--shadow);
    border: 1px solid rgba(226, 232, 240, 0.8);
  }
  .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
  .stat-box {
    background: var(--surface);
    border-radius: 12px;
    padding: 14px;
    text-align: center;
    border: 1px solid var(--border);
  }
  .stat-value { font-size: 1.4rem; font-weight: 700; color: var(--primary); }
  .stat-label { font-size: 0.75rem; color: var(--text-muted); margin-top: 4px; }
  .report-preview-meta { font-size: 0.88rem; color: var(--text-muted); margin-bottom: 12px; }
  .report-preview-heading { font-size: 0.92rem; font-weight: 700; margin: 16px 0 8px; }
  .report-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  table.report-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  table.report-table th, table.report-table td {
    padding: 8px 6px;
    border-bottom: 1px solid var(--border);
    text-align: right;
  }
  table.report-table th { background: #f8fafc; font-weight: 600; }
  table.report-table tfoot td { font-weight: 700; border-top: 2px solid var(--border); }
  .report-empty { color: var(--text-muted); text-align: center; padding: 12px; font-size: 0.88rem; }
  .report-preview-note { font-size: 0.78rem; color: var(--text-muted); margin-bottom: 8px; }
  .list-item { padding: 10px 0; border-bottom: 1px solid var(--border); }
  .list-item-name { font-weight: 600; font-size: 0.88rem; }
  .list-item-meta { font-size: 0.78rem; color: var(--text-muted); margin-top: 2px; }
  .process-card { border-right: 3px solid #0ea5e9; }
  @media print {
    body { background: white; padding: 0; max-width: none; }
    .card { box-shadow: none; break-inside: avoid; }
  }
`;

export function buildStandaloneReportHtml({ appTitle, subtitle, bodyHtml, exportedAt }) {
  const when = exportedAt || new Date().toLocaleString('he-IL');
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appTitle}</title>
  <style>${REPORT_PAGE_CSS}</style>
</head>
<body>
  <header class="report-doc-header">
    <h1>${appTitle}</h1>
    <p>${subtitle}</p>
  </header>
  <main class="report-doc-body">
    ${bodyHtml}
  </main>
  <footer class="report-doc-footer">מעקב יצור · ${when}</footer>
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

export async function saveReportPageAsHtml({ title, subtitle, bodyHtml, filename }) {
  const html = buildStandaloneReportHtml({
    appTitle: title,
    subtitle,
    bodyHtml,
  });
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const safeName = filename.endsWith('.html') ? filename : `${filename}.html`;
  return shareOrDownloadBlob(blob, safeName, title);
}

export function printReportElement(rootEl) {
  if (!rootEl) return;
  const printRoot = document.getElementById('report-print-root');
  if (printRoot) printRoot.remove();

  const wrapper = document.createElement('div');
  wrapper.id = 'report-print-root';
  wrapper.className = 'report-print-root';
  wrapper.innerHTML = rootEl.innerHTML;
  document.body.appendChild(wrapper);

  const cleanup = () => {
    wrapper.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}
