import './src/polyfill.js';
import assert from 'assert';
import * as cheerio from 'cheerio';
import { 
  DecisionTreeNode, 
  DecisionTree,
  RandomForest,
  buildTierRouterTree,
  routeTier,
  diagnoseProbe,
  extractTierProbeFeatures,
  buildContentExtractorTree,
  scoreContentElement,
  rankContentCandidates,
  extractContentFeatures,
  buildCrawlPriorityTree,
  prioritizeUrl,
  batchPrioritize,
  extractUrlFeatures
} from './src/trees/index.js';

console.log('🧪 Starting Scrapi Decision Tree v2.0 Verification Suite...\n');

// ═════════════════════════════════════════
// 1. Core Decision Tree Engine Tests
// ═════════════════════════════════════════
console.log('1. Testing Core Decision Tree Engine v2.0...');

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

// Test explanation v2 (depth, elapsedUs)
const explanation = tree.explain({ status: 200, bodySize: 5000 });
assert.strictEqual(explanation.value, 'FULL_PAGE');
assert.ok(explanation.confidence > 0);
assert.strictEqual(explanation.label, 'Large body');
assert.strictEqual(explanation.path.length, 2);
assert.strictEqual(explanation.depth, 2);
assert.ok(typeof explanation.elapsedUs === 'number');
assert.ok(explanation.path[0].includes('status'));
assert.ok(explanation.path[1].includes('bodySize'));

// Test JSON serialization & deserialization
const jsonStr = tree.toJSON();
const reconstructed = DecisionTree.fromJSON(jsonStr);
const r1Reconstructed = reconstructed.predict({ status: 200, bodySize: 5000 });
assert.strictEqual(r1Reconstructed, 'FULL_PAGE');

// Test new operators: between, regex, startsWith, endsWith
const regexNode = new DecisionTreeNode({
  feature: 'url',
  operator: 'regex',
  threshold: '^https://.*\\.com$'
});
assert.strictEqual(regexNode.evaluate('https://example.com'), true);
assert.strictEqual(regexNode.evaluate('http://example.org'), false);

const betweenNode = new DecisionTreeNode({
  feature: 'score',
  operator: 'between',
  threshold: [0.5, 0.9]
});
assert.strictEqual(betweenNode.evaluate(0.7), true);
assert.strictEqual(betweenNode.evaluate(0.3), false);

const startsWithNode = new DecisionTreeNode({
  feature: 'path',
  operator: 'startsWith',
  threshold: '/api/'
});
assert.strictEqual(startsWithNode.evaluate('/api/users'), true);
assert.strictEqual(startsWithNode.evaluate('/blog/post'), false);

// Test tree stats
const stats = tree.stats();
assert.ok(stats.nodeCount >= 3);
assert.ok(stats.leafCount >= 2);
assert.ok(stats.maxDepth >= 2);
assert.ok(stats.evalCount > 0);

// Test tree validation
const validation = tree.validate();
assert.strictEqual(validation.valid, true);
assert.strictEqual(validation.errors.length, 0);

// Test tree visualization
const viz = tree.visualize();
assert.ok(viz.includes('🔀'));
assert.ok(viz.includes('🍃'));

console.log('✓ Core Decision Tree Engine v2.0 passed.');
console.log(`  Stats: ${stats.nodeCount} nodes, ${stats.leafCount} leaves, max depth ${stats.maxDepth}`);

// ═════════════════════════════════════════
// 2. CART Training (fit) Tests
// ═════════════════════════════════════════
console.log('\n2. Testing CART Training (fit from data)...');

const trainSamples = [
  { bodyLength: 500, hasJs: true, wordCount: 10 },
  { bodyLength: 200, hasJs: true, wordCount: 5 },
  { bodyLength: 300, hasJs: true, wordCount: 8 },
  { bodyLength: 15000, hasJs: false, wordCount: 2500 },
  { bodyLength: 12000, hasJs: false, wordCount: 2000 },
  { bodyLength: 8000, hasJs: false, wordCount: 1500 },
  { bodyLength: 20000, hasJs: false, wordCount: 3000 },
  { bodyLength: 600, hasJs: true, wordCount: 15 },
  { bodyLength: 100, hasJs: true, wordCount: 3 },
  { bodyLength: 25000, hasJs: false, wordCount: 4000 },
];
const trainLabels = ['dynamic', 'dynamic', 'dynamic', 'static', 'static', 'static', 'static', 'dynamic', 'dynamic', 'static'];

const trainedTree = DecisionTree.fit(trainSamples, trainLabels, { maxDepth: 5, name: 'TestTrainedTree' });

