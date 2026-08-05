import { chromium } from 'playwright-core';
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';

const root = fileURLToPath(new URL('.', import.meta.url));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = normalize(join(root, urlPath === '/' ? 'index.html' : urlPath));
  if (!filePath.startsWith(root)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': mime[extname(filePath)] || 'application/octet-stream' });
  res.end(readFileSync(filePath));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const browser = await chromium.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
await page.goto(`http://127.0.0.1:${port}/tests/index.html`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!document.querySelector('#results .pass, #results .fail'), { timeout: 60000 });
const text = await page.locator('#results').innerText();
console.log(text);
const m = text.match(/(\d+)\/(\d+) עברו/);
const ok = m && Number(m[1]) === Number(m[2]) && Number(m[2]) > 0 && !text.includes('נכשלו');
await browser.close();
server.close();
process.exit(ok ? 0 : 1);
