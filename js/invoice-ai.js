/**
 * חילוץ חשבונית: קודם API בשרת (Vercel), אחרת Gemini ישירות עם מפתח מקומי.
 */
import { getSetting, setSetting } from './db.js?v=547';
import { extractPackageKgFromName, guessPriceBasis } from './invoice-match.js?v=547';

export const INVOICE_AI_KEY_SETTING = 'invoiceAiKey';
export const PARSE_INVOICE_PATH = '/api/parse-invoice';

export async function getInvoiceAiKey() {
  const v = await getSetting(INVOICE_AI_KEY_SETTING);
  return String(v || '').trim();
}

export async function setInvoiceAiKey(key) {
  await setSetting(INVOICE_AI_KEY_SETTING, String(key || '').trim());
}

export function invoiceParsePrompt() {
  return `אתה מפענח חשבוניות ספקים בעברית למאפייה.
חלץ JSON בלבד, בלי markdown.
חשוב:
- כל ספק כותב אחרת: מחיר לק״ג / מחיר לאריזה / כמות בתוך שם החומר / עמודה נפרדת.
- אם כתוב «קמח 25 קג» אז packageWeightKg=25 והשם יכול להישאר «קמח» או השם המלא.
- priceBasis: per_kg אם המחיר לקילו, per_package אם מחיר לשק/קרטון/יחידה, per_unit אם מחיר ליחידה בודדת.
- unitPrice הוא המחיר לפי priceBasis (לא סכום השורה).
- אל תמציא שורות. אם לא בטוח — notes עם הספק.
- נסה לזהות את שם הספק מהלוגו/כותרת/ח.פ.
מבנה:
{
  "supplierName": "",
  "supplierVatId": "",
  "invoiceNumber": "",
  "invoiceDate": "YYYY-MM-DD",
  "currency": "ILS",
  "notes": "",
  "lines": [
    {
      "name": "",
      "sku": "",
      "quantity": 0,
      "unit": "",
      "packageWeightKg": null,
      "unitPrice": 0,
      "lineTotal": 0,
      "priceBasis": "per_kg",
      "synonymHint": "",
      "notes": ""
    }
  ]
}`;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('קריאת הקובץ נכשלה'));
    reader.readAsDataURL(file);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('תמונה לא תקינה'));
    img.src = url;
  });
}

export async function compressInvoiceFile(file, { maxEdge = 1600, quality = 0.72 } = {}) {
  const type = String(file?.type || '');
  if (type === 'application/pdf' || /\.pdf$/i.test(file?.name || '')) {
    const dataUrl = await readAsDataUrl(file);
    return { mimeType: 'application/pdf', dataUrl, name: file.name };
  }
  const dataUrl = await readAsDataUrl(file);
  try {
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL('image/jpeg', quality);
    return { mimeType: 'image/jpeg', dataUrl: out, name: file.name };
  } catch {
    return { mimeType: type || 'image/jpeg', dataUrl, name: file.name };
  }
}

function splitDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return { mimeType: 'image/jpeg', base64: '' };
  return { mimeType: m[1], base64: m[2] };
}

function normalizeParsedInvoice(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const lines = Array.isArray(src.lines) ? src.lines : [];
  return {
    supplierName: String(src.supplierName || '').trim(),
    supplierVatId: String(src.supplierVatId || '').trim(),
    invoiceNumber: String(src.invoiceNumber || '').trim(),
    invoiceDate: String(src.invoiceDate || '').trim(),
    currency: String(src.currency || 'ILS').trim() || 'ILS',
    notes: String(src.notes || '').trim(),
    lines: lines.map((line) => {
      const name = String(line?.name || '').trim();
      const packageWeightKg = Number(line?.packageWeightKg) > 0
        ? Number(line.packageWeightKg)
        : extractPackageKgFromName(name);
      const next = {
        name,
        sku: String(line?.sku || '').trim(),
        quantity: Number(line?.quantity) || 0,
        unit: String(line?.unit || '').trim(),
        packageWeightKg,
        unitPrice: Number(line?.unitPrice) || 0,
        lineTotal: Number(line?.lineTotal) || 0,
        priceBasis: guessPriceBasis({ ...line, name, packageWeightKg }),
        synonymHint: String(line?.synonymHint || '').trim(),
        notes: String(line?.notes || '').trim(),
      };
      return next;
    }).filter((line) => line.name),
  };
}

