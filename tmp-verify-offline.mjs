import { readFileSync, existsSync } from 'fs';

const sw = readFileSync('sw.js', 'utf8');
const block = sw.match(/const PRECACHE = \[([\s\S]*?)\];/)?.[1] || '';
const paths = [...block.matchAll(/v\?\(\s*['"](\.\/[^'"]+)['"]\s*\)|['"](\.\/[^'"]+)['"]/g)]
  .map((m) => m[1] || m[2])
  .filter((p) => p && !p.endsWith('/'))
  .map((p) => p.replace(/^\.\//, ''));
const missing = [...new Set(paths)].filter((p) => !existsSync(p));
if (missing.length) {
  console.error('MISSING', missing.join(', '));
  process.exit(1);
}
console.log(`${new Set(paths).size} offline assets ok`);
