// 測試執行器：載入所有 *.test.js，執行並回報。
import { getTests } from './harness.js';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter(f => f.endsWith('.test.js')).sort();
for (const f of files) await import(pathToFileURL(join(here, f)).href);

const tests = getTests();
let pass = 0, fail = 0;
const failures = [];
const t0 = Date.now();
for (const { name, fn } of tests) {
  try { await fn(); pass++; process.stdout.write('\x1b[32m.\x1b[0m'); }
  catch (e) { fail++; failures.push({ name, msg: e.message }); process.stdout.write('\x1b[31mF\x1b[0m'); }
}
const dt = Date.now() - t0;
console.log('\n');
if (failures.length) {
  console.log('\x1b[31m=== FAILURES ===\x1b[0m');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.msg}`);
  console.log('');
}
console.log(`\x1b[1m${pass}/${tests.length} passed\x1b[0m (${fail} failed) in ${dt}ms`);
process.exit(fail ? 1 : 0);
