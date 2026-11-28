/**
 * חילוץ חשבונית: קודם API בשרת (Vercel), אחרת Gemini ישירות עם מפתח מקומי.
 */
import { getSetting, setSetting } from './db.js?v=557';
import { extractPackageKgFromName, guessPriceBasis } from './invoice-match.js?v=557';

export const INVOICE_AI_KEY_SETTING = 'invoiceAiKey';
export const PARSE_INVOICE_PATH = '/api/parse-invoice';
export const GEMINI_INVOICE_MODEL = 'gemini-3.8-flash';
export const GEMINI_INVOICE_FALLBACK_MODELS = Object.freeze([
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
]);
export const GEMINI_INVOICE_TIMEOUT_MS = 22000;

export function geminiGenerateContentUrl(apiKey, { model = GEMINI_INVOICE_MODEL } = {}) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

export function isGeminiCapacityError(raw, status) {
  const code = Number(status);
  if (code === 503 || code === 429) return true;
  return /high demand|unavailable|overloaded|resource exhausted|rate limit|quota|try again later|UNAVAILABLE/i.test(String(raw || ''));
}

export function shouldTryNextGeminiModel(raw, status) {
  const code = Number(status);
  if (isGeminiCapacityError(raw, status)) return true;
  if (code === 404) return true;
  return /no longer available|not found|NOT_FOUND/i.test(String(raw || ''));
}

export function formatGeminiInvoiceError(raw, status) {
  const text = String(raw || '').trim();
  if (/api key not valid|invalid api key|api_key_invalid/i.test(text)) {
    return 'מפתח ה-AI לא תקין. צרו מפתח חדש ב-Google AI Studio.';
  }
  if (isGeminiCapacityError(text, status)) {
    return 'הסריקה עמוסה אצל Google כרגע. נסו שוב בעוד כמה שניות.';
  }
  if (/no longer available|not found|NOT_FOUND/i.test(text)) {
    return 'מודל הסריקה התחלף. עדכנו את האפליקציה ונסו שוב.';
  }
  return text || 'Gemini נכשל';
}

function geminiInvoiceError(message, { status, retryable } = {}) {
  const err = new Error(message);
  err.status = status;
  err.retryable = !!retryable;
  err.code = retryable ? 'capacity' : 'gemini';
  return err;
}

