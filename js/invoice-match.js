/**
 * התאמת שורות חשבונית לחומרי גלם וספקים קיימים — בלי ליצור כפילויות.
 * ה-AI מחלץ טקסט; ההחלטה הסופית נשארת כאן + אישור המשתמש.
 */

function stripNiqqud(s) {
  return String(s || '').replace(/[\u0591-\u05C7]/g, '');
}

export function looseInvoiceName(name) {
  return stripNiqqud(
    String(name || '').replace(/[־\-_]/g, ' '),
  )
    .replace(/[׳״"'‘’“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('he');
}

export function normalizeSku(sku) {
  return String(sku || '').replace(/[\s\-_.]/g, '').toLocaleLowerCase('he');
}

function tokensOf(loose) {
  return loose.split(' ').filter((t) => t.length >= 2);
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

export function guessPriceBasis(line = {}) {
  if (line.priceBasis === 'per_kg' || line.priceBasis === 'per_package' || line.priceBasis === 'per_unit') {
    return line.priceBasis;
  }
  const unit = looseInvoiceName(line.unit);
  const name = looseInvoiceName(line.name);
  if (/קג|קילו|kg/.test(unit) || /לקג|ל קג|\/קג/.test(name)) return 'per_kg';
  if (/קרטון|שק|יח|חבילה|ארגז/.test(unit)) return 'per_package';
  const packKg = Number(line.packageWeightKg);
  const price = Number(line.unitPrice);
  if (packKg > 0 && price > 0 && price / packKg < price * 0.6) return 'per_package';
  return 'per_kg';
}

export function extractPackageKgFromName(name) {
  const s = String(name || '');
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(?:ק["״']?\s*ג|קילו|kg)/i);
  if (!m) return null;
  const n = Number(String(m[1]).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function invoiceComparablePrices(line = {}, material = {}) {
  const basis = guessPriceBasis(line);
  const packKg = Number(line.packageWeightKg) > 0
    ? Number(line.packageWeightKg)
    : (extractPackageKgFromName(line.name)
      || (Number(material.packageWeightGrams) > 0 ? Number(material.packageWeightGrams) / 1000 : null));
  const unitPrice = Number(line.unitPrice) || 0;
  let invoicePackage = null;
  let invoicePerKg = null;
  if (basis === 'per_kg') {
    invoicePerKg = unitPrice || null;
    if (packKg && unitPrice) invoicePackage = roundMoney(unitPrice * packKg);
  } else {
    invoicePackage = unitPrice || null;
    if (packKg && unitPrice) invoicePerKg = roundMoney(unitPrice / packKg);
  }
  const storedPackage = Number(material.unitPrice) > 0 ? Number(material.unitPrice) : null;
  const storedGrams = Number(material.packageWeightGrams);
  const storedPerKg = storedPackage && storedGrams
    ? roundMoney(storedPackage / (storedGrams / 1000))
    : null;
  return { basis, packKg, invoicePackage, invoicePerKg, storedPackage, storedPerKg };
}

export function compareInvoicePrice(line, material, { pct = 0.02, abs = 0.1 } = {}) {
  const c = invoiceComparablePrices(line, material);
  const pairs = [];
  if (c.invoicePerKg && c.storedPerKg) pairs.push([c.invoicePerKg, c.storedPerKg, 'per_kg']);
  if (c.invoicePackage && c.storedPackage) pairs.push([c.invoicePackage, c.storedPackage, 'package']);
  if (!pairs.length) {
    return { ...c, status: 'unknown', delta: null, direction: null };
  }
  const [invoice, stored, via] = pairs[0];
  const delta = roundMoney(invoice - stored);
  const tol = Math.max(abs, Math.abs(stored) * pct);
  if (Math.abs(delta) <= tol) return { ...c, status: 'match', delta: 0, direction: null, via };
  return {
    ...c,
    status: 'mismatch',
    delta,
    direction: delta > 0 ? 'up' : 'down',
    via,
  };
}

function materialSearchBlob(material) {
  const syn = Array.isArray(material?.synonyms) ? material.synonyms.join(' ') : '';
  return looseInvoiceName([material?.name, syn, material?.sku].filter(Boolean).join(' '));
}

export function scoreMaterialMatch(line, material) {
  if (!line || !material) return { score: 0, reason: '' };
  const lineSku = normalizeSku(line.sku);
  const matSku = normalizeSku(material.sku);
  if (lineSku && matSku && lineSku === matSku) return { score: 100, reason: 'מק״ט זהה' };

  const lineName = looseInvoiceName(line.name);
  const matName = looseInvoiceName(material.name);
  if (lineName && matName && lineName === matName) return { score: 96, reason: 'שם זהה' };

  const synonyms = Array.isArray(material.synonyms) ? material.synonyms : [];
  for (const syn of synonyms) {
    if (lineName && looseInvoiceName(syn) === lineName) return { score: 92, reason: 'מילה נרדפת' };
  }

  if (lineSku && matSku && (lineSku.includes(matSku) || matSku.includes(lineSku))) {
    return { score: 80, reason: 'מק״ט דומה' };
  }

  if (lineName && matName && (lineName.includes(matName) || matName.includes(lineName))) {
    return { score: 78, reason: 'השם כלול' };
  }

  const aTok = new Set(tokensOf(lineName));
  const bTok = new Set(tokensOf(matName));
  if (aTok.size && bTok.size) {
    const overlap = [...aTok].filter((t) => bTok.has(t));
    const union = new Set([...aTok, ...bTok]);
    const ratio = overlap.length / union.size;
    if (ratio >= 0.5) return { score: Math.round(55 + ratio * 30), reason: 'מילים חופפות' };
  }

  if (lineName && matName && Math.max(lineName.length, matName.length) <= 18) {
    const ratio = 1 - levenshtein(lineName, matName) / Math.max(lineName.length, matName.length);
    if (ratio >= 0.72) return { score: Math.round(50 + ratio * 30), reason: 'שם דומה' };
  }

  const blob = materialSearchBlob(material);
  if (lineName && blob.includes(lineName)) return { score: 45, reason: 'מופיע בפרופיל' };
  return { score: 0, reason: '' };
}

export function suggestMaterialMatches(line, materials = [], { limit = 5, minScore = 45 } = {}) {
  return (materials || [])
    .map((material) => {
      const hit = scoreMaterialMatch(line, material);
      return { material, score: hit.score, reason: hit.reason };
    })
    .filter((row) => row.score >= minScore)
    .sort((a, b) => b.score - a.score || String(a.material.name).localeCompare(String(b.material.name), 'he'))
    .slice(0, limit);
}

export function suggestSupplierMatches(name, suppliers = [], { limit = 5 } = {}) {
  const key = looseInvoiceName(name);
  if (!key) return [];
  return (suppliers || [])
    .map((supplier) => {
      const n = looseInvoiceName(supplier.name);
      let score = 0;
      let reason = '';
      if (n === key) { score = 100; reason = 'שם זהה'; }
      else if (n && (n.includes(key) || key.includes(n))) { score = 80; reason = 'שם כלול'; }
      else {
        const aTok = new Set(tokensOf(key));
        const bTok = new Set(tokensOf(n));
        const overlap = [...aTok].filter((t) => bTok.has(t));
        if (overlap.length) {
          score = Math.min(75, overlap.length * 25);
          reason = 'מילים חופפות';
        }
      }
      return { supplier, score, reason };
    })
    .filter((row) => row.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function planMaterialUpgrade(material, line) {
  const patch = {};
  const sku = String(line?.sku || '').trim();
  if (sku && !String(material?.sku || '').trim()) patch.sku = sku;

  const packKg = Number(line?.packageWeightKg) > 0
    ? Number(line.packageWeightKg)
    : extractPackageKgFromName(line?.name);
  if (packKg && !(Number(material?.packageWeightGrams) > 0)) {
    patch.packageWeightGrams = Math.round(packKg * 1000);
  }

  const invoiceName = String(line?.name || '').trim();
  if (invoiceName && looseInvoiceName(invoiceName) !== looseInvoiceName(material?.name)) {
    const syn = Array.isArray(material?.synonyms) ? [...material.synonyms] : [];
    if (!syn.some((s) => looseInvoiceName(s) === looseInvoiceName(invoiceName))) {
      syn.push(invoiceName);
      patch.synonyms = syn;
    }
  }

  if (line?.unit && !String(material?.unit || '').trim()) patch.unit = String(line.unit).trim().slice(0, 20);
  return patch;
}

export function isFirstMaterialScan(material) {
  return !material?.invoiceScannedAt;
}

export function buildReviewedLine({ line, material = null, action = 'skip', supplierId = null }) {
  const price = material ? compareInvoicePrice(line, material) : { status: 'unknown' };
  return {
    ...line,
    action,
    materialId: material?.id ?? null,
    supplierId,
    price,
    upgrade: material && action !== 'skip' ? planMaterialUpgrade(material, line) : {},
    firstScan: material ? isFirstMaterialScan(material) : true,
  };
}
