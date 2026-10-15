import './src/polyfill.js';
import assert from 'assert';
import * as cheerio from 'cheerio';
import { 
  DecisionTreeNode, 
  DecisionTree,
  buildTierRouterTree,
  routeTier,
  extractTierProbeFeatures,
  buildContentExtractorTree,
  scoreContentElement,
  extractContentFeatures,
  buildCrawlPriorityTree,
  prioritizeUrl,
  extractUrlFeatures
} from './src/trees/index.js';

console.log('🧪 Starting Scrapi Decision Tree Verification Suite...\n');

// ---------------------------------------------------------
// 1. Core Decision Tree Engine Tests
// ---------------------------------------------------------
console.log('1. Testing Core Decision Tree Engine...');

const rootNode = new DecisionTreeNode({
  feature: 'status',
  operator: '==',
  threshold: 200,
  left: new DecisionTreeNode({
    feature: 'bodySize',
    operator: '>',
    threshold: 1000,
    left: new DecisionTreeNode({ value: 'FULL_PAGE', confidence: 0.95, label: 'Large body' }),
    right: new DecisionTreeNode({ value: 'EMPTY_PAGE', confidence: 0.85, label: 'Small body' })
  }),
  right: new DecisionTreeNode({ value: 'ERROR_PAGE', confidence: 0.99, label: 'Non-200 status' })
});

const tree = new DecisionTree(rootNode, 'TestTree');

// Test positive path
const r1 = tree.predict({ status: 200, bodySize: 5000 });
assert.strictEqual(r1, 'FULL_PAGE');

// Test empty path
const r2 = tree.predict({ status: 200, bodySize: 200 });
assert.strictEqual(r2, 'EMPTY_PAGE');

// Test non-200 path
const r3 = tree.predict({ status: 404, bodySize: 5000 });
assert.strictEqual(r3, 'ERROR_PAGE');

// Test explanation
const explanation = tree.explain({ status: 200, bodySize: 5000 });
assert.strictEqual(explanation.value, 'FULL_PAGE');
assert.strictEqual(explanation.confidence, 0.95);
assert.strictEqual(explanation.label, 'Large body');
assert.strictEqual(explanation.path.length, 2);
assert.ok(explanation.path[0].includes('status'));
assert.ok(explanation.path[1].includes('bodySize'));

// Test JSON serialization & deserialization
const jsonStr = tree.toJSON();
const reconstructed = DecisionTree.fromJSON(jsonStr);
const r1Reconstructed = reconstructed.predict({ status: 200, bodySize: 5000 });
assert.strictEqual(r1Reconstructed, 'FULL_PAGE');

console.log('✓ Core Decision Tree Engine passed.');

// ---------------------------------------------------------
// 2. Autonomous Tier Router Tests
// ---------------------------------------------------------
console.log('\n2. Testing TierRouterTree...');

// Mock 1: Healthy static blog post
const staticMockHtml = `
  <!DOCTYPE html>
  <html>
    <head><title>Clean Static Site</title></head>
    <body>
      <header><nav><a href="/">Home</a></nav></header>
      <main>
        <h1>Welcome to my static blog</h1>
        <p>${'This is a comprehensive article with deep analysis. '.repeat(100)}</p>
      </main>
      <footer>Scrapi 2026</footer>
    </body>
  </html>
`;
const staticDecision = routeTier({ status: 200, rawHtml: staticMockHtml, url: 'https://example.com/blog/article-1' });
assert.strictEqual(staticDecision.tier, 'static');
assert.ok(staticDecision.confidence >= 0.9);
console.log(`  ✓ Static site routed to: ${staticDecision.tier.toUpperCase()} (${staticDecision.label})`);

// Mock 2: Modern React / Next.js SPA with empty root
const spaMockHtml = `
  <!DOCTYPE html>
  <html>
    <head><title>Client Rendered App</title></head>
    <body>
      <div id="root"></div>
      <noscript>You need to enable JavaScript to run this app.</noscript>
      <script src="/static/js/bundle.main.js"></script>
    </body>
  </html>
`;
const spaDecision = routeTier({ status: 200, rawHtml: spaMockHtml, url: 'https://app.example.com/dashboard' });
assert.strictEqual(spaDecision.tier, 'dynamic');
assert.ok(spaDecision.confidence >= 0.95);
console.log(`  ✓ React SPA routed to: ${spaDecision.tier.toUpperCase()} (${spaDecision.label})`);

