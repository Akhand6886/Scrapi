import './src/polyfill.js';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';
import { 
  initStorage, 
  closeStorage,
  getDatabase,
  isStorageReady,
  insertScrape,
  getAllScrapes,
  getScrapeById,
  getScrapeByUrl,
  isUrlScraped,
  saveSpiderCheckpoint,
  getSpiderCheckpoint,
  saveProfile,
  getProfileByName
} from './src/storage.js';
import { 
  TopicMatcher, 
  TopicCrawler,
  PaginationEngine 
} from './src/spiders/index.js';
import { CrawlEngine } from './src/spiders/engine.js';
import { Response } from './src/parser/adaptor.js';
import { closeAllFetchers } from './src/fetchers/index.js';

async function runAuditTests() {
  console.log('🧪 ========================================================');
  console.log('🧪 Scrapi v2.0 Reliability & Codebase Audit Integration Suite');
  console.log('🧪 ========================================================\n');

  const auditDbDir = './data_reliability_audit';
  const auditOutputDir = './output_reliability_audit';

  // Helper cleanup
  const cleanupDirs = async () => {
    closeStorage();
    await fs.rm(auditDbDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(auditOutputDir, { recursive: true, force: true }).catch(() => {});
  };

  await cleanupDirs();

  try {
    // ──────────────────────────────────────────────────────────
    // 1. SQLite Recovery & Resilience Verification
    // ──────────────────────────────────────────────────────────
    console.log('1. Testing SQLite Resilience & Auto-Recovery...');

    // 1a. Uninitialized database safety
    console.log('  1a. Testing uninitialized database operation guards...');
    closeStorage(); // Ensure db is null
    if (isStorageReady()) {
      throw new Error('Assertion Failed: isStorageReady should return false after closeStorage()');
    }
    const uninitInsert = insertScrape({ url: 'https://example.com/uninit' });
    if (uninitInsert !== null) {
      throw new Error(`Assertion Failed: insertScrape on null DB should return null, got ${uninitInsert}`);
    }
    const uninitScrapes = getAllScrapes();
    if (!Array.isArray(uninitScrapes) || uninitScrapes.length !== 0) {
      throw new Error('Assertion Failed: getAllScrapes on null DB should return empty array');
    }
    const uninitCheck = isUrlScraped('https://example.com/uninit');
    if (uninitCheck !== false) {
      throw new Error('Assertion Failed: isUrlScraped on null DB should return false');
    }
    const uninitCheckpoint = getSpiderCheckpoint('test-job');
    if (uninitCheckpoint !== null) {
      throw new Error('Assertion Failed: getSpiderCheckpoint on null DB should return null');
    }
    console.log('  ✓ Uninitialized database operations gracefully return safe defaults without throwing.');

    // 1b. Normal initialization, WAL pragmas, and busy timeout
    console.log('  1b. Testing SQLite initialization, WAL mode, and busy_timeout pragma...');
    await initStorage(auditDbDir, auditOutputDir);
    if (!isStorageReady()) {
      throw new Error('Assertion Failed: Storage not ready after initStorage');
    }
    const db = getDatabase();
    const journalMode = db.pragma('journal_mode', { simple: true });
    if (journalMode.toLowerCase() !== 'wal') {
      throw new Error(`Assertion Failed: Expected journal_mode=wal, got ${journalMode}`);
    }
    const busyTimeout = db.pragma('busy_timeout', { simple: true });
    if (busyTimeout !== 5000) {
      throw new Error(`Assertion Failed: Expected busy_timeout=5000, got ${busyTimeout}`);
    }
    console.log('  ✓ Database initialized with journal_mode=WAL and busy_timeout=5000ms.');

    // 1c. Checkpoint JSON parsing resilience
    console.log('  1c. Testing checkpoint JSON corruption recovery...');
    db.prepare(`
      INSERT INTO spider_checkpoints (job_id, seed_url, state, updated_at)
      VALUES (?, ?, ?, ?)
    `).run('corrupt-job', 'https://example.com', '{invalid-json-content', new Date().toISOString());

    const recoveredCp = getSpiderCheckpoint('corrupt-job');
    if (recoveredCp !== null) {
      throw new Error('Assertion Failed: Corrupted checkpoint JSON should return null instead of throwing');
    }
    console.log('  ✓ Corrupted checkpoint JSON safely caught and handled.');

    // 1d. Database corruption auto-recovery
    console.log('  1d. Testing automatic recovery from corrupted database file...');
    closeStorage();
    const dbFilePath = path.join(auditDbDir, 'scrapes.db');
    // Overwrite the sqlite header with garbage bytes
    await fs.writeFile(dbFilePath, 'THIS_IS_NOT_A_VALID_SQLITE_DATABASE_FILE_CORRUPTED_PAYLOAD', 'utf-8');

    // Attempting to re-init storage on a corrupted database
    await initStorage(auditDbDir, auditOutputDir);
    if (!isStorageReady()) {
      throw new Error('Assertion Failed: Storage should recover and be ready after detecting corrupted DB');
    }

    // Verify corrupt backup was preserved
    const dirFiles = await fs.readdir(auditDbDir);
    const hasCorruptBackup = dirFiles.some(f => f.includes('scrapes.db.corrupt.'));
    if (!hasCorruptBackup) {
      throw new Error('Assertion Failed: Auto-recovery should back up corrupted database with .corrupt timestamp');
    }

    // Verify new database is fully operational
    const testId = insertScrape({
      url: 'https://example.com/post-recovery',
      title: 'Post Recovery Article',
      status: 'success',
      scraped_at: new Date().toISOString()
    });
    if (!testId || testId < 1) {
      throw new Error('Assertion Failed: Fresh database after auto-recovery failed to insert record');
    }
    const fetchedScrape = getScrapeById(testId);
    if (!fetchedScrape || fetchedScrape.title !== 'Post Recovery Article') {
      throw new Error('Assertion Failed: Failed to retrieve record from fresh recovered DB');
    }
    console.log('  ✓ SQLite corruption auto-recovery succeeded! Corrupted file backed up and fresh DB operational.\n');

    // ──────────────────────────────────────────────────────────
    // 2. Missing-Link Behavior & Relative URL Resolution
    // ──────────────────────────────────────────────────────────
    console.log('2. Testing Missing-Link Behavior & Edge Cases...');

    // 2a. Multi-anchor container link extraction
    console.log('  2a. Testing article card with author/badge links preceding title link...');
    const multiLinkArticleHtml = `
      <html>
        <body>
          <main>
            <article class="post-item">
              <span class="badge"><a href="/category/technology">Technology</a></span>
              <span class="author"><a href="/author/alex">Alex Rivera</a></span>
              <h2 class="title"><a href="/technology/breakthrough-2026">AI Breakthrough in 2026</a></h2>
              <div class="comments"><a href="#comments">12 Comments</a></div>
              <div class="actions"><a href="javascript:void(0)">Share</a></div>
              <div class="contact"><a href="mailto:info@example.com">Email Us</a></div>
              <div class="empty"><a href="   ">Empty</a></div>
              <div class="no-href"><a>No Href Link</a></div>
            </article>
          </main>
        </body>
      </html>
    `;
    const respMulti = new Response({ 
      url: 'https://example.com/technology/', 
      html: multiLinkArticleHtml 
    });
    const profileTech = TopicMatcher.createProfile('technology');
    const extractedArticles = TopicMatcher.extractArticleLinksFromListing(
      respMulti, 
      profileTech, 
      'https://example.com/technology/'
    );

    if (!extractedArticles.includes('https://example.com/technology/breakthrough-2026')) {
      throw new Error(`Assertion Failed: Article link missing from extraction! Got: ${JSON.stringify(extractedArticles)}`);
    }
    // Verify noise / non-http links were skipped
    for (const link of extractedArticles) {
      if (link.includes('mailto:') || link.includes('javascript:') || link.includes('#') || link.endsWith('/author/alex') || link.endsWith('/category/technology')) {
        throw new Error(`Assertion Failed: Noise or non-article link leaked into results: ${link}`);
      }
    }
    console.log('  ✓ Multi-anchor article card properly extracted headline link and skipped author, category, and noise.');

    // 2b. CrawlEngine cleanUrl relative link resolution
    console.log('  2b. Testing CrawlEngine cleanUrl relative resolution and scheme filtering...');
    const engine = new CrawlEngine();
    
    // Relative link with baseUrl
    const resolvedRel = engine.cleanUrl('/articles/first-post', 'https://example.com/section/');
    if (resolvedRel !== 'https://example.com/articles/first-post') {
      throw new Error(`Assertion Failed: Expected 'https://example.com/articles/first-post', got '${resolvedRel}'`);
    }

    // Stripping tracking parameters
    const cleanedTracking = engine.cleanUrl('https://example.com/page?utm_source=twitter&utm_medium=social&id=123');
    if (cleanedTracking !== 'https://example.com/page?id=123') {
      throw new Error(`Assertion Failed: Tracking params not stripped! Got '${cleanedTracking}'`);
    }

    // Invalid / non-HTTP protocols return null
    if (engine.cleanUrl('javascript:alert(1)') !== null) throw new Error('Assertion Failed: javascript: should return null');
    if (engine.cleanUrl('mailto:test@example.com') !== null) throw new Error('Assertion Failed: mailto: should return null');
    if (engine.cleanUrl('tel:+1234567890') !== null) throw new Error('Assertion Failed: tel: should return null');
    if (engine.cleanUrl('#section') !== null) throw new Error('Assertion Failed: #section should return null');
    if (engine.cleanUrl('   ') !== null) throw new Error('Assertion Failed: whitespace should return null');
    if (engine.cleanUrl(null) !== null) throw new Error('Assertion Failed: null should return null');
    console.log('  ✓ cleanUrl safely normalizes relative paths, strips tracking parameters, and ignores non-http schemes.');

    // 2c. Pagination next-page with disabled first button
    console.log('  2c. Testing pagination next-page discovery with disabled anchor preceding valid link...');
    const disabledNextHtml = `
      <html>
        <body>
          <div class="top-nav">
            <a class="next disabled" href="#">Previous/Next Disabled</a>
          </div>
          <div class="pagination">
            <span class="current">1</span>
            <a class="next" href="/technology/page/2/">Next Page »</a>
          </div>
        </body>
      </html>
    `;
    const respPag = new Response({ url: 'https://example.com/technology/', html: disabledNextHtml });
    const nextPageUrl = PaginationEngine.findNextPageUrl(respPag, 'https://example.com/technology/');
    if (nextPageUrl !== 'https://example.com/technology/page/2/') {
      throw new Error(`Assertion Failed: Expected 'https://example.com/technology/page/2/', got '${nextPageUrl}'`);
    }
    console.log('  ✓ findNextPageUrl skipped disabled href="#" and located valid next page.\n');

    // ──────────────────────────────────────────────────────────
    // 3. Fallback Seed Recovery on Broken / 404 Entrypoint
    // ──────────────────────────────────────────────────────────
    console.log('3. Testing End-to-End Crawl Fallback on Speculative 404 Entrypoint...');

    // Start a local mock HTTP server that returns 404 on speculative /category/crypto/
    // but has valid article links on the seed homepage (/)
    const server = http.createServer((req, res) => {
      const u = req.url;
      if (u === '/category/crypto/') {
        // Speculative entrypoint 404s
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>404 Not Found</h1></body></html>');
      } else if (u === '/') {
        // Seed homepage with crypto article links
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <head><title>Home Portal</title></head>
            <body>
              <main>
                <article>
                  <h2><a href="/crypto/bitcoin-etf-2026">Bitcoin ETF Flows in 2026</a></h2>
                  <time datetime="2026-05-10">May 10, 2026</time>
                </article>
              </main>
            </body>
          </html>
        `);
      } else if (u === '/crypto/bitcoin-etf-2026') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <head><title>Bitcoin ETF Flows in 2026</title></head>
            <body>
              <main>
                <article>
                  <h1>Bitcoin ETF Flows in 2026</h1>
                  <time datetime="2026-05-10">May 10, 2026</time>
                  <p>In-depth cryptocurrency analysis and institutional adoption metrics for 2026.</p>
                </article>
              </main>
            </body>
          </html>
        `);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const baseMockUrl = `http://127.0.0.1:${port}`;
    console.log(`  Mock HTTP server active at ${baseMockUrl}`);

    const crawler = new TopicCrawler({
      exhaustive: true,
      concurrency: 1,
      delay: 50,
      sitemap: false,
      output: auditOutputDir
    });

    // Run topic crawl for 'crypto'
    // resolveTopicEntrypoint will guess http://127.0.0.1:${port}/crypto/ or /category/crypto/
    // which 404s, but fallbackSeedUrl should recover to http://127.0.0.1:${port}/ and scrape the article!
    const crawlResult = await crawler.crawl(baseMockUrl, 'crypto');
    server.close();

    console.log('  Crawl results with fallback:', {
      visited: crawlResult.visited,
      succeeded: crawlResult.succeeded,
      failed: crawlResult.failed,
      dateCoverage: crawlResult.dateCoverage
    });

    if (crawlResult.succeeded === 0) {
      throw new Error('Assertion Failed: Fallback seed recovery failed to scrape any articles after entrypoint 404!');
    }
    if (!crawlResult.dateCoverage.byYear['2026']) {
      throw new Error('Assertion Failed: Date coverage should contain year 2026 from recovered article');
    }
    console.log('  ✓ Speculative entrypoint 404 was successfully recovered by seed fallback, scraping the article.\n');

    console.log('🏆 ========================================================');
    console.log('🏆 ALL RELIABILITY & AUDIT TESTS PASSED SUCCESSFULLY!');
    console.log('🏆 ========================================================\n');

  } finally {
    await closeAllFetchers();
    await cleanupDirs();
  }
}

runAuditTests().catch((err) => {
  console.error('\n❌ Audit Test Suite Failed:', err);
  process.exit(1);
});