function parseModelJson(text) {
  const raw = String(text || '').trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('ה-AI לא החזיר חשבונית מובנית');
  return JSON.parse(body.slice(start, end + 1));
}

async function parseViaServer(parts, catalog) {
  const res = await fetch(PARSE_INVOICE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: parts.map((p) => ({ mimeType: p.mimeType, dataUrl: p.dataUrl, name: p.name, text: p.text || '' })),
      catalog,
    }),
  });
  if (res.status === 404 || res.status === 501) {
    const err = new Error('no-server');
    err.code = 'no-server';
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'פענוח החשבונית נכשל');
    err.code = data.code || 'server';
    throw err;
  }
  return normalizeParsedInvoice(data.invoice || data);
}

async function parseViaGemini(parts, catalog, apiKey) {
  const contents = [
    { text: invoiceParsePrompt() },
    { text: `קטלוג מקומי לעזרה בזיהוי (אל תמציא מזהים):\n${JSON.stringify(catalog).slice(0, 12000)}` },
  ];
  const inline = [];
  for (const part of parts) {
    if (part.text) {
      inline.push({ text: String(part.text).slice(0, 20000) });
      continue;
    }
    const { mimeType, base64 } = splitDataUrl(part.dataUrl);
    if (!base64) continue;
    if (mimeType === 'text/plain') {
      try { inline.push({ text: decodeURIComponent(escape(atob(base64))) }); } catch { /* skip */ }
      continue;
    }
    inline.push({ inline_data: { mime_type: mimeType, data: base64 } });
  }
  const body = {
    contents: [{ role: 'user', parts: [...contents, ...inline] }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || 'Gemini נכשל';
    throw new Error(msg);
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
  return normalizeParsedInvoice(parseModelJson(text));
}

export function catalogForAi({ suppliers = [], materials = [] } = {}) {
  return {
    suppliers: (suppliers || []).slice(0, 80).map((s) => ({ id: s.id, name: s.name })),
    materials: (materials || []).slice(0, 250).map((m) => ({
      id: m.id,
      name: m.name,
      sku: m.sku || '',
      synonyms: Array.isArray(m.synonyms) ? m.synonyms.slice(0, 4) : [],
      supplierId: m.supplierId || null,
      unit: m.unit || '',
      packageWeightGrams: m.packageWeightGrams || null,
      unitPrice: m.unitPrice || 0,
    })),
  };
}

export async function parseInvoiceFiles(files, { suppliers = [], materials = [] } = {}) {
  const list = [...(files || [])].filter(Boolean);
  if (!list.length) throw new Error('לא נבחר מסמך');
  const parts = [];
  for (const file of list.slice(0, 6)) {
    if (String(file.type || '') === 'text/plain' || /\.txt$/i.test(file.name || '')) {
      const text = await file.text();
      parts.push({ mimeType: 'text/plain', dataUrl: `data:text/plain;base64,${btoa(unescape(encodeURIComponent(text)))}`, name: file.name, text });
      continue;
    }
    parts.push(await compressInvoiceFile(file));
  }
  const catalog = catalogForAi({ suppliers, materials });
  try {
    return await parseViaServer(parts, catalog);
  } catch (err) {
    if (err?.code && err.code !== 'no-server' && err.code !== 'missing-key') throw err;
  }
  const key = await getInvoiceAiKey();
  if (!key) {
    const err = new Error('חסר מפתח AI. הוסף מפתח Gemini במסך הסריקה.');
    err.code = 'missing-key';
    throw err;
  }
  return parseViaGemini(parts, catalog, key);
}

export async function parseInvoiceText(text, { suppliers = [], materials = [] } = {}) {
  const blob = new Blob([String(text || '')], { type: 'text/plain' });
  const file = new File([blob], 'invoice.txt', { type: 'text/plain' });
  return parseInvoiceFiles([file], { suppliers, materials });
}
