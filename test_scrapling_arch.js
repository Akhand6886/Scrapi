import './src/polyfill.js';
import fs from 'fs/promises';
import path from 'path';
import { 
  fetch, 
  StaticFetcher, 
  DynamicFetcher, 
  StealthyFetcher,
  Response,
  SelectorList,
  AdaptiveEngine,
  MarkdownEngine,
  CrawlEngine,
  initStorage,
  saveSpiderCheckpoint,
  getSpiderCheckpoint
} from './src/index.js';
import { MCPServer } from './src/mcp/server.js';

async function runScraplingArchTests() {
  console.log('🧪 ========================================================');
  console.log('🧪 Starting Scrapling Architecture Comprehensive Test Suite');
  console.log('🧪 ========================================================\n');

  const testDbDir = './data_test_arch';
  const testOutputDir = './output_test_arch';

  await fs.rm(testDbDir, { recursive: true, force: true });
  await fs.rm(testOutputDir, { recursive: true, force: true });

  console.log('1. Testing Storage Initialization with Checkpoints & Fingerprints Schema...');
  await initStorage(testDbDir, testOutputDir);
  console.log('✓ Storage and SQLite schema initialized successfully.\n');

  console.log('2. Testing Parser Subsystem: Adaptor, Selector & XPath Evaluator...');
  const sampleHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Scrapling Test Page</title></head>
      <body>
        <nav><a href="/home">Home</a></nav>
        <main>
          <article class="post-item" id="main-post">
            <h1 class="headline">Breaking: Scrapi Adopts Scrapling Architecture</h1>
            <p class="summary">Ultra-fast web scraping is now available in Node.js.</p>
            <div class="meta">Published on 2026-08-31 by Karim</div>
            <ul class="features">
              <li class="feat-item"><a href="/feature-1">Multi-tier Fetchers</a></li>
              <li class="feat-item"><a href="/feature-2">Adaptive Selectors</a></li>
              <li class="feat-item"><a href="/feature-3">Scrapy Spider Engine</a></li>
            </ul>
          </article>
        </main>
      </body>
    </html>
  `;

  const response = new Response({
    url: 'https://test-site.org/news/post-1',
    status: 200,
    headers: { 'content-type': 'text/html' },
    html: sampleHtml,
    fetcher: 'test'
  });

  // Test CSS queries
  const title = response.css('h1.headline').first().cleanText;
  if (title !== 'Breaking: Scrapi Adopts Scrapling Architecture') {
    throw new Error(`Assertion Failed: Title selector mismatch: "${title}"`);
  }

  const featureLinks = response.css('.feat-item a').attribs('href');
  if (featureLinks.length !== 3 || featureLinks[0] !== 'https://test-site.org/feature-1') {
    throw new Error(`Assertion Failed: Feature links resolution mismatch: ${JSON.stringify(featureLinks)}`);
  }

  // Test XPath queries
  const xpathArticles = response.xpath('//article[@id="main-post"]');
  if (xpathArticles.length !== 1) {
    throw new Error('Assertion Failed: XPath //article[@id="main-post"] failed!');
  }

  const xpathContains = response.xpath('//p[contains(text(), "Ultra-fast")]');
  if (xpathContains.length !== 1) {
    throw new Error('Assertion Failed: XPath //p[contains(text())] failed!');
  }

  // Test Regex matching
  const dateMatch = response.css('.meta').first().re(/\d{4}-\d{2}-\d{2}/);
  if (dateMatch.length === 0 || dateMatch[0] !== '2026-08-31') {
    throw new Error(`Assertion Failed: Regex date extraction failed: ${JSON.stringify(dateMatch)}`);
  }

  // Test Markdown Conversion
  const mdResult = response.toMarkdown();
  if (!mdResult.markdown.includes('Breaking: Scrapi Adopts Scrapling Architecture') || mdResult.metadata.word_count === 0) {
    throw new Error('Assertion Failed: Markdown conversion failed!');
  }
  console.log('✓ Adaptor, Selector, XPath, Regex, and MarkdownEngine tests passed successfully.\n');

  console.log('3. Testing Adaptive Element Tracking & Self-Healing Engine...');
  // 1. Generate fingerprint of original element
  const originalFingerprint = AdaptiveEngine.generateFingerprint(response.$, response.$('article#main-post')[0]);
  console.log('Original element fingerprint:', originalFingerprint);

  // 2. Simulate site redesign where classes and IDs are completely changed / obfuscated
  const redesignedHtml = `
    <html>
      <body>
        <div class="wrapper-redesign">
          <section class="x99_obfuscated_container">
            <h2 class="title_v2">Breaking: Scrapi Adopts Scrapling Architecture</h2>
            <div class="text_desc">Ultra-fast web scraping is now available in Node.js.</div>
          </section>
        </div>
      </body>
    </html>
  `;
  const redesignedResponse = new Response({
    url: 'https://test-site.org/news/post-1',
    html: redesignedHtml
  });

  // Attempt self-healing using previous signature
  const healingResult = AdaptiveEngine.relocate(redesignedResponse.$, originalFingerprint);
  console.log('Self-healing result:', {
    found: !!healingResult.element,
    confidence: healingResult.confidence,
    healedSelector: healingResult.healedSelector
  });

  if (!healingResult.element || healingResult.confidence < 0.35) {
    throw new Error('Assertion Failed: AdaptiveEngine failed to relocate mutated element!');
  }
  console.log('✓ Adaptive self-healing successfully recovered target with confidence:', (healingResult.confidence * 100).toFixed(1) + '%\n');

  console.log('4. Testing StaticFetcher on live URL...');
  const staticFetcher = new StaticFetcher();
  const liveRes = await staticFetcher.fetch('https://example.com');
  if (liveRes.status !== 200 || !liveRes.rawHtml.includes('Example Domain')) {
    throw new Error('Assertion Failed: StaticFetcher failed to fetch example.com');
  }
  console.log(`✓ StaticFetcher fetched example.com in ${liveRes.timing}ms.\n`);

  console.log('5. Testing Spider Checkpoints & Pause/Resume persistence...');
  const testJobId = 'test-crawl-job';
  saveSpiderCheckpoint(testJobId, 'https://example.com', {
    visited: ['https://example.com'],
    queue: [{ url: 'https://example.com/more', depth: 1 }],
    succeeded: 1,
    failed: 0
  });

  const checkpoint = getSpiderCheckpoint(testJobId);
  if (!checkpoint || checkpoint.state.visited.length !== 1 || checkpoint.state.succeeded !== 1) {
    throw new Error('Assertion Failed: Checkpoint persistence failed!');
  }
  console.log('✓ Spider checkpoint saved and retrieved successfully.\n');

  console.log('6. Testing MCP Server Tool Calls...');
  const mcp = new MCPServer();
  const toolFetchResult = await mcp.handleToolCall('scrapi_fetch', { url: 'https://example.com' });
  const parsedData = JSON.parse(toolFetchResult.content[0].text);
  if (!parsedData.title.includes('Example Domain') || !parsedData.markdown) {
    throw new Error('Assertion Failed: MCP scrapi_fetch tool failed!');
  }

  const toolExtractResult = await mcp.handleToolCall('scrapi_extract', { url: 'https://example.com', css: 'title' });
  const parsedExtract = JSON.parse(toolExtractResult.content[0].text);
  if (parsedExtract.count === 0 || !parsedExtract.matches[0].text.includes('Example Domain')) {
    throw new Error('Assertion Failed: MCP scrapi_extract tool failed!');
  }
  console.log('✓ MCP Server tools (scrapi_fetch, scrapi_extract) executed successfully.\n');

  // Clean up test directories
  await fs.rm(testDbDir, { recursive: true, force: true });
  await fs.rm(testOutputDir, { recursive: true, force: true });

  console.log('🏆 ========================================================');
  console.log('🏆 ALL SCRAPLING ARCHITECTURE TESTS PASSED SUCCESSFULLY!');
  console.log('🏆 ========================================================');
}

runScraplingArchTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
