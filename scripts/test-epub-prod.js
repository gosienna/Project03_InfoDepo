#!/usr/bin/env node
/**
 * test-epub-prod.js
 * Runs the EPUB test suite against a production (or preview) deployment
 * using a headless Chromium browser via Playwright.
 *
 * Usage:
 *   node scripts/test-epub-prod.js [BASE_URL]
 *   npm run test:epub:prod [-- BASE_URL]
 *
 * BASE_URL defaults to the GitHub Pages deployment:
 *   https://gosienna.github.io/Project03_InfoDepo
 *
 * Examples:
 *   node scripts/test-epub-prod.js
 *   node scripts/test-epub-prod.js https://gosienna.github.io/Project03_InfoDepo
 *   node scripts/test-epub-prod.js http://localhost:4173   # vite preview
 */

import { chromium } from '@playwright/test';

const DEFAULT_BASE = 'https://gosienna.github.io/Project03_InfoDepo';
const baseUrl = (process.argv[2] || process.env.EPUB_TEST_URL || DEFAULT_BASE).replace(/\/$/, '');
const testUrl = `${baseUrl}/test_epub.html`;
const TIMEOUT_MS = 30000; // production may be slower than localhost

console.log('\n🧪  EPUB Viewer — Production Test');
console.log('─'.repeat(52));
console.log(`  Target: ${testUrl}`);
console.log('─'.repeat(52) + '\n');

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

// Navigate to the test page
try {
  await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
} catch {
  console.error(`\n❌  Could not reach ${testUrl}`);
  console.error('   Check that the site is deployed and the URL is correct.\n');
  await browser.close();
  process.exit(1);
}

// Wait for "All tests complete." in the log panel
try {
  await page.waitForFunction(
    () => {
      const log = document.getElementById('log');
      return log && log.innerText.includes('All tests complete');
    },
    { timeout: TIMEOUT_MS }
  );
} catch {
  // Grab whatever partial results are in the log before timing out
  const partial = await page.evaluate(() => document.getElementById('log')?.innerText || '');
  if (partial) {
    console.error('\n  Partial log output:');
    partial.split('\n').forEach((l) => console.error(`  ${l}`));
  }
  console.error(`\n⏱️   Timed out after ${TIMEOUT_MS / 1000}s — tests did not complete.\n`);
  await browser.close();
  process.exit(1);
}

// Also verify the status badge shows pass, not a spinner
const statusText = await page.evaluate(() => document.getElementById('status')?.textContent || '');
console.log(`\n  Status badge: "${statusText}"`);

await browser.close();

// Summary
const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;

console.log('\n' + '─'.repeat(52));
if (failed === 0 && passed > 0) {
  console.log(`\n✅  All ${passed} tests passed against ${baseUrl}\n`);
} else if (passed === 0) {
  console.log('\n❌  No test results captured — check the page loaded correctly.\n');
  process.exit(1);
} else {
  console.log(`\n❌  ${failed} failed, ${passed} passed.\n`);
  results.filter((r) => !r.passed).forEach((r) => console.log(`   ${r.text}`));
  console.log();
  process.exit(1);
}