// Trained tree should correctly classify training data
let correct = 0;
for (let i = 0; i < trainSamples.length; i++) {
  if (trainedTree.predict(trainSamples[i]) === trainLabels[i]) correct++;
}
const accuracy = correct / trainSamples.length;
assert.ok(accuracy >= 0.8, `Training accuracy ${accuracy} should be >= 0.8`);

const trainedValidation = trainedTree.validate();
assert.strictEqual(trainedValidation.valid, true);

console.log(`✓ CART Training passed. Accuracy: ${(accuracy * 100).toFixed(0)}%`);
console.log(`  Tree: ${trainedTree.stats().nodeCount} nodes, depth ${trainedTree.stats().maxDepth}`);

// ═════════════════════════════════════════
// 3. Random Forest Ensemble Tests
// ═════════════════════════════════════════
console.log('\n3. Testing Random Forest Ensemble...');

const forest = RandomForest.fit(trainSamples, trainLabels, {
  nTrees: 7,
  maxDepth: 5,
  sampleRatio: 0.8,
  name: 'TestForest'
});

assert.strictEqual(forest.trees.length, 7);

const forestPred = forest.predict({ bodyLength: 500, hasJs: true, wordCount: 10 });
assert.strictEqual(forestPred.value, 'dynamic');
assert.ok(forestPred.confidence > 0.5);

const forestPred2 = forest.predict({ bodyLength: 20000, hasJs: false, wordCount: 3000 });
assert.strictEqual(forestPred2.value, 'static');

// Feature importance
const importance = forest.featureImportance();
assert.ok(typeof importance === 'object');
assert.ok(Object.keys(importance).length > 0);

// Forest explain
const forestExplain = forest.explain({ bodyLength: 500, hasJs: true, wordCount: 10 });
assert.strictEqual(forestExplain.value, 'dynamic');
assert.strictEqual(forestExplain.explanations.length, 7);

// Serialization
const forestJson = forest.toJSON();
const restoredForest = RandomForest.fromJSON(forestJson);
const restoredPred = restoredForest.predict({ bodyLength: 500, hasJs: true, wordCount: 10 });
assert.strictEqual(restoredPred.value, 'dynamic');

console.log(`✓ Random Forest passed. ${forest.trees.length} trees, prediction confidence: ${(forestPred.confidence * 100).toFixed(0)}%`);
console.log(`  Feature importance: ${JSON.stringify(importance)}`);

// ═════════════════════════════════════════
// 4. Autonomous Tier Router v2 Tests
// ═════════════════════════════════════════
console.log('\n4. Testing TierRouterTree v2.0...');

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
assert.ok(staticDecision.confidence >= 0.85);
console.log(`  ✓ Static site → ${staticDecision.tier.toUpperCase()} (${staticDecision.label})`);

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
assert.ok(spaDecision.confidence >= 0.85);
console.log(`  ✓ React SPA → ${spaDecision.tier.toUpperCase()} (${spaDecision.label})`);

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
assert.ok(cfDecision.confidence >= 0.9);
console.log(`  ✓ Cloudflare challenge → ${cfDecision.tier.toUpperCase()} (${cfDecision.label})`);

// Mock 4: PerimeterX challenge (new in v2)
const pxMockHtml = `
  <html><body>
    <div id="px-captcha">
      <p>Please verify you are a human. PerimeterX protection.</p>
    </div>
  </body></html>
`;
const pxDecision = routeTier({ status: 403, rawHtml: pxMockHtml });
assert.strictEqual(pxDecision.tier, 'stealth');
console.log(`  ✓ PerimeterX challenge → ${pxDecision.tier.toUpperCase()} (${pxDecision.label})`);

// Mock 5: Next.js SSR (should be static, has __NEXT_DATA__)
const ssrMockHtml = `
  <!DOCTYPE html>
  <html>
    <head><title>SSR App</title></head>
    <body>
      <div id="__next">
        <main><h1>Server Rendered Page</h1>
        <p>${'Server side rendered content with lots of words. '.repeat(50)}</p></main>
      </div>
      <script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>
    </body>
  </html>
`;
const ssrDecision = routeTier({ status: 200, rawHtml: ssrMockHtml });
assert.strictEqual(ssrDecision.tier, 'static');
console.log(`  ✓ Next.js SSR → ${ssrDecision.tier.toUpperCase()} (${ssrDecision.label})`);

// Mock 6: JSON API response (new in v2)
const jsonDecision = routeTier({ status: 200, rawHtml: '{}', headers: { 'content-type': 'application/json' } });
assert.strictEqual(jsonDecision.tier, 'static');
console.log(`  ✓ JSON API → ${jsonDecision.tier.toUpperCase()} (${jsonDecision.label})`);

