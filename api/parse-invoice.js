/**
 * Vercel serverless: פענוח חשבונית עם Gemini / OpenAI.
 * מפתח: GEMINI_API_KEY או OPENAI_API_KEY בהגדרות הפרויקט ב-Vercel.
 */

const GEMINI_INVOICE_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
];
const GEMINI_TIMEOUT_MS = 12000;

const PROMPT = `אתה מפענח חשבוניות ספקים בעברית למאפייה.
חלץ JSON בלבד, בלי markdown.
חשוב:
- כל ספק כותב אחרת: מחיר לק״ג / מחיר לאריזה / כמות בתוך שם החומר / עמודה נפרדת.
- אם כתוב «קמח 25 קג» אז packageWeightKg=25.
- priceBasis: per_kg | per_package | per_unit.
- unitPrice לפי priceBasis, לא סכום השורה.
- אל תמציא שורות.
מבנה:
{"supplierName":"","supplierVatId":"","invoiceNumber":"","invoiceDate":"YYYY-MM-DD","currency":"ILS","notes":"","lines":[{"name":"","sku":"","quantity":0,"unit":"","packageWeightKg":null,"unitPrice":0,"lineTotal":0,"priceBasis":"per_kg","synonymHint":"","notes":""}]}`;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(body));
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

function splitDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], base64: m[2] };
}

function isCapacityError(raw, status) {
  const code = Number(status);
  if (code === 503 || code === 429) return true;
  return /high demand|unavailable|overloaded|resource exhausted|rate limit|quota|try again later|UNAVAILABLE|no longer available|not found|NOT_FOUND/i.test(String(raw || ''));
}

function hebrewGeminiError(raw, status) {
  const text = String(raw || '').trim();
  if (/api key not valid|invalid api key|api_key_invalid/i.test(text)) {
    return 'מפתח ה-AI לא תקין. צרו מפתח חדש ב-Google AI Studio.';
  }
  if (isCapacityError(text, status)) {
    return 'הסריקה עמוסה אצל Google כרגע. נסו שוב בעוד כמה שניות.';
  }
  return text || 'Gemini נכשל';
}

async function fetchGeminiModel(apiKey, model, parts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
        signal: ctrl.signal,
      },
    );
    const data = await res.json().catch(() => ({}));
    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}

async function parseGemini(files, catalog, apiKey) {
  const parts = [
    { text: PROMPT },
    { text: `קטלוג מקומי לעזרה:\n${JSON.stringify(catalog || {}).slice(0, 12000)}` },
  ];
  for (const file of files || []) {
    if (file?.text) {
      parts.push({ text: String(file.text).slice(0, 20000) });
      continue;
    }
    const split = splitDataUrl(file.dataUrl);
    if (!split) continue;
    if (split.mimeType === 'text/plain') {
      try {
        parts.push({ text: Buffer.from(split.base64, 'base64').toString('utf8').slice(0, 20000) });
      } catch { /* skip */ }
      continue;
    }
    parts.push({ inline_data: { mime_type: split.mimeType, data: split.base64 } });
  }
  let lastErr = null;
  for (const model of GEMINI_INVOICE_MODELS) {
    try {
      const { res, data } = await fetchGeminiModel(apiKey, model, parts);
      if (!res.ok) {
        const raw = data?.error?.message || '';
        lastErr = new Error(hebrewGeminiError(raw, res.status));
        lastErr.code = isCapacityError(raw, res.status) ? 'capacity' : 'gemini';
        if (lastErr.code === 'capacity' || res.status === 404) continue;
        throw lastErr;
      }
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
      try {
        return parseModelJson(text);
      } catch (parseErr) {
        lastErr = parseErr;
        continue;
      }
    } catch (err) {
      if (err?.code === 'capacity' || err?.name === 'AbortError' || /timeout/i.test(err?.message || '')) {
        lastErr = err.code === 'capacity'
          ? err
          : new Error('הסריקה עמוסה אצל Google כרגע. נסו שוב בעוד כמה שניות.');
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('הסריקה עמוסה אצל Google כרגע. נסו שוב בעוד כמה שניות.');
}

async function parseOpenAi(files, catalog, apiKey) {
  const content = [
    { type: 'text', text: PROMPT },
    { type: 'text', text: `קטלוג מקומי לעזרה:\n${JSON.stringify(catalog || {}).slice(0, 12000)}` },
  ];
  for (const file of files || []) {
    if (!file?.dataUrl) continue;
    if (String(file.mimeType || '').includes('pdf')) {
      content.push({ type: 'text', text: `קובץ PDF: ${file.name || ''}` });
      continue;
    }
    content.push({ type: 'image_url', image_url: { url: file.dataUrl } });
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'OpenAI נכשל');
  return parseModelJson(data?.choices?.[0]?.message?.content || '');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    json(res, 204, {});
    return;
  }
  if (req.method !== 'POST') {
    json(res, 405, { error: 'POST only' });
    return;
  }
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  const openAiKey = process.env.OPENAI_API_KEY || '';
  if (!geminiKey && !openAiKey) {
    json(res, 501, { error: 'חסר מפתח AI בשרת', code: 'missing-key' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const files = Array.isArray(body.files) ? body.files.slice(0, 6) : [];
    if (!files.length) {
      json(res, 400, { error: 'לא נשלח מסמך' });
      return;
    }
    const invoice = geminiKey
      ? await parseGemini(files, body.catalog, geminiKey)
      : await parseOpenAi(files, body.catalog, openAiKey);
    json(res, 200, { invoice, source: geminiKey ? 'gemini' : 'openai' });
  } catch (err) {
    json(res, 500, {
      error: err.message || 'פענוח נכשל',
      code: err.code || 'server',
    });
  }
}
