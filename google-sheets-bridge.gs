/**
 * מעקב יצור — גשר Google Sheets
 *
 * התקנה (פעם אחת):
 * 1. פתח את הגיליון שלך ב-Google Sheets
 * 2. תוספים → Apps Script
 * 3. הדבק את הקוד הזה ושמור
 * 4. פריסה → פריסה חדשה → אפליקציית אינטרנט
 *    · בצע כ: אני
 *    · מי יכול לגשת: כל מי שיש לו את הקישור
 * 5. העתק את כתובת ה-Web App לאפליקציה
 *
 * גיליונות: ייצור · מוצרים · דוח (נוצרים אוטומטית)
 */
var BRIDGE_TOKEN = 'yitzur2024'; // אפשר לשנות — ולהזין גם באפליקציה

var PROD_SHEET = 'ייצור';
var CATALOG_SHEET = 'מוצרים';
var REPORT_SHEET = 'דוח';

function doGet(e) {
  try {
    if (!checkToken_(e && e.parameter && e.parameter.token)) {
      return json_({ error: 'unauthorized' });
    }
    var action = (e.parameter.action || '').toLowerCase();
    if (action === 'ping') {
      return json_({ ok: true, spreadsheet: SpreadsheetApp.getActiveSpreadsheet().getName() });
    }
    if (action === 'pull') {
      return json_({ ok: true, rows: readProductionRows_() });
    }
    if (action === 'catalog') {
      return json_({ ok: true, rows: readCatalogRows_() });
    }
    return json_({ error: 'unknown action' });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = {};
    if (e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    if (!checkToken_(body.token)) {
      return json_({ error: 'unauthorized' });
    }
    var action = (body.action || '').toLowerCase();
    if (action === 'pushproduction') {
      writeProductionRows_(body.rows || []);
      return json_({ ok: true, written: (body.rows || []).length });
    }
    if (action === 'pushreport') {
      writeReport_(body);
      return json_({ ok: true });
    }
    if (action === 'pushcatalog') {
      writeCatalogRows_(body.rows || []);
      return json_({ ok: true, written: (body.rows || []).length });
    }
    return json_({ error: 'unknown action' });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

function checkToken_(token) {
  if (!BRIDGE_TOKEN) return true;
  return String(token || '') === String(BRIDGE_TOKEN);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSheet_(name, headers) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
  }
  if (headers && headers.length) {
    var first = sh.getRange(1, 1, 1, headers.length).getValues()[0];
    var empty = first.every(function (c) { return !c; });
    if (empty) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
  }
  return sh;
}

function readProductionRows_() {
  var sh = ensureSheet_(PROD_SHEET, ['תאריך', 'קטגוריה', 'מוצר', 'כמות', 'מחיר']);
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0].map(normalizeHeader_);
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = mapRow_(headers, data[i]);
    if (row.date && row.product && row.quantity > 0) rows.push(row);
  }
  return rows;
}

function readCatalogRows_() {
  var sh = ensureSheet_(CATALOG_SHEET, ['קטגוריה', 'מוצר', 'מחיר']);
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0].map(normalizeHeader_);
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = mapRow_(headers, data[i]);
    if (row.category && row.product) rows.push(row);
  }
  return rows;
}

function writeProductionRows_(rows) {
  var sh = ensureSheet_(PROD_SHEET, ['תאריך', 'קטגוריה', 'מוצר', 'כמות', 'מחיר']);
  var values = [['תאריך', 'קטגוריה', 'מוצר', 'כמות', 'מחיר']];
  rows.forEach(function (r) {
    values.push([
      r.date || '',
      r.category || '',
      r.product || '',
      r.quantity || 0,
      r.price != null ? r.price : '',
    ]);
  });
  sh.clearContents();
  sh.getRange(1, 1, values.length, 5).setValues(values);
  sh.setFrozenRows(1);
}

function writeCatalogRows_(rows) {
  var sh = ensureSheet_(CATALOG_SHEET, ['קטגוריה', 'מוצר', 'מחיר']);
  var values = [['קטגוריה', 'מוצר', 'מחיר']];
  rows.forEach(function (r) {
    values.push([r.category || '', r.product || '', r.price != null ? r.price : '']);
  });
  sh.clearContents();
  sh.getRange(1, 1, values.length, 3).setValues(values);
  sh.setFrozenRows(1);
}

function writeReport_(body) {
  var sh = ensureSheet_(REPORT_SHEET, []);
  sh.clearContents();
  var values = [];
  (body.blocks || []).forEach(function (block) {
    (block.lines || []).forEach(function (line) {
      if (Array.isArray(line)) values.push(line);
      else values.push([String(line)]);
    });
    values.push(['']);
  });
  if (!values.length) values.push(['(ריק)']);
  var cols = Math.max.apply(null, values.map(function (r) { return r.length; }));
  sh.getRange(1, 1, values.length, cols).setValues(
    values.map(function (r) {
      while (r.length < cols) r.push('');
      return r;
    })
  );
  if (body.title) {
    sh.getRange(1, 1).setFontWeight('bold').setFontSize(12);
  }
}

function normalizeHeader_(h) {
  var v = String(h || '').trim().toLowerCase();
  if (v.indexOf('תאריך') >= 0 || v === 'date') return 'date';
  if (v.indexOf('קטגור') >= 0 || v === 'category') return 'category';
  if (v.indexOf('מוצר') >= 0 || v.indexOf('סוג') >= 0 || v === 'product') return 'product';
  if (v.indexOf('כמות') >= 0 || v.indexOf('יח') >= 0 || v === 'qty' || v === 'quantity') return 'quantity';
  if (v.indexOf('מחיר') >= 0 || v === 'price') return 'price';
  return v;
}

function mapRow_(headers, cells) {
  var row = { date: '', category: '', product: '', quantity: 0, price: null };
  for (var i = 0; i < headers.length; i++) {
    var key = headers[i];
    var val = cells[i];
    if (key === 'date') row.date = formatDate_(val);
    else if (key === 'category') row.category = String(val || '').trim();
    else if (key === 'product') row.product = String(val || '').trim();
    else if (key === 'quantity') row.quantity = Number(val) || 0;
    else if (key === 'price') row.price = val === '' || val == null ? null : Number(val);
  }
  return row;
}

function formatDate_(val) {
  if (val instanceof Date && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(val || '').trim();
  var m = s.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})$/);
  if (m) {
    var y = m[3].length === 2 ? '20' + m[3] : m[3];
    return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s;
}