// Mock 7: Meta-refresh redirect (new in v2)
const metaRedirectHtml = `<html><head><meta http-equiv="refresh" content="3;url=https://example.com/real-page"></head><body>Redirecting...</body></html>`;
const metaDecision = routeTier({ status: 200, rawHtml: metaRedirectHtml });
assert.strictEqual(metaDecision.tier, 'dynamic');
console.log(`  ✓ Meta-refresh redirect → ${metaDecision.tier.toUpperCase()} (${metaDecision.label})`);

// Test diagnostic report
const diagReport = diagnoseProbe({ status: 403, rawHtml: cloudflareMockHtml });
assert.ok(diagReport.includes('Tier Router Diagnosis'));
assert.ok(diagReport.includes('STEALTH'));
console.log('  ✓ Diagnostic report generated successfully.');

// ═════════════════════════════════════════
// 5. DOM Content Extractor v2 Tests
// ═════════════════════════════════════════
console.log('\n5. Testing ContentExtractorTree v2.0...');

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
      <article class="post-content main-article" itemprop="articleBody">
        <h1>Understanding Autonomous Web Crawling with Decision Trees</h1>
        <h2>Introduction to CART Algorithms</h2>
        <p>In modern web architectures, websites deploy <strong>anti-bot defenses</strong>, dynamic single page applications, and complex client side hydration.</p>
        <p>A deterministic CART decision tree evaluates HTTP status codes, payload sizes, noscript tags, and Turnstile challenge tokens in <em>microseconds</em>.</p>
        <p>This allows scrapers to autonomously escalate requests without human trial and error, conserving server compute and proxy bandwidth.</p>
        <h2>Advanced Feature Engineering</h2>
        <p>Modern content extraction uses image density ratios, heading hierarchy, and semantic HTML5 attributes to identify primary content areas.</p>
        <p>The composite scoring engine fuses multiple signals into a single priority score for each DOM candidate.</p>
      </article>
      <div class="related-posts sidebar-widget" role="complementary">
        <h3>Related Articles</h3>
        <ul>
          <li><a href="/post/1">Related post one</a></li>
          <li><a href="/post/2">Related post two</a></li>
          <li><a href="/post/3">Related post three</a></li>
        </ul>
      </div>
      <table>
        <tr><th>Feature</th><th>Value</th></tr>
        <tr><td>Accuracy</td><td>98.2%</td></tr>
        <tr><td>Latency</td><td>110 µs</td></tr>
        <tr><td>Throughput</td><td>9,013 ops/s</td></tr>
        <tr><td>Memory</td><td>2.1 KB</td></tr>
      </table>
      <footer class="site-footer">
        <p>Copyright 2026. All rights reserved. <a href="/privacy">Privacy</a> <a href="/terms">Terms</a></p>
      </footer>
    </body>
  </html>
