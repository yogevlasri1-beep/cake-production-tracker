import { getSetting, setSetting } from './db.js?v=558';
import { addDaysISO, todayISO } from './utils.js?v=558';

/** נשמר כהגדרה אחת שכבר מסתנכרנת בין המכשירים — בלי לגעת בטבלאות הייצור. */
export const PLANT_SETTING_KEY = 'plantImprovement';

export const LANES = [
  { id: 'red', label: 'אדום', hint: 'דחוף ואפשר עכשיו' },
  { id: 'yellow', label: 'צהוב', hint: 'חשוב, צריך תכנון או חומר' },
  { id: 'green', label: 'ירוק', hint: 'שיפור כשמתפנה זמן' },
];

export const INVEST_STATUSES = [
  { id: 'idea', label: 'רעיון' },
  { id: 'checking', label: 'בבדיקה' },
  { id: 'approved', label: 'אושר' },
  { id: 'done', label: 'בוצע' },
];

export const CORE_CATEGORIES = [
  { id: 'improve', label: 'שיפורים' },
  { id: 'maintain', label: 'תחזוקה' },
  { id: 'invest', label: 'השקעות ליעילות' },
];

const DEFAULT_DEPARTMENTS = [
  ['1', 'כניסה'],
  ['2', 'קבלת סחורה'],
  ['3', 'מחסן חומרי גלם'],
  ['4', 'שקילות'],
  ['5', 'הכנה וערבוב'],
  ['6', 'אפייה'],
  ['7', 'קירור'],
  ['8', 'קישוט והרכבה'],
  ['9', 'אריזה'],
  ['10', 'מוצר מוגמר'],
  ['11', 'יציאה'],
];

const LIST_KEYS = ['departments', 'improvements', 'maintenance', 'investments', 'notes'];
const TOMBSTONE_MS = 90 * 24 * 60 * 60 * 1000;

export function plantId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyPlant() {
  return {
    version: 1,
    updatedAt: '',
    departments: [],
    improvements: [],
    maintenance: [],
    investments: [],
    notes: [],
  };
}

export function seedDepartments(now = new Date().toISOString()) {
  return DEFAULT_DEPARTMENTS.map(([number, name], index) => ({
    id: `seed-${index + 1}`,
    number,
    name,
    row: 0,
    col: index,
    categories: [],
    updatedAt: now,
    deletedAt: null,
  }));
}

function asId(value) {
  const s = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{1,48}$/.test(s) ? s : '';
}

function asText(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function asDate(value) {
  const s = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function asStamp(value) {
  const s = String(value || '');
  return Number.isFinite(Date.parse(s)) ? s : '';
}

function asLane(value) {
  return LANES.some((lane) => lane.id === value) ? value : 'yellow';
}

function asStatus(value) {
  return INVEST_STATUSES.some((status) => status.id === value) ? value : 'idea';
}

function asCategories(value) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const name = asText(raw, 24);
    const key = name.toLocaleLowerCase('he');
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= 12) break;
  }
  return out;
}

function baseItem(raw) {
  const id = asId(raw?.id);
  if (!id) return null;
  return {
    id,
    updatedAt: asStamp(raw.updatedAt),
    deletedAt: asStamp(raw.deletedAt) || null,
  };
}

