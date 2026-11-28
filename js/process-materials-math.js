/** חישובים טהורים לחומר גלם בתהליך. בלי גישה למסד. */

import { flowNameKey } from './sync/collections.js?v=557';

export function roundQty(n, digits = 3) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

function calendarParts(date) {
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) return null;
    return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() };
  }
  const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

/** יום יוליאני: שנה דו-ספרתית + יום בשנה (001–366). */
export function julianDayCode(date) {
  const parts = calendarParts(date);
  if (!parts?.y || !parts.d) return null;
  const day = Math.floor((Date.UTC(parts.y, parts.m, parts.d) - Date.UTC(parts.y, 0, 1)) / 86400000) + 1;
  return `${String(parts.y).slice(-2)}${String(day).padStart(3, '0')}`;
}

export function formatProcessBatchCode(date, seq) {
  const julian = julianDayCode(date);
  const n = Math.max(1, Math.floor(Number(seq) || 1));
  if (!julian) return '';
  return `P-${julian}-${String(n).padStart(2, '0')}`;
}

export function isProcessBatchCode(value) {
  return /^P-\d{5}-\d{2,}$/i.test(String(value || '').trim());
}

export function isProcessRun(run) {
  return run?.flowKind === 'process' || isProcessBatchCode(run?.processBatchCode || run?.batchNumber);
}

export function isProcessFlow(flow) {
  return flow?.flowKind === 'process';
}

export function sumKg(rows, field = 'kg') {
  return roundQty((rows || []).reduce((sum, row) => sum + (Number(row?.[field]) || 0), 0)) || 0;
}

/** יתרה = משקל אחרי עיבוד פחות שיוכים פחות מה שנזרק. */
export function processRemainingKg(run) {
  const output = Number(run?.outputKg);
  if (!Number.isFinite(output) || output <= 0) return null;
  const used = sumKg(run?.processAllocations);
  const waste = sumKg(run?.processWaste);
  return roundQty(output - used - waste);
}

export function kgFromOutputPercent(outputKg, pct) {
  const output = Number(outputKg);
  const p = Number(pct);
  if (!(output > 0) || !(p > 0)) return null;
  return roundQty(output * p / 100);
}

export function percentFromKg(outputKg, kg) {
  const output = Number(outputKg);
  const used = Number(kg);
  if (!(output > 0) || !(used > 0)) return null;
  return roundQty(used / output * 100, 1);
}

export function yieldPercent(inputKg, outputKg) {
  const input = Number(inputKg);
  const output = Number(outputKg);
  if (!(input > 0) || !(output >= 0)) return null;
  return roundQty(output / input * 100, 1);
}

/** סטייה מעבר לפס הרגיל (ברירת מחדל 20 נקודות אחוז). */
export function yieldOutsideBand(actualPct, expectedPct, band = 20) {
  const actual = Number(actualPct);
  const expected = Number(expectedPct);
  if (!Number.isFinite(actual) || !(expected > 0)) return false;
  return Math.abs(actual - expected) > Number(band);
}

export function validateProcessWeights({ inputKg, outputKg, allocatedKg = 0 }) {
  const input = Number(inputKg);
  const output = Number(outputKg);
  if (!(input > 0)) return 'משקל שנכנס חובה';
  if (!(output > 0)) return 'משקל אחרי עיבוד חובה';
  if (output > input + 0.0005) return 'אחרי עיבוד אי אפשר יותר ממה שנכנס';
  if (output + 0.0005 < Number(allocatedKg || 0)) return 'המשקל קטן ממה שכבר שויך או נזרק';
  return '';
}

export function rollingCostPerKg(runs, limit = 8) {
  const rows = (runs || [])
    .filter((run) => Number(run?.costPerKg) > 0 && Number(run?.outputKg) > 0)
    .sort((a, b) => String(b.startedAt || b.date || '').localeCompare(String(a.startedAt || a.date || '')));
  const slice = rows.slice(0, limit);
  if (!slice.length) return null;
  const sum = slice.reduce((total, run) => total + Number(run.costPerKg), 0);
  return roundQty(sum / slice.length, 2);
}

export function addDaysToISO(isoDate, days) {
  const n = Math.floor(Number(days));
  if (!isoDate || !Number.isFinite(n) || n <= 0) return null;
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * כפילות תזרים חומר: אותו שם אחרי נרמול, או אותו מתכון.
 * exceptId הוא התזרים שנערך, כדי שלא ייחסם מול עצמו.
 * מחזיר 'name' | 'recipe' | ''.
 */
export function processFlowConflict(flows, { name, recipeId, exceptId = null } = {}) {
  const others = (flows || []).filter((flow) => exceptId == null || Number(flow.id) !== Number(exceptId));
  const key = flowNameKey(name);
  if (key && others.some((flow) => flowNameKey(flow.name) === key)) return 'name';
  const rid = Number(recipeId);
  if (Number.isInteger(rid) && rid > 0 && others.some((flow) => Number(flow.recipeId) === rid)) return 'recipe';
  return '';
}

export function processFlowConflictMessage(kind) {
  if (kind === 'name') return 'כבר יש תזרים בשם הזה';
  if (kind === 'recipe') return 'למתכון הזה כבר יש תזרים';
  return '';
}

export function expiryStatus(expiresAt, today) {
  if (!expiresAt || !today) return '';
  if (expiresAt < today) return 'expired';
  if (expiresAt === today) return 'today';
  const tomorrow = addDaysToISO(today, 1);
  if (expiresAt === tomorrow) return 'tomorrow';
  return 'ok';
}
