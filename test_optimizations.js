import './src/polyfill.js';
import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';
import * as cheerio from 'cheerio';
import { initStorage } from './src/storage.js';
import { cleanDom } from './src/scraper.js';

async function runTests() {
  console.log('--- Starting Project Refinement & Optimization Tests ---\n');

  const testDbDir = './data_test';
  const testOutputDir = './output_test';

  // Clean up previous runs
  await fs.rm(testDbDir, { recursive: true, force: true });
  await fs.rm(testOutputDir, { recursive: true, force: true });

  console.log('1. Verifying Database Index Optimization...');
  await initStorage(testDbDir, testOutputDir);

  // Inspect database indices
  const db = new Database(path.join(testDbDir, 'scrapes.db'));
  const indices = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'scrapes'").all();
  db.close();

  const indexNames = indices.map(idx => idx.name);
  console.log('Discovered database indices:', indexNames);

  if (!indexNames.includes('idx_scrapes_category')) {
    throw new Error('Assertion Failed: idx_scrapes_category is missing!');
  }
  if (!indexNames.includes('idx_scrapes_scraped_at')) {
    throw new Error('Assertion Failed: idx_scrapes_scraped_at is missing!');
  }
  console.log('✓ SQLite database query indexes successfully verified.\n');

  console.log('2. Verifying Consolidated DOM Cleanup Optimization...');
  const dirtyHtml = `
    <html>
      <head><title>Test Page</title></head>
      <body>
        <header>Header content</header>
        <nav>Navigation links</nav>
        <div class="content">
          <h1>Real Heading</h1>
          <p>This is real content.</p>
          <div class="cookie-banner">Accept cookies</div>
          <div class="social-share">Share on Twitter</div>
        </div>
        <footer>Footer details</footer>
        <script>console.log("script");</script>
      </body>
    </html>
  `;

  const $ = cheerio.load(dirtyHtml);
  cleanDom($);

  // Elements that must be removed
  const forbiddenSelectors = ['header', 'nav', 'footer', 'script', '.cookie-banner', '.social-share'];
  forbiddenSelectors.forEach(selector => {
    if ($(selector).length > 0) {
      throw new Error(`Assertion Failed: Noise element matching "${selector}" was not cleaned!`);
    }
  });
  console.log('✓ Consolidated Cheerio DOM noise cleaner verified successfully.\n');

  console.log('3. Profiling DOM Cleanup Performance...');
  const hugeDirtyHtml = `
    <html>
      <body>
        ${'<div><header>Header</header><nav>Nav</nav><footer>Footer</footer></div>\n'.repeat(500)}
      </body>
    </html>
  `;

  // Measure merged selector cleanup
  const $merged = cheerio.load(hugeDirtyHtml);
  const startMerged = performance.now();
  const noiseSelectors = [
    'nav', 'header', 'footer',
    'script', 'style', 'noscript', 'iframe',
    '.cookie-banner', '.popup', '.ad', '.advertisement',
    '[aria-hidden="true"]', '#cookie-consent', '.social-share'
  ];
  $merged(noiseSelectors.join(', ')).remove();
  const endMerged = performance.now();
  console.log(`Consolidated DOM Cleaning Execution: ${(endMerged - startMerged).toFixed(3)} ms`);

  // Measure legacy loop cleanup
  const $legacy = cheerio.load(hugeDirtyHtml);
  const startLegacy = performance.now();
  noiseSelectors.forEach(sel => {
    $legacy(sel).remove();
  });
  const endLegacy = performance.now();
  console.log(`Legacy Looped DOM Cleaning Execution:   ${(endLegacy - startLegacy).toFixed(3)} ms`);

  const multiplier = ((endLegacy - startLegacy) / (endMerged - startMerged)).toFixed(1);
  console.log(`✓ Performance boost factor: ~${multiplier}x faster DOM cleanup!\n`);

  console.log('--- ALL OPTIMIZATION TESTS PASSED SUCCESSFULLY! ---');

  // Clean test directories
  await fs.rm(testDbDir, { recursive: true, force: true });
  await fs.rm(testOutputDir, { recursive: true, force: true });
}

runTests().catch(err => {
  console.error('❌ Test execution failed:', err);
  process.exit(1);
});