export function normalizePlant(raw) {
  const data = emptyPlant();
  if (!raw || typeof raw !== 'object') return data;
  data.version = 1;
  data.updatedAt = asStamp(raw.updatedAt);

  for (const row of Array.isArray(raw.departments) ? raw.departments : []) {
    const item = baseItem(row);
    if (!item) continue;
    const rowNo = Number(row.row);
    const col = Number(row.col);
    data.departments.push({
      ...item,
      number: asText(row.number, 12) || '—',
      name: asText(row.name, 40) || 'מחלקה',
      row: Number.isFinite(rowNo) && rowNo >= 0 ? Math.min(6, Math.round(rowNo)) : 0,
      col: Number.isFinite(col) ? Math.round(col) : 0,
      categories: asCategories(row.categories),
    });
  }

  for (const row of Array.isArray(raw.improvements) ? raw.improvements : []) {
    const item = baseItem(row);
    if (!item) continue;
    data.improvements.push({
      ...item,
      departmentId: asId(row.departmentId),
      title: asText(row.title, 80) || 'שיפור',
      note: asText(row.note, 280),
      lane: asLane(row.lane),
      doneAt: asStamp(row.doneAt) || null,
    });
  }

  for (const row of Array.isArray(raw.maintenance) ? raw.maintenance : []) {
    const item = baseItem(row);
    if (!item) continue;
    const every = Math.round(Number(row.everyDays));
    data.maintenance.push({
      ...item,
      departmentId: asId(row.departmentId),
      title: asText(row.title, 80) || 'תחזוקה',
      everyDays: Number.isFinite(every) && every > 0 ? Math.min(365, every) : 7,
      nextDue: asDate(row.nextDue),
      lastDone: asDate(row.lastDone),
    });
  }

  for (const row of Array.isArray(raw.investments) ? raw.investments : []) {
    const item = baseItem(row);
    if (!item) continue;
    const cost = Number(row.cost);
    data.investments.push({
      ...item,
      departmentId: asId(row.departmentId),
      title: asText(row.title, 80) || 'השקעה',
      benefit: asText(row.benefit, 140),
      cost: Number.isFinite(cost) && cost >= 0 ? Math.round(cost * 100) / 100 : null,
      status: asStatus(row.status),
    });
  }

  for (const row of Array.isArray(raw.notes) ? raw.notes : []) {
    const item = baseItem(row);
    if (!item) continue;
    data.notes.push({
      ...item,
      departmentId: asId(row.departmentId),
      category: asText(row.category, 24),
      text: asText(row.text, 200) || 'רשומה',
      doneAt: asStamp(row.doneAt) || null,
    });
  }

  return data;
}

function stampOf(item) {
  return Date.parse(item?.updatedAt || '') || 0;
}

function mergeById(baseList, incomingList) {
  const map = new Map();
  for (const item of [...(baseList || []), ...(incomingList || [])]) {
    if (!item?.id) continue;
    const prev = map.get(item.id);
    if (!prev || stampOf(item) >= stampOf(prev)) map.set(item.id, item);
  }
  const cutoff = Date.now() - TOMBSTONE_MS;
  return [...map.values()].filter((item) => {
    if (!item.deletedAt) return true;
    const deleted = Date.parse(item.deletedAt);
    return !Number.isFinite(deleted) || deleted >= cutoff;
  });
}

/** שומר את הרשומה החדשה יותר מכל מכשיר, כולל מחיקה. */
export function mergePlant(base, incoming) {
  const left = normalizePlant(base);
  const right = normalizePlant(incoming);
  const out = emptyPlant();
  for (const key of LIST_KEYS) out[key] = mergeById(left[key], right[key]);
  out.updatedAt = right.updatedAt || left.updatedAt || '';
  return out;
}

export function activeItems(list) {
  return (list || []).filter((item) => item && !item.deletedAt);
}

export function departmentOrder(departments) {
  return [...(departments || [])].sort((a, b) => (
    (a.row || 0) - (b.row || 0)
    || (a.col || 0) - (b.col || 0)
    || String(a.number).localeCompare(String(b.number), 'he', { numeric: true })
  ));
}

export function departmentTracks(departments) {
  const rows = new Map();
  for (const dept of departmentOrder(activeItems(departments))) {
    const row = dept.row || 0;
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(dept);
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]);
}

