#!/usr/bin/env node
/**
 * test-txt-browser.js
 * Runs test_txt.html in headless Chromium via Playwright,
 * captures all console output, and reports pass/fail to the terminal.
 * Run: npm run test:txt:headless
 * Requires the Vite dev server to be running on port 3001 (npm run dev).
 */

import { chromium } from '@playwright/test';

const URL = 'http://localhost:3001/test_txt.html';
const TIMEOUT_MS = 15000;

console.log('\n🧪  TXT Viewer — Headless Browser Test');
console.log('─'.repeat(48));
console.log(`  URL: ${URL}`);
console.log('─'.repeat(48) + '\n');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const results = [];

page.on('console', (msg) => {
  const text = msg.text();
  const type = msg.type();

  if (type === 'error') {
    process.stderr.write(`  [browser:error] ${text}\n`);
  } else {
    process.stdout.write(`  [browser] ${text}\n`);
  }

  if (text.startsWith('✅') || text.startsWith('❌')) {
    results.push({ passed: text.startsWith('✅'), text });
  }
});

page.on('pageerror', (err) => {
  process.stderr.write(`  [page error] ${err.message}\n`);
});

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
} catch {
  console.error(`\n❌  Could not reach ${URL}`);
  console.error('   Make sure the Vite dev server is running: npm run dev\n');
  await browser.close();
  process.exit(1);
}

try {
  await page.waitForFunction(
    () => {
      const log = document.getElementById('log');
      return log && log.innerText.includes('All tests complete');
    },
    { timeout: TIMEOUT_MS }
  );
} catch {
  console.error(`\n⏱️   Timed out after ${TIMEOUT_MS / 1000}s waiting for tests to complete.\n`);
  await browser.close();
  process.exit(1);
}

await browser.close();

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

console.log('\n' + '─'.repeat(48));
if (failed === 0) {
  console.log(`\n✅  All ${passed} tests passed.\n`);
} else {
  console.log(`\n❌  ${failed} failed, ${passed} passed.\n`);
  results.filter(r => !r.passed).forEach(r => console.log(`   ${r.text}`));
  console.log();
}

process.exit(failed > 0 ? 1 : 0);