// Mock 3: Cloudflare Turnstile Block
const cloudflareMockHtml = `
  <!DOCTYPE html>
  <html>
    <head><title>Just a moment...</title></head>
    <body>
      <div class="cf-browser-verification">
        <span>Verify you are human</span>
        <div id="cf-turnstile"></div>
      </div>
    </body>
  </html>
`;
const cfDecision = routeTier({ status: 403, rawHtml: cloudflareMockHtml, url: 'https://protected.example.com/data' });
assert.strictEqual(cfDecision.tier, 'stealth');
assert.ok(cfDecision.confidence >= 0.99);
console.log(`  ✓ Cloudflare challenge routed to: ${cfDecision.tier.toUpperCase()} (${cfDecision.label})`);

// ---------------------------------------------------------
// 3. DOM Content Extractor Tests
// ---------------------------------------------------------
console.log('\n3. Testing ContentExtractorTree...');

const domDoc = cheerio.load(`
  <html>
    <body>
      <div class="sidebar widget nav-menu">
        <a href="/1">Link 1</a>
        <a href="/2">Link 2</a>
        <a href="/3">Link 3</a>
        <a href="/4">Link 4</a>
        <a href="/5">Link 5</a>
      </div>
      <article class="post-content main-article">
        <h1>Understanding Autonomous Web Crawling with Decision Trees</h1>
        <p>In modern web architectures, websites deploy anti-bot defenses, dynamic single page applications, and complex client side hydration.</p>
        <p>A deterministic CART decision tree evaluates HTTP status codes, payload sizes, noscript tags, and Turnstile challenge tokens in microseconds.</p>
        <p>This allows scrapers to autonomously escalate requests without human trial and error, conserving server compute and proxy bandwidth.</p>
      </article>
      <footer class="site-footer">
        <p>Copyright 2026. All rights reserved. <a href="/privacy">Privacy</a> <a href="/terms">Terms</a></p>
      </footer>
    </body>
  </html>
`);

const articleEl = domDoc('article');
const sidebarEl = domDoc('.sidebar');
const footerEl = domDoc('footer');

const articleScoring = scoreContentElement(domDoc, articleEl);
const sidebarScoring = scoreContentElement(domDoc, sidebarEl);
const footerScoring = scoreContentElement(domDoc, footerEl);

assert.strictEqual(articleScoring.leaf.value, 'MAIN_CONTENT');
assert.ok(sidebarScoring.leaf.value === 'BOILERPLATE' || sidebarScoring.leaf.value === 'NOISE');
assert.ok(articleScoring.score > sidebarScoring.score, 'Article score must exceed sidebar score');
assert.ok(articleScoring.score > footerScoring.score, 'Article score must exceed footer score');

console.log(`  ✓ Main article classified as: ${articleScoring.leaf.value} (Score: ${articleScoring.score.toFixed(2)})`);
console.log(`  ✓ Nav sidebar classified as: ${sidebarScoring.leaf.value} (Score: ${sidebarScoring.score.toFixed(2)})`);
console.log(`  ✓ Site footer classified as: ${footerScoring.leaf.value} (Score: ${footerScoring.score.toFixed(2)})`);

// ---------------------------------------------------------
// 4. Crawl Priority Classifier Tests
// ---------------------------------------------------------
console.log('\n4. Testing CrawlPriorityTree...');

const urlQueue = [
  'https://news.ycombinator.com/static/logo.png',
  'https://techcrunch.com/2026/10/14/google-deepmind-agentic-coding/',
  'https://example.com/wp-login.php?redirect_to=dashboard',
  'https://blog.example.com/category/engineering?page=2',
  'https://example.com/cdn-cgi/challenge-platform/h/b/scripts/alpha.js',
  'https://medium.com/@author/how-we-built-scrapi-v2'
];

const prioritized = urlQueue.map(url => ({
  url,
  decision: prioritizeUrl(url)
})).sort((a, b) => b.decision.priorityRank - a.decision.priorityRank);

assert.strictEqual(prioritized[0].decision.classification, 'HIGH_PRIORITY_CONTENT');
assert.ok(prioritized[0].url.includes('google-deepmind') || prioritized[0].url.includes('how-we-built-scrapi'));

const lowest = prioritized[prioritized.length - 1];
assert.strictEqual(lowest.decision.classification, 'DISCARD');
assert.strictEqual(lowest.decision.priorityRank, 0);
assert.ok(lowest.url.endsWith('.png') || lowest.url.includes('cdn-cgi'));

console.log('  Sorted Crawl Frontier Priority:');
prioritized.forEach((p, idx) => {
  console.log(`    ${idx + 1}. [${p.decision.classification.padEnd(24)}] (Rank: ${String(p.decision.priorityRank).padStart(3)}) ${p.url}`);
});

console.log('\n✅ All Decision Tree Tests Passed Successfully!');