export function nextDepartmentNumber(departments) {
  let max = 0;
  for (const dept of activeItems(departments)) {
    const n = parseInt(String(dept.number).replace(/\D/g, ''), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return String(max + 1);
}

export function shiftDepartment(departments, id, delta, now) {
  const list = (departments || []).map((dept) => ({ ...dept }));
  const current = list.find((dept) => dept.id === id && !dept.deletedAt);
  if (!current || !delta) return departments || [];
  const row = current.row || 0;
  const rowItems = list
    .filter((dept) => !dept.deletedAt && (dept.row || 0) === row)
    .sort((a, b) => (a.col || 0) - (b.col || 0));
  const index = rowItems.findIndex((dept) => dept.id === id);
  const swap = index + delta;
  if (index < 0 || swap < 0 || swap >= rowItems.length) return departments || [];
  const moved = rowItems[index];
  rowItems[index] = rowItems[swap];
  rowItems[swap] = moved;
  rowItems.forEach((dept, col) => {
    dept.col = col;
    dept.updatedAt = now;
  });
  return list;
}

export function toggleDepartmentTrack(departments, id, now) {
  const list = (departments || []).map((dept) => ({ ...dept }));
  const current = list.find((dept) => dept.id === id && !dept.deletedAt);
  if (!current) return departments || [];
  current.row = (current.row || 0) > 0 ? 0 : 1;
  const siblings = list.filter((dept) => !dept.deletedAt && (dept.row || 0) === current.row && dept.id !== id);
  current.col = siblings.reduce((max, dept) => Math.max(max, dept.col || 0), -1) + 1;
  current.updatedAt = now;
  return list;
}

export function daysApart(fromIso, toIso) {
  const from = Date.parse(`${fromIso}T12:00:00`);
  const to = Date.parse(`${toIso}T12:00:00`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86400000);
}

export function maintenanceUrgency(item, today) {
  if (!item || item.deletedAt) return 'off';
  const due = item.nextDue || today;
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  return 'later';
}

export function completeMaintenance(item, today, nowIso) {
  const every = Math.max(1, Math.round(Number(item.everyDays) || 1));
  return {
    ...item,
    everyDays: every,
    lastDone: today,
    nextDue: addDaysISO(today, every),
    updatedAt: nowIso,
  };
}

export function intervalLabel(days) {
  const n = Math.max(1, Math.round(Number(days) || 1));
  if (n === 1) return 'כל יום';
  if (n === 7) return 'כל שבוע';
  if (n === 30) return 'כל חודש';
  if (n === 90) return 'כל 3 חודשים';
  return `כל ${n} ימים`;
}

export function summarizePlant(data, today) {
  const improvements = activeItems(data?.improvements).filter((item) => !item.doneAt);
  const maintenance = activeItems(data?.maintenance);
  const due = maintenance.filter((item) => {
    const urgency = maintenanceUrgency(item, today);
    return urgency === 'overdue' || urgency === 'today';
  });
  return {
    red: improvements.filter((item) => item.lane === 'red').length,
    yellow: improvements.filter((item) => item.lane === 'yellow').length,
    green: improvements.filter((item) => item.lane === 'green').length,
    due: due.length,
    overdue: maintenance.filter((item) => maintenanceUrgency(item, today) === 'overdue').length,
  };
}

export function menuHintFromSummary(summary) {
  const n = (summary?.due || 0) + (summary?.red || 0);
  if (n > 0) return `${n} להיום`;
  return 'מפה, שיפורים, תחזוקה להיום';
}

export function restoreDefaultDepartments(data, now) {
  const next = normalizePlant(data);
  const byId = new Map(next.departments.map((dept) => [dept.id, dept]));
  for (const seed of seedDepartments(now)) {
    const prev = byId.get(seed.id);
    if (!prev) {
      next.departments.push(seed);
      continue;
    }
    if (prev.deletedAt) {
      prev.deletedAt = null;
      prev.updatedAt = now;
      prev.name = seed.name;
      prev.number = seed.number;
      prev.row = 0;
      prev.col = seed.col;
    }
  }
  return next;
}

let saveChain = Promise.resolve();

async function savePlantNow(next) {
  const current = normalizePlant(await getSetting(PLANT_SETTING_KEY));
  const merged = mergePlant(current, next);
  merged.updatedAt = new Date().toISOString();
  await setSetting(PLANT_SETTING_KEY, merged);
  return merged;
}

export function savePlant(next) {
  const run = saveChain.then(() => savePlantNow(next));
  saveChain = run.then(() => {}, () => {});
  return run;
}

export async function loadPlant() {
  const raw = await getSetting(PLANT_SETTING_KEY);
  if (raw == null) {
    const now = new Date().toISOString();
    const fresh = emptyPlant();
    fresh.departments = seedDepartments(now);
    fresh.updatedAt = now;
    await setSetting(PLANT_SETTING_KEY, fresh);
    return fresh;
  }
  return normalizePlant(raw);
}

export async function refreshPlantMenuHint() {
  const el = document.getElementById('plant-menu-hint');
  if (!el) return;
  try {
    const data = await loadPlant();
    el.textContent = menuHintFromSummary(summarizePlant(data, todayISO()));
  } catch {
    /* התפריט נשאר עם הטקסט הקבוע */
  }
}
