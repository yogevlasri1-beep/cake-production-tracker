export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidISODate(value) {
  if (!ISO_DATE.test(String(value || ''))) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function sanitizeQuantity(raw, { min = 1, max = 1_000_000, allowZero = false } = {}) {
  if (raw === '' || raw == null) return null;
  const n = Math.round(Number(String(raw).replace(/,/g, '').trim()));
  if (!Number.isFinite(n)) return null;
  if (allowZero) {
    if (n < 0 || n > max) return null;
    return n;
  }
  if (n < min || n > max) return null;
  return n;
}

/** כמות במתכון — מאפשר עשרוניות עד 3 ספרות (למשל 1.150, 103.6) */
export function sanitizeRecipeQuantity(raw, { min = 0.001, max = 1_000_000, allowZero = false } = {}) {
  if (raw === '' || raw == null) return null;
  const n = Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 1000) / 1000;
  if (allowZero) {
    if (rounded < 0 || rounded > max) return null;
    return rounded;
  }
  if (rounded < min || rounded > max) return null;
  return rounded;
}

/** כמות מנות — מאפשר עשרוניות מ-0.1 (למשל 0.3 מנה) */
export function sanitizePortionCount(raw, { min = 0.1, max = 1_000_000 } = {}) {
  if (raw === '' || raw == null) return null;
  const n = Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n * 10) / 10;
}

/** משקל מנה בק"ג — מאפשר עשרוניות (למשל 0.1 = 100 גרם) */
export function sanitizePortionSize(raw, { min = 0.001, max = 100_000 } = {}) {
  if (raw === '' || raw == null) return null;
  const n = Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n * 1000) / 1000;
}

export function sanitizeMoney(raw) {
  if (raw === '' || raw == null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

export function sanitizeTargetQuantity(raw) {
  if (raw === '' || raw == null) return 0;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return null;
  return n;
}

export function sanitizeName(raw, maxLen = 120) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!s || s.length > maxLen) return null;
  return s;
}

/** מפתח להשוואת שמות מוצר — מונע כפילויות מייבוא */
export function productNameKey(raw) {
  const s = sanitizeName(raw);
  return s ? s.toLocaleLowerCase('he') : '';
}

export function sanitizeProductId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

export function roundMoney(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function sanitizeCategoryColor(raw) {
  if (raw === '' || raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!HEX_COLOR.test(s)) return null;
  return s;
}

export function assertValidISODate(value, label = 'תאריך') {
  if (!isValidISODate(value)) throw new ValidationError(`${label} לא תקין`);
  return value;
}

export function assertValidQuantity(raw, label = 'כמות') {
  const qty = sanitizeQuantity(raw);
  if (qty === null) throw new ValidationError(`${label} חייבת להיות מספר שלם בין 1 ל-1,000,000`);
  return qty;
}
