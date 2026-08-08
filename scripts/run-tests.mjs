#!/usr/bin/env node
// מריץ tests/index.html (יחידה) ו-tests/integration.html (Dexie/IndexedDB אמיתי)
// בכרום headless מקומי (puppeteer-core + Chrome המערכת) ומדפיס תוצאות.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 8791);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found: ' + urlPath);
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome-stable',
    '/usr/local/bin/google-chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('לא נמצא Chrome/Chromium מקומי. הגדר CHROME_PATH.');
}

async function runSuite(browser, urlPath, label) {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (msg) => logs.push(`[console] ${msg.text()}`));
  page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));
  await page.goto(`http://127.0.0.1:${PORT}${urlPath}`, { waitUntil: 'load' });
  const summary = await page.waitForFunction('window.__TEST_SUMMARY__', { timeout: 30000 })
    .then((h) => h.jsonValue())
    .catch(() => null);
  await page.close();
  console.log(`\n=== ${label} (${urlPath}) ===`);
  if (!summary) {
    console.log('⚠ לא התקבלה תוצאה (timeout) — לוגים:');
    logs.forEach((l) => console.log(l));
    return { passed: 0, failed: 1, total: 1, failures: [{ name: label, message: 'timeout' }] };
  }
  console.log(`${summary.passed}/${summary.total} עברו${summary.failed ? ` · ${summary.failed} נכשלו` : ''}`);
  for (const f of summary.failures || []) {
    console.log(`  ✗ ${f.name}: ${f.message}`);
  }
  if (summary.failed) logs.forEach((l) => console.log(l));
  return summary;
}

async function main() {
  const puppeteer = await import('puppeteer-core');
  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const unit = await runSuite(browser, '/tests/index.html', 'בדיקות יחידה');
    const integration = await runSuite(browser, '/tests/integration.html', 'בדיקות אינטגרציה');
    const totalFailed = (unit.failed || 0) + (integration.failed || 0);
    console.log(`\n${totalFailed ? '❌' : '✓'} סה"כ נכשלו: ${totalFailed}`);
    process.exitCode = totalFailed ? 1 : 0;
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
