'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const TESTS = ['test-core.js', 'test-extract.js', 'test-history.js', 'test-server.js', 'test-userscript.js'];
const results = [];

for (const file of TESTS) {
  console.log(`\n===== ${file} =====`);
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..')
  });
  results.push({ file, code: r.status, ms: Date.now() - started });
}

console.log('\n===== 汇总 =====');
let failed = 0;
for (const r of results) {
  const ok = r.code === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.file}  ${r.ms}ms`);
}
process.exit(failed ? 1 : 0);