`);

const articleEl = domDoc('article');
const sidebarEl = domDoc('.sidebar').first();
const footerEl = domDoc('footer');
const tableEl = domDoc('table');

const articleScoring = scoreContentElement(domDoc, articleEl);
const sidebarScoring = scoreContentElement(domDoc, sidebarEl);
const footerScoring = scoreContentElement(domDoc, footerEl);

assert.strictEqual(articleScoring.classification, 'MAIN_CONTENT');
assert.ok(sidebarScoring.classification === 'BOILERPLATE' || sidebarScoring.classification === 'NOISE');
assert.ok(articleScoring.score > sidebarScoring.score, 'Article score must exceed sidebar score');
assert.ok(articleScoring.score > footerScoring.score, 'Article score must exceed footer score');

console.log(`  ✓ Article → ${articleScoring.classification} (Score: ${articleScoring.score.toFixed(3)})`);
console.log(`  ✓ Sidebar → ${sidebarScoring.classification} (Score: ${sidebarScoring.score.toFixed(3)})`);
console.log(`  ✓ Footer  → ${footerScoring.classification} (Score: ${footerScoring.score.toFixed(3)})`);

// Test new features
const articleFeats = articleScoring.features;
assert.ok(articleFeats.hasStructuredHeadings, 'Article should have structured headings');
assert.ok(articleFeats.hasItemProp, 'Article has itemprop');
assert.ok(articleFeats.sentenceCount >= 3, 'Article should have sentences');

// Test rankContentCandidates
const ranked = rankContentCandidates(domDoc, 'article, div, table, footer, main, section', 5);
assert.ok(ranked.length > 0);
assert.strictEqual(ranked[0].classification, 'MAIN_CONTENT');
console.log(`  ✓ rankContentCandidates: Top candidate is ${ranked[0].tagName} (${ranked[0].classification}, score: ${ranked[0].score.toFixed(3)})`);

// ═════════════════════════════════════════
// 6. Crawl Priority Classifier v2 Tests
// ═════════════════════════════════════════
console.log('\n6. Testing CrawlPriorityTree v2.0...');

const urlQueue = [
  'https://news.ycombinator.com/static/logo.png',
  'https://techcrunch.com/2026/10/14/google-deepmind-agentic-coding/',
  'https://example.com/wp-login.php?redirect_to=dashboard',
  'https://blog.example.com/category/engineering?page=2',
  'https://example.com/cdn-cgi/challenge-platform/h/b/scripts/alpha.js',
  'https://medium.com/@author/how-we-built-scrapi-v2',
  'https://example.com/api/v2/users/list',
  'https://example.com/post/my-article?utm_source=twitter&utm_medium=social',
  'https://example.com/a/b/c/d/e/f/g/h/deep-nested-page'
];

const prioritized = urlQueue.map(url => ({
  url,
  decision: prioritizeUrl(url)
})).sort((a, b) => b.decision.priorityRank - a.decision.priorityRank);

assert.strictEqual(prioritized[0].decision.classification, 'HIGH_PRIORITY_CONTENT');
assert.ok(prioritized[0].url.includes('google-deepmind'));

const lowest = prioritized[prioritized.length - 1];
assert.strictEqual(lowest.decision.priorityRank, 0);

console.log('  Sorted Crawl Frontier Priority:');
prioritized.forEach((p, idx) => {
  console.log(`    ${idx + 1}. [${p.decision.classification.padEnd(26)}] (Rank: ${String(p.decision.priorityRank).padStart(3)}) ${p.url}`);
});

// Test new v2 features
const apiUrl = prioritizeUrl('https://example.com/api/v2/users');
assert.ok(apiUrl.classification.includes('DISCARD'));
console.log(`  ✓ API endpoint correctly classified as ${apiUrl.classification}`);

const trackingUrl = prioritizeUrl('https://example.com/article/great-post?utm_source=twitter&utm_campaign=launch');
assert.strictEqual(trackingUrl.classification, 'LOW_PRIORITY');
console.log(`  ✓ Tracking params correctly classified as ${trackingUrl.classification}`);

// Test anchor text context (new in v2)
const contextUrl = prioritizeUrl('https://blog.example.com/my-great-readable-slug', {
  anchorText: 'How to build autonomous web scrapers with decision trees',
  parentUrl: 'https://blog.example.com/'
});
assert.ok(contextUrl.features.hasDescriptiveAnchor);
assert.ok(contextUrl.features.isReadableSlug);
console.log(`  ✓ Anchor text context detected: descriptive=${contextUrl.features.hasDescriptiveAnchor}, readable slug=${contextUrl.features.isReadableSlug}`);

// Test batchPrioritize
const batchResults = batchPrioritize(
  ['https://example.com/blog/post-1', 'https://example.com/logo.png', 'https://example.com/about'],
  { parentUrl: 'https://example.com/' }
);
assert.ok(batchResults.length >= 2); // logo.png should be filtered out by default
assert.ok(!batchResults.find(r => r.url.endsWith('.png')));
console.log(`  ✓ batchPrioritize: ${batchResults.length} URLs after filtering discarded.`);

// ═════════════════════════════════════════
// 7. Tree Visualization & Statistics
// ═════════════════════════════════════════
console.log('\n7. Testing Tree Visualization & Statistics...');

const tierTree = buildTierRouterTree();
const tierStats = tierTree.stats();
console.log(`  ✓ Tier Router: ${tierStats.nodeCount} nodes, ${tierStats.leafCount} leaves, max depth ${tierStats.maxDepth}`);

const contentTree = buildContentExtractorTree();
const contentStats = contentTree.stats();
console.log(`  ✓ Content Extractor: ${contentStats.nodeCount} nodes, ${contentStats.leafCount} leaves, max depth ${contentStats.maxDepth}`);

const crawlTree = buildCrawlPriorityTree();
const crawlStats = crawlTree.stats();
console.log(`  ✓ Crawl Prioritizer: ${crawlStats.nodeCount} nodes, ${crawlStats.leafCount} leaves, max depth ${crawlStats.maxDepth}`);

const totalNodes = tierStats.nodeCount + contentStats.nodeCount + crawlStats.nodeCount;
console.log(`  ✓ Total Decision Tree Nodes: ${totalNodes}`);

console.log('\n✅ All Decision Tree v2.0 Tests Passed Successfully!');
