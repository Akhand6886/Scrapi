import './src/polyfill.js';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { 
  initStorage, 
  getAllScrapes, 
  isUrlScraped 
} from './src/storage.js';
import { 
  TopicCrawler, 
  runTopicCrawl, 
  PaginationEngine, 
  TopicMatcher 
} from './src/spiders/index.js';
import { CrawlEngine } from './src/spiders/engine.js';
import { Response } from './src/parser/adaptor.js';
import { closeAllFetchers } from './src/fetchers/index.js';

async function runTests() {
  console.log('🧪 ========================================================');
  console.log('🧪 Starting Scrapi v2.0 Exhaustive Topic Crawling Test Suite');
  console.log('🧪 ========================================================\n');

  const testDbDir = './data_topic_test';
  const testOutputDir = './output_topic_test';

  // Clean test directories
  await fs.rm(testDbDir, { recursive: true, force: true });
  await fs.rm(testOutputDir, { recursive: true, force: true });
  await initStorage(testDbDir, testOutputDir);

  // ──────────────────────────────────────────
  // 1. Date & Rich Metadata Extraction Tests
  // ──────────────────────────────────────────
  console.log('1. Testing Date & Rich Metadata Extraction...');

  // 1a. JSON-LD date, author, tags, canonical
  const jsonLdHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Deep Learning Trends 2024</title>
        <link rel="canonical" href="https://example.com/analysis/deep-learning-2024" />
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": "Deep Learning Trends 2024",
            "datePublished": "2024-02-15T09:30:00Z",
            "author": { "@type": "Person", "name": "Dr. Sarah Chen" },
            "articleSection": "Analysis",
            "keywords": ["AI", "Neural Networks", "Transformers"]
          }
        </script>
      </head>
      <body>
        <main><article><p>Comprehensive analysis of transformers in 2024.</p></article></main>
      </body>
    </html>
  `;
  const resp1 = new Response({ url: 'https://example.com/analysis/deep-learning-2024', html: jsonLdHtml });
  const meta1 = resp1.extractMetadata();

  if (meta1.date !== '2024-02-15') {
    throw new Error(`Assertion Failed: Expected date '2024-02-15' from JSON-LD, got '${meta1.date}'`);
  }
  if (meta1.author !== 'Dr. Sarah Chen') {
    throw new Error(`Assertion Failed: Expected author 'Dr. Sarah Chen', got '${meta1.author}'`);
  }
  if (!meta1.tags.includes('AI') || !meta1.tags.includes('Transformers')) {
    throw new Error(`Assertion Failed: Tags missing expected entries: ${JSON.stringify(meta1.tags)}`);
  }
  console.log('  ✓ JSON-LD Date (2024-02-15), Author, Category, and Tags extracted successfully.');

  // 1b. HTML5 <time> tag and meta tag fallback
  const htmlTimeHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Market Analysis 2025</title>
        <meta name="author" content="Alex Rivera" />
        <meta property="article:section" content="Finance" />
      </head>
      <body>
        <h1>Market Analysis 2025</h1>
        <div class="byline">Published on <time datetime="2025-08-20T14:00:00">August 20, 2025</time></div>
        <p>Market projections for Q3 2025 show positive divergence.</p>
      </body>
    </html>
  `;
  const resp2 = new Response({ url: 'https://example.com/analysis/markets-2025', html: htmlTimeHtml });
  const meta2 = resp2.extractMetadata();
  if (meta2.date !== '2025-08-20') {
    throw new Error(`Assertion Failed: Expected date '2025-08-20' from <time>, got '${meta2.date}'`);
  }
  if (meta2.author !== 'Alex Rivera') {
    throw new Error(`Assertion Failed: Expected author 'Alex Rivera', got '${meta2.author}'`);
  }
  console.log('  ✓ HTML5 <time datetime> and meta tags extracted successfully.');

  // 1c. URL Date slug fallback
  const urlDateHtml = `<html><body><article><p>Archived analysis report without header date.</p></article></body></html>`;
  const resp3 = new Response({ url: 'https://example.com/analysis/2024/01/10/first-historical-post', html: urlDateHtml });
  const meta3 = resp3.extractMetadata();
  if (meta3.date !== '2024-01-10') {
    throw new Error(`Assertion Failed: Expected date '2024-01-10' from URL slug, got '${meta3.date}'`);
  }
  console.log('  ✓ URL date slug (2024/01/10) fallback extracted successfully.\n');

  // ──────────────────────────────────────────
  // 2. PaginationEngine Discovery Tests
  // ──────────────────────────────────────────
  console.log('2. Testing PaginationEngine Discovery...');

  const paginationHtml = `
    <html>
      <body>
        <div class="posts">
          <article><a href="/analysis/article-1">Article 1</a></article>
        </div>
        <div class="pagination">
          <span class="current">1</span>
          <a class="page-numbers" href="/analysis/page/2/">2</a>
          <a class="page-numbers" href="/analysis/page/3/">3</a>
          <a class="next" href="/analysis/page/2/">Next Page »</a>
        </div>
        <div class="subcategories">
          <a href="/analysis/macro/">Macro Analysis</a>
          <a href="/analysis/crypto/">Crypto Analysis</a>
        </div>
        <div class="archives">
          <a href="/archive/2024/">2024 Archive</a>
          <a href="/archive/2025/">2025 Archive</a>
        </div>
      </body>
    </html>
  `;
  const pageResp = new Response({ url: 'https://example.com/analysis/', html: paginationHtml });

  const nextUrl = PaginationEngine.findNextPageUrl(pageResp, 'https://example.com/analysis/');
  if (nextUrl !== 'https://example.com/analysis/page/2/') {
    throw new Error(`Assertion Failed: Expected next URL 'https://example.com/analysis/page/2/', got '${nextUrl}'`);
  }
  console.log('  ✓ Next Page URL detected accurately:', nextUrl);

  const numberedPages = PaginationEngine.findNumberedPageUrls(pageResp, 'https://example.com/analysis/');
  if (!numberedPages.includes('https://example.com/analysis/page/2/') || !numberedPages.includes('https://example.com/analysis/page/3/')) {
    throw new Error(`Assertion Failed: Numbered pages missing expected entries: ${JSON.stringify(numberedPages)}`);
  }
  console.log('  ✓ Numbered page set discovered accurately:', numberedPages);

  const subcats = PaginationEngine.findSubcategoryUrls(pageResp, 'analysis', 'https://example.com/analysis/');
  const subcatUrls = subcats.map(s => s.url);
  if (!subcatUrls.includes('https://example.com/analysis/macro/') || !subcatUrls.includes('https://example.com/analysis/crypto/')) {
    throw new Error(`Assertion Failed: Subcategories missing expected entries: ${JSON.stringify(subcatUrls)}`);
  }
  console.log('  ✓ Child subcategories discovered accurately:', subcatUrls);

  const archives = PaginationEngine.findArchiveUrls(pageResp, 'https://example.com/analysis/', 'analysis');
  if (archives.length < 2) {
    throw new Error(`Assertion Failed: Expected at least 2 archive URLs, got ${archives.length}`);
  }
  console.log('  ✓ Historical archive navigation links discovered accurately.\n');

  // ──────────────────────────────────────────
  // 3. TopicMatcher Relevance Tests
  // ──────────────────────────────────────────
  console.log('3. Testing TopicMatcher Relevance & Noise Filtering...');
  const topicProfile = TopicMatcher.createProfile('Analysis');

  const match1 = TopicMatcher.isTopicMatch('https://example.com/analysis/market-overview', topicProfile);
  const match2 = TopicMatcher.isTopicMatch('https://example.com/category/analysis/crypto', topicProfile);
  const match3 = TopicMatcher.isTopicMatch('https://example.com/login', topicProfile);
  const match4 = TopicMatcher.isTopicMatch('https://example.com/cart', topicProfile);
  const match5 = TopicMatcher.isTopicMatch('https://example.com/sports/football-match', topicProfile);

  if (!match1 || !match2) throw new Error('Assertion Failed: TopicMatcher failed to match relevant analysis URLs');
  if (match3 || match4 || match5) throw new Error('Assertion Failed: TopicMatcher allowed out-of-scope or system noise URLs');
  console.log('  ✓ TopicMatcher accurately accepts relevant URLs and excludes system noise.\n');

  // ──────────────────────────────────────────
  // 4. Live Local HTTP Server Integration Test
  // ──────────────────────────────────────────
  console.log('4. Testing Live Exhaustive Topic Crawl (Dual Frontier & Date Range)...');

  // Mock server hosting 3 paginated listing pages from 2026 back to 2024
  let serverPort = 0;
  const mockServer = http.createServer((req, res) => {
    const urlPath = req.url;

    if (urlPath === '/analysis' || urlPath === '/analysis/') {
      // Page 1: 2026 articles + Next page link to /analysis/page/2
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <body>
            <h1>Topic: Analysis</h1>
            <div class="posts">
              <article><a href="/analysis/2026-latest-breakthrough">Latest AI Breakthrough 2026</a></article>
            </div>
            <div class="pagination">
              <a class="next" href="/analysis/page/2">Next Page »</a>
            </div>
          </body>
        </html>
      `);
    } else if (urlPath === '/analysis/page/2') {
      // Page 2: 2025 article + Next page link to /analysis/page/3
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <body>
            <h1>Topic: Analysis - Page 2</h1>
            <div class="posts">
              <article><a href="/analysis/2025-market-shift">2025 Global Market Shift</a></article>
            </div>
            <div class="pagination">
              <a class="next" href="/analysis/page/3">Next Page »</a>
            </div>
          </body>
        </html>
      `);
    } else if (urlPath === '/analysis/page/3') {
      // Page 3: 2024 article (Earliest publication) - No next page (Depleted)
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <body>
            <h1>Topic: Analysis - Page 3</h1>
            <div class="posts">
              <article><a href="/analysis/2024-genesis-post">Genesis Analysis Post 2024</a></article>
            </div>
            <div class="pagination">
              <span class="end">End of results</span>
            </div>
          </body>
        </html>
      `);
    } else if (urlPath === '/analysis/2026-latest-breakthrough') {
      // Article 1 (2026)
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Latest AI Breakthrough 2026</title>
            <meta property="article:published_time" content="2026-10-14T10:00:00Z" />
            <meta name="author" content="Dr. Antigravity" />
          </head>
          <body>
            <article>
              <h1>Latest AI Breakthrough 2026</h1>
              <p>Autonomous agents have reached new heights in late 2026 with self-healing decision trees.</p>
            </article>
          </body>
        </html>
      `);
    } else if (urlPath === '/analysis/2025-market-shift') {
      // Article 2 (2025)
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>2025 Global Market Shift</title>
            <meta property="article:published_time" content="2025-06-15T08:00:00Z" />
            <meta name="author" content="Elena Rostova" />
          </head>
          <body>
            <article>
              <h1>2025 Global Market Shift</h1>
              <p>Major shifts observed in global compute markets through mid-2025.</p>
            </article>
          </body>
        </html>
      `);
    } else if (urlPath === '/analysis/2024-genesis-post') {
      // Article 3 (2024 - Earliest available)
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Genesis Analysis Post 2024</title>
            <meta property="article:published_time" content="2024-01-10T12:00:00Z" />
            <meta name="author" content="Founder" />
          </head>
          <body>
            <article>
              <h1>Genesis Analysis Post 2024</h1>
              <p>Our very first analysis published when the company started publishing in early 2024.</p>
            </article>
          </body>
        </html>
      `);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  await new Promise(resolve => {
    mockServer.listen(0, '127.0.0.1', () => {
      serverPort = mockServer.address().port;
      resolve();
    });
  });

  const baseUrl = `http://127.0.0.1:${serverPort}`;
  const seedUrl = `${baseUrl}/analysis/`;

  console.log(`  ✓ Test HTTP server running on port ${serverPort}`);

  const crawler = new TopicCrawler({
    output: testOutputDir,
    concurrency: 1,
    delay: 50,
    sitemap: false
  });

  const crawlResult = await crawler.crawl(seedUrl, 'Analysis');

  console.log('  ✓ Crawl finished! Results:');
  console.log(`     Succeeded Scrapes: ${crawlResult.succeeded}`);
  console.log(`     Earliest Date:     ${crawlResult.dateCoverage.earliestDate}`);
  console.log(`     Latest Date:       ${crawlResult.dateCoverage.latestDate}`);
  console.log(`     Distribution:      ${JSON.stringify(crawlResult.dateCoverage.byYear)}`);

  // Assertions
  if (crawlResult.succeeded !== 3) {
    throw new Error(`Assertion Failed: Expected 3 succeeded articles, got ${crawlResult.succeeded}`);
  }
  if (crawlResult.dateCoverage.earliestDate !== '2024-01-10') {
    throw new Error(`Assertion Failed: Expected earliest date '2024-01-10', got '${crawlResult.dateCoverage.earliestDate}'`);
  }
  if (crawlResult.dateCoverage.latestDate !== '2026-10-14') {
    throw new Error(`Assertion Failed: Expected latest date '2026-10-14', got '${crawlResult.dateCoverage.latestDate}'`);
  }
  if (!crawlResult.dateCoverage.byYear['2024'] || !crawlResult.dateCoverage.byYear['2025'] || !crawlResult.dateCoverage.byYear['2026']) {
    throw new Error(`Assertion Failed: Year distribution missing 2024, 2025, or 2026`);
  }
  console.log('  ✓ Dynamic Date Coverage (2024-01-10 ➔ 2026-10-14) verified across multi-page pagination.\n');

  // ──────────────────────────────────────────
  // 5. Incremental Crawl & Deduplication Test
  // ──────────────────────────────────────────
  console.log('5. Testing Incremental Crawl (Deduplication against SQLite)...');
  
  // Running a second crawl: should detect all 3 articles already exist in SQLite
  const secondCrawl = await crawler.crawl(seedUrl, 'Analysis');
  console.log(`  ✓ Second Crawl: Succeeded=${secondCrawl.succeeded}, SkippedExisting=${secondCrawl.skippedExisting}`);

  if (secondCrawl.skippedExisting !== 3) {
    throw new Error(`Assertion Failed: Expected 3 skipped existing articles in incremental crawl, got ${secondCrawl.skippedExisting}`);
  }
  console.log('  ✓ Incremental crawling successfully skipped existing SQLite records.\n');

  // ──────────────────────────────────────────
  // 6. Checkpoint Persistence and Resume Test
  // ──────────────────────────────────────────
  console.log('6. Testing Checkpoint State Persistence and Resume...');
  const testJobId = 'test-topic-checkpoint';
  const engineWithCheckpoint = new CrawlEngine({
    topic: 'Analysis',
    jobId: testJobId,
    output: testOutputDir
  });

  engineWithCheckpoint.discoveryQueue.push({ url: `${baseUrl}/analysis/page/2`, depth: 1, type: 'LISTING' });
  engineWithCheckpoint.articleQueue.push({ url: `${baseUrl}/analysis/2026-latest-breakthrough`, depth: 2, type: 'ARTICLE' });
  engineWithCheckpoint.dateCoverage.earliestDate = '2024-01-10';
  engineWithCheckpoint.dateCoverage.latestDate = '2026-10-14';
  engineWithCheckpoint.saveCheckpoint(seedUrl);

  const resumingEngine = new CrawlEngine({
    jobId: testJobId,
    output: testOutputDir
  });
  const resumed = resumingEngine.resumeFromCheckpoint(testJobId);

  if (!resumed) throw new Error('Assertion Failed: Failed to resume checkpoint from SQLite');
  if (resumingEngine.discoveryQueue.length !== 1 || resumingEngine.articleQueue.length !== 1) {
    throw new Error('Assertion Failed: Resumed queues count mismatch');
  }
  if (resumingEngine.dateCoverage.earliestDate !== '2024-01-10') {
    throw new Error('Assertion Failed: Resumed date coverage earliest date mismatch');
  }
  console.log('  ✓ Checkpoint persistence and dual-frontier resume verified successfully.\n');

  // Close mock server and clean up
  await new Promise(resolve => mockServer.close(resolve));
  await fs.rm(testDbDir, { recursive: true, force: true });
  await fs.rm(testOutputDir, { recursive: true, force: true });
  await closeAllFetchers();

  console.log('🏆 ========================================================');
  console.log('🏆 ALL EXHAUSTIVE TOPIC CRAWLING TESTS PASSED SUCCESSFULLY!');
  console.log('🏆 ========================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
