/** ייצוא קטלוג מוצרים — HTML + Excel */

import { escapeHtml, formatMoney, productPriceUnitLabel } from './utils.js?v=459';
import { buildStandaloneReportHtml, saveReportPageAsHtml } from './report-page-export.js?v=459';
import { loadXLSX } from './xlsx-loader.js?v=459';
import {
  formatCatalogAllergens,
  formatCatalogPrice,
  formatCatalogWeight,
  isProductInCatalog,
} from './product-catalog.js?v=459';

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

function walkCatalogSections(layout) {
  const sections = [];
  for (const cat of layout.ungrouped || []) {
    sections.push({
      heading: cat.name,
      groupName: '',
      categoryName: cat.name,
      products: cat.products || [],
    });
  }
  for (const group of layout.groups || []) {
    for (const cat of group.categories || []) {
      sections.push({
        heading: `${group.name} · ${cat.name}`,
        groupName: group.name,
        categoryName: cat.name,
        products: cat.products || [],
      });
    }
  }
  return sections;
}

function productCardHtml(product, { groupName, categoryName, allergenMap }) {
  const allergens = formatCatalogAllergens(allergenMap?.get(product.id) ?? product.allergens);
  const price = formatCatalogPrice(product);
  const weight = formatCatalogWeight(product);
  const img = product.imageDataUrl
    ? `<img class="pcat-export-img" src="${product.imageDataUrl}" alt="">`
    : `<div class="pcat-export-img pcat-export-img--ph">🧁</div>`;
  const bits = [
    groupName || categoryName ? `<div class="list-item-meta">${escapeHtml([groupName, categoryName].filter(Boolean).join(' · '))}</div>` : '',
    price ? `<div class="list-item-meta">מחיר: ${escapeHtml(price)}</div>` : '',
    weight ? `<div class="list-item-meta">משקל: ${escapeHtml(weight)}</div>` : '',
    product.unitsPerCarton ? `<div class="list-item-meta">יח׳ בקרטון: ${escapeHtml(String(product.unitsPerCarton))}</div>` : '',
    product.shelfLife ? `<div class="list-item-meta">חיי מדף: ${escapeHtml(product.shelfLife)}</div>` : '',
    product.storageConditions ? `<div class="list-item-meta">אחסון: ${escapeHtml(product.storageConditions)}</div>` : '',
    `<div class="list-item-meta">אלרגנים: ${escapeHtml(allergens)}</div>`,
  ].join('');

  return `
    <div class="card pcat-export-card">
      <div class="pcat-export-row">
        ${img}
        <div>
          <div class="list-item-name">${escapeHtml(product.name)}</div>
          ${bits}
        </div>
      </div>
    </div>`;
}

export function buildProductCatalogExportBody(layout, { allergenMap } = {}) {
  const sections = walkCatalogSections(layout);
  if (!sections.length) {
    return `<div class="card"><p class="report-empty">אין מוצרים בקטלוג</p></div>`;
  }
  const extraCss = `
    <style>
      .pcat-export-row { display:flex; gap:12px; align-items:flex-start; }
      .pcat-export-img { width:88px; height:88px; object-fit:cover; border-radius:12px; background:#f1f5f9; flex-shrink:0; }
      .pcat-export-img--ph { display:flex; align-items:center; justify-content:center; font-size:2rem; }
      .pcat-export-section-title { font-size:1rem; font-weight:700; margin:18px 0 10px; color:#1e3a8a; }
      body { max-width:720px; }
    </style>`;
  return extraCss + sections.map((sec) => `
    <h2 class="pcat-export-section-title">${escapeHtml(sec.heading)}</h2>
    ${sec.products.map((p) => productCardHtml(p, {
    groupName: sec.groupName,
    categoryName: sec.categoryName,
    allergenMap,
  })).join('')}
  `).join('');
}

export async function exportProductCatalogHtml(layout, {
  allergenMap,
  title = 'קטלוג מוצרים',
  subtitle = 'מפעל עוגות',
} = {}) {
  const bodyHtml = buildProductCatalogExportBody(layout, { allergenMap });
  const datePart = new Date().toISOString().slice(0, 10);
  return saveReportPageAsHtml({
    title,
    subtitle,
    bodyHtml,
    filename: `product-catalog-${datePart}.html`,
  });
}

export async function exportProductCatalogExcel(layout, { allergenMap } = {}) {
  const XLSX = await loadXLSX();
  const rows = [[
    'קבוצה',
    'קטגוריה',
    'שם מוצר',
    'מחיר',
    'יחידת מחיר',
    'משקל (ק"ג)',
    'יח׳ בקרטון',
    'חיי מדף',
    'אחסון',
    'אלרגנים',
    'בקטלוג',
    'פעיל',
  ]];

  for (const sec of walkCatalogSections(layout)) {
    for (const p of sec.products) {
      const allergens = formatCatalogAllergens(allergenMap?.get(p.id) ?? p.allergens);
      rows.push([
        sec.groupName || '',
        sec.categoryName || '',
        p.name || '',
        Number(p.unitPrice) > 0 ? Number(p.unitPrice) : '',
        Number(p.unitPrice) > 0 ? productPriceUnitLabel(p) : '',
        Number(p.unitWeightKg) > 0 ? Number(p.unitWeightKg) : '',
        p.unitsPerCarton || '',
        p.shelfLife || '',
        p.storageConditions || '',
        allergens,
        isProductInCatalog(p) ? 'כן' : 'לא',
        p.active === false ? 'לא' : 'כן',
      ]);
    }
  }

  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = rows[0].map((_, i) => ({
    wch: Math.min(36, Math.max(10, ...rows.map((r) => String(r[i] ?? '').length + 2))),
  }));
  XLSX.utils.book_append_sheet(wb, sheet, 'קטלוג');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob(
    [wbout],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  );
  const datePart = new Date().toISOString().slice(0, 10);
  return shareOrDownloadBlob(blob, `product-catalog-${datePart}.xlsx`, 'קטלוג מוצרים');
}

/** נשמר לייצוא standalone מלא אם צריך */
export function buildProductCatalogStandaloneHtml(layout, opts = {}) {
  return buildStandaloneReportHtml({
    appTitle: opts.title || 'קטלוג מוצרים',
    subtitle: opts.subtitle || 'מפעל עוגות',
    bodyHtml: buildProductCatalogExportBody(layout, opts),
  });
}

export { formatMoney };