export async function generateGeminiInvoiceJson(apiKey, requestBody, {
  fetchImpl,
  models = GEMINI_INVOICE_FALLBACK_MODELS,
  onStatus,
  timeoutMs = GEMINI_INVOICE_TIMEOUT_MS,
} = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('Gemini נכשל');
  let lastErr = null;
  const list = [...(models || [])].filter(Boolean);
  for (let i = 0; i < list.length; i++) {
    const model = list[i];
    if (i > 0) onStatus?.('המודל עמוס, מנסה מודל חלופי...');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(geminiGenerateContentUrl(apiKey, { model }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const raw = data?.error?.message || '';
        lastErr = geminiInvoiceError(formatGeminiInvoiceError(raw, res.status), {
          status: res.status,
          retryable: shouldTryNextGeminiModel(raw, res.status),
        });
        if (lastErr.retryable) continue;
        throw lastErr;
      }
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
      if (!String(text).trim()) {
        lastErr = geminiInvoiceError('ה-AI לא החזיר חשבונית מובנית', { retryable: true });
        continue;
      }
      try {
        return parseModelJson(text);
      } catch (parseErr) {
        lastErr = geminiInvoiceError(parseErr.message || 'ה-AI לא החזיר חשבונית מובנית', { retryable: true });
      }
    } catch (err) {
      if (err?.retryable) {
        lastErr = err;
        continue;
      }
      if (err?.name === 'AbortError' || /timeout/i.test(err?.message || '')) {
        lastErr = geminiInvoiceError('הסריקה עמוסה אצל Google כרגע. נסו שוב בעוד כמה שניות.', { retryable: true });
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || geminiInvoiceError('Gemini נכשל');
}

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
    const err = new Error(formatGeminiInvoiceError(data.error || 'פענוח החשבונית נכשל', res.status));
    err.code = data.code || (isGeminiCapacityError(data.error, res.status) ? 'capacity' : 'server');
    err.retryable = err.code === 'capacity' || err.code === 'missing-key' || err.code === 'no-server';
    throw err;
  }
  return normalizeParsedInvoice(data.invoice || data);
}

async function parseViaGemini(parts, catalog, apiKey, options = {}) {
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
    generationConfig: { responseMimeType: 'application/json' },
  };
  const parsed = await generateGeminiInvoiceJson(apiKey, body, options);
  return normalizeParsedInvoice(parsed);
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

export async function parseInvoiceFiles(files, { suppliers = [], materials = [], onStatus } = {}) {
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
  let serverErr = null;
  try {
    return await parseViaServer(parts, catalog);
  } catch (err) {
    serverErr = err;
  }
  const key = await getInvoiceAiKey();
  if (!key) {
    if (serverErr && serverErr.code !== 'no-server' && serverErr.code !== 'missing-key') throw serverErr;
    const err = new Error('חסר מפתח AI. הוסף מפתח Gemini במסך הסריקה.');
    err.code = 'missing-key';
    throw err;
  }
  if (serverErr && serverErr.code !== 'no-server' && serverErr.code !== 'missing-key') {
    onStatus?.('השרת עמוס, מנסה סריקה מהמכשיר...');
  }
  return parseViaGemini(parts, catalog, key, { onStatus });
}

export function materialGroupPrompt(items) {
  const lines = (items || []).map((it) => (
    `${it.id}\t${it.name || ''}\t${it.sku || ''}\t${it.supplier || ''}\t${it.category || ''}`
  )).join('\n');
  return `קובץ חומרי גלם של מאפייה. כל שורה: id, שם, מק״ט, ספק, קטגוריה.
החזר JSON בלבד: {"groups":[{"ids":[1,2],"reason":"למה זה אותו חומר"}]}
כלול רק קבוצות שאתה בטוח שהן אותו חומר גלם.
אל תאחד מוצרים שונים שחולקים מילה: סוכר מול אבקת סוכר, חלב מול חלב מרוכז, קמח מול קמח תופח, חמאה מול מרגרינה.
קבוצה צריכה לפחות שני id מהרשימה. אל תמציא id.

${lines}`;
}

export function parseMaterialGroupResponse(raw, allowedIds) {
  const text = String(raw || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    return [];
  }
  const allow = allowedIds ? new Set([...allowedIds].map((id) => Number(id))) : null;
  const groups = Array.isArray(parsed?.groups) ? parsed.groups : [];
  const out = [];
  const used = new Set();
  for (const group of groups) {
    const ids = [...new Set((group?.ids || []).map((id) => Number(id)).filter((id) => (
      id && (!allow || allow.has(id)) && !used.has(id)
    )))];
    if (ids.length < 2) continue;
    ids.forEach((id) => used.add(id));
    out.push({ ids, reason: String(group?.reason || '').trim().slice(0, 180) });
  }
  return out;
}

export async function suggestMaterialGroups(items, { apiKey, fetchImpl } = {}) {
  const list = (items || []).slice(0, 80).filter((it) => it && it.id && it.name);
  if (list.length < 2) return [];
  if (!apiKey) throw new Error('חסר מפתח AI. הוסף מפתח Gemini במסך הסריקה.');
  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: materialGroupPrompt(list) }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };
  const data = await generateGeminiInvoiceJson(apiKey, requestBody, { fetchImpl });
  return parseMaterialGroupResponse(JSON.stringify(data || {}), list.map((it) => it.id));
}

export async function parseInvoiceText(text, { suppliers = [], materials = [] } = {}) {
  const blob = new Blob([String(text || '')], { type: 'text/plain' });
  const file = new File([blob], 'invoice.txt', { type: 'text/plain' });
  return parseInvoiceFiles([file], { suppliers, materials });
}
