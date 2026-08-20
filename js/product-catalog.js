/** עזרים לקטלוג מוצרים — תמונות, פילטרים, פורמט כרטיס */

import {
  escapeHtml,
  formatMoney,
  productPriceUnitLabel,
} from './utils.js?v=477';
import { isProductInCatalog } from './db.js?v=477';
import { productAllergenLabel } from './kitchen-db.js?v=477';

export { isProductInCatalog };

/** דוחס קובץ תמונה ל־JPEG data URL לקטלוג */
export async function compressImageForCatalog(file, { maxSide = 900, quality = 0.72 } = {}) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    throw new Error('יש לבחור קובץ תמונה');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas לא זמין');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (!dataUrl || dataUrl.length < 32) throw new Error('דחיסת התמונה נכשלה');
    if (dataUrl.length > 700_000) {
      // ניסיון שני איכות נמוכה יותר
      const retry = canvas.toDataURL('image/jpeg', 0.55);
      if (retry.length > 700_000) throw new Error('התמונה גדולה מדי גם אחרי דחיסה');
      return retry;
    }
    return dataUrl;
  } finally {
    bitmap.close?.();
  }
}

export function filterCatalogLayout(layout, {
  search = '',
  visibility = 'catalog', // catalog | hidden | all
  activeOnly = true,
} = {}) {
  const q = String(search || '').trim().toLowerCase();

  const matchProduct = (p) => {
    if (activeOnly && p.active === false) return false;
    const inCat = isProductInCatalog(p);
    if (visibility === 'catalog' && !inCat) return false;
    if (visibility === 'hidden' && inCat) return false;
    if (q && !String(p.name || '').toLowerCase().includes(q)) return false;
    return true;
  };

  const mapCategory = (cat) => {
    const products = (cat.products || []).filter(matchProduct);
    return products.length ? { ...cat, products } : null;
  };

  const groups = (layout.groups || []).map((g) => {
    const categories = (g.categories || []).map(mapCategory).filter(Boolean);
    return categories.length ? { ...g, categories } : null;
  }).filter(Boolean);

  const ungrouped = (layout.ungrouped || []).map(mapCategory).filter(Boolean);

  const productCount = [...ungrouped, ...groups.flatMap((g) => g.categories)]
    .reduce((n, c) => n + c.products.length, 0);

  return { groups, ungrouped, productCount };
}

export function formatCatalogPrice(product) {
  const price = Number(product?.unitPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  const unit = productPriceUnitLabel(product).replace(/^₪\//, '');
  return `${formatMoney(price)} / ${unit}`;
}

export function formatCatalogWeight(product) {
  const kg = Number(product?.unitWeightKg);
  if (!Number.isFinite(kg) || kg <= 0) return null;
  return `${kg} ק"ג`;
}

export function formatCatalogAllergens(allergenIds) {
  const ids = Array.isArray(allergenIds) ? allergenIds : [];
  if (!ids.length) return 'ללא אלרגנים ידועים';
  return ids.map((id) => productAllergenLabel(id)).join(', ');
}

export function catalogProductMetaLines(product, { allergenIds } = {}) {
  const lines = [];
  const price = formatCatalogPrice(product);
  if (price) lines.push({ label: 'מחיר', value: price });
  const weight = formatCatalogWeight(product);
  if (weight) lines.push({ label: 'משקל', value: weight });
  if (product.unitsPerCarton) {
    lines.push({ label: 'יח׳ בקרטון', value: String(product.unitsPerCarton) });
  }
  if (product.shelfLife) lines.push({ label: 'חיי מדף', value: product.shelfLife });
  if (product.storageConditions) lines.push({ label: 'אחסון', value: product.storageConditions });
  lines.push({ label: 'אלרגנים', value: formatCatalogAllergens(allergenIds ?? product.allergens) });
  return lines;
}

export function catalogImageHtml(product, { className = 'pcat-card-img' } = {}) {
  const src = product?.imageDataUrl;
  if (src) {
    return `<img class="${className}" src="${src}" alt="${escapeHtml(product.name || 'מוצר')}" loading="lazy">`;
  }
  return `<div class="${className} ${className}--placeholder" aria-hidden="true"><span>🧁</span></div>`;
}
