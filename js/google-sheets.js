import {
  db, getCategories, getProducts, getSetting, setSetting,
  importProductionRows, importCatalogRows,
} from './db.js?v=117';
import { computeReportRows, roundMoney } from './calc.js?v=117';
import { ValidationError } from './validators.js?v=117';

const SETTINGS_KEY = 'googleSheets';
const DEFAULT_TOKEN = 'yitzur2024';

export function extractSheetId(urlOrId) {
  const s = String(urlOrId || '').trim();
  if (!s) return null;
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s) && !s.includes('/')) return s;
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

export function sheetOpenUrl(sheetId) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
}

export async function getSheetsConfig() {
  const saved = await getSetting(SETTINGS_KEY);
  return {
    sheetUrl: '',
    sheetId: '',
    webAppUrl: '',
    token: DEFAULT_TOKEN,
    lastSyncAt: null,
    lastSyncLabel: null,
    ...(saved || {}),
  };
}

export async function saveSheetsConfig(patch) {
  const current = await getSheetsConfig();
  const next = { ...current, ...patch };
  if (patch.sheetUrl && !patch.sheetId) {
    next.sheetId = extractSheetId(patch.sheetUrl) || current.sheetId;
  }
  if (patch.sheetId && !patch.sheetUrl) {
    next.sheetUrl = sheetOpenUrl(patch.sheetId);
  }
  await setSetting(SETTINGS_KEY, next);
  return next;
}

export async function isSheetsConfigured() {
  const cfg = await getSheetsConfig();
  return !!(cfg.sheetId && cfg.webAppUrl);
}

function bridgeUrl(base, params) {
  const url = new URL(base);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, v);
  });
  return url.toString();
}

async function bridgeGet(cfg, action) {
  const res = await fetch(bridgeUrl(cfg.webAppUrl, {
    action,
    token: cfg.token || DEFAULT_TOKEN,
  }), { method: 'GET', redirect: 'follow' });
  const data = await res.json();
  if (data.error) throw new ValidationError(data.error === 'unauthorized' ? 'טוקן שגוי — בדוק הגדרות' : data.error);
  return data;
}

async function bridgePost(cfg, body) {
  const res = await fetch(cfg.webAppUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, token: cfg.token || DEFAULT_TOKEN }),
    redirect: 'follow',
  });
  const data = await res.json();
  if (data.error) throw new ValidationError(data.error === 'unauthorized' ? 'טוקן שגוי — בדוק הגדרות' : data.error);
  return data;
}

export async function testSheetsConnection(patch) {
  const cfg = patch ? { ...(await getSheetsConfig()), ...patch } : await getSheetsConfig();
  if (!cfg.webAppUrl) throw new ValidationError('חסרה כתובת Web App');
  const data = await bridgeGet(cfg, 'ping');
  if (patch) await saveSheetsConfig({ ...patch, lastSyncLabel: data.spreadsheet || 'Google Sheets' });
  return data;
}

export async function pullProductionFromSheets() {
  const cfg = await getSheetsConfig();
  if (!cfg.webAppUrl) throw new ValidationError('Google Sheets לא מחובר');
  const data = await bridgeGet(cfg, 'pull');
  await saveSheetsConfig({ lastSyncAt: new Date().toISOString() });
  return data.rows || [];
}

export async function pullCatalogFromSheets() {
  const cfg = await getSheetsConfig();
  if (!cfg.webAppUrl) throw new ValidationError('Google Sheets לא מחובר');
  const data = await bridgeGet(cfg, 'catalog');
  return data.rows || [];
}

async function buildProductionExportRows() {
  const [categories, products, entries] = await Promise.all([
    getCategories(),
    getProducts(),
    db.productionEntries.orderBy('date').toArray(),
  ]);
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const prodMap = new Map(products.map((p) => [p.id, p]));
  return entries.map((e) => {
    const p = prodMap.get(e.productId);
    return {
      date: e.date,
      category: catMap.get(p?.categoryId) || '',
      product: p?.name || '',
      quantity: e.quantity || 0,
      price: p?.unitPrice ?? null,
    };
  });
}

async function buildCatalogExportRows() {
  const [categories, products] = await Promise.all([getCategories(), getProducts()]);
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  return products.filter((p) => p.active !== false).map((p) => ({
    category: catMap.get(p.categoryId) || '',
    product: p.name,
    price: p.unitPrice ?? 0,
  }));
}

export async function pushAllToSheets() {
  const cfg = await getSheetsConfig();
  if (!cfg.webAppUrl) throw new ValidationError('Google Sheets לא מחובר');
  const [prodRows, catalogRows] = await Promise.all([
    buildProductionExportRows(),
    buildCatalogExportRows(),
  ]);
  await bridgePost(cfg, { action: 'pushProduction', rows: prodRows });
  await bridgePost(cfg, { action: 'pushCatalog', rows: catalogRows });
  await saveSheetsConfig({ lastSyncAt: new Date().toISOString() });
  return { production: prodRows.length, catalog: catalogRows.length };
}

export async function pushReportToSheets({
  title, periodLabel, entries, categories, products, productMap, catMap, processLogs,
}) {
  const cfg = await getSheetsConfig();
  if (!cfg.webAppUrl) throw new ValidationError('Google Sheets לא מחובר');

  const { detailRows, summaryRows, totalQty, totalVal, productSummary } = computeReportRows(
    entries, categories, products, productMap, catMap
  );

  const blocks = [
    { lines: [[title], [periodLabel], ['']] },
    { lines: [['סיכום לפי קטגוריה', 'כמות', 'ערך (₪)'], ...summaryRows, [''], ['סה"כ יחידות', totalQty], ['סה"כ ערך (₪)', roundMoney(totalVal)]] },
    { lines: [[''], ['פירוט'], ['תאריך', 'קטגוריה', 'מוצר', 'כמות', 'ערך (₪)'], ...detailRows.map((r) => [r[0], r[1], r[2], r[3], roundMoney(r[4])])] },
  ];

  if (processLogs?.length) {
    blocks.push({
      lines: [
        [''],
        ['תיעוד הכנות'],
        ['תאריך', 'קטגוריה', 'הכנה', 'כמות', 'הערות'],
        ...processLogs.map((log) => [
          log.date,
          catMap.get(log.categoryId) || '',
          log.activity,
          log.quantity ?? '',
          log.notes || '',
        ]),
      ],
    });
  }

  await bridgePost(cfg, { action: 'pushReport', title, blocks });
  await saveSheetsConfig({ lastSyncAt: new Date().toISOString() });
  return cfg;
}

export function openGoogleSheet(config) {
  const url = config?.sheetUrl || (config?.sheetId ? sheetOpenUrl(config.sheetId) : null);
  if (!url) throw new ValidationError('לא הוגדר קישור לגיליון');
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function importProductionFromSheets() {
  const rows = await pullProductionFromSheets();
  if (!rows.length) throw new ValidationError('לא נמצאו רישומי ייצור בגיליון «ייצור»');
  return importProductionRows(rows);
}

export async function importCatalogFromSheets() {
  const rows = await pullCatalogFromSheets();
  if (!rows.length) throw new ValidationError('לא נמצאו מוצרים בגיליון «מוצרים»');
  return importCatalogRows(rows);
}

export function sheetsSetupInstructions() {
  return `הגדרה (פעם אחת):
1. פתח/צור Google Sheet
2. תוספים → Apps Script
3. הדבק את הקוד מ-scripts/google-sheets-bridge.gs
4. פריסה → אפליקציית אינטרנט → «כל מי שיש לו את הקישור»
5. העתק כאן את קישור הגיליון + כתובת Web App`;
}
