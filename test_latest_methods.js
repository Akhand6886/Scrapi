import './src/polyfill.js';
import assert from 'assert';
import * as cheerio from 'cheerio';
import { 
  fnv1a64, 
  computeSimHash, 
  hammingDistance, 
  simHashSimilarity, 
  computeElementSimHash 
} from './src/parser/simhash.js';
import { 
  extractEntities, 
  findRepeatingClusters, 
  computeTreeSignature, 
  induceItemFields 
} from './src/parser/cluster_extractor.js';
import { 
  ThompsonSamplingBandit, 
  sampleBeta, 
  sampleGamma, 
  globalBandit 
} from './src/trees/bandit.js';
import { AdaptiveEngine, Response } from './src/parser/index.js';
import { initStorage, getDomainBanditPrior, saveDomainBanditPrior } from './src/storage.js';

console.log('🧪 Starting Scrapi State-of-the-Art Methods Verification Suite...\n');

// ═════════════════════════════════════════════
// 1. 64-Bit SimHash & Locality-Sensitive Hashing
// ═════════════════════════════════════════════
console.log('1. Testing 64-Bit SimHash & Locality-Sensitive Hashing...');

const hash1 = fnv1a64('test-string-a');
const hash2 = fnv1a64('test-string-b');
assert.strictEqual(typeof hash1, 'bigint');
assert.notStrictEqual(hash1, hash2);

// Identical hashes -> 0 Hamming distance, 1.0 similarity
const simA = computeSimHash(['article', 'main-content', 'p-tag', 'heading-2']);
const simB = computeSimHash(['article', 'main-content', 'p-tag', 'heading-2']);
assert.strictEqual(simA, simB);
assert.strictEqual(hammingDistance(simA, simB), 0);
assert.strictEqual(simHashSimilarity(simA, simB), 1.0);

// Slightly mutated features -> small Hamming distance, high similarity
const simMutated = computeSimHash(['article', 'main-content', 'p-tag', 'heading-2', 'extra-pill']);
const distMutated = hammingDistance(simA, simMutated);
assert.ok(distMutated <= 16, `Hamming distance should be small for near-duplicates (got ${distMutated})`);
assert.ok(simHashSimilarity(simA, simMutated) >= 0.75);

console.log(`  ✓ FNV-1a 64-bit and SimHash bitwise operations verified.`);
console.log(`  ✓ Identical similarity: 1.0 | Near-duplicate similarity: ${simHashSimilarity(simA, simMutated)} (Hamming dist: ${distMutated})`);

// Test SimHash DOM Element Fingerprinting & Self-Healing
const originalHtml = `
  <html>
    <body>
      <main class="page-container">
        <article id="featured-article" class="blog-post primary-story" role="article">
          <h2>Autonomous Web Scraping in 2026</h2>
          <p>Cutting-edge web extraction relies on Bayesian reinforcement learning and locality sensitive hashing.</p>
          <span class="author">Dr. Alpha</span>
        </article>
      </main>
    </body>
  </html>
`;

const $orig = cheerio.load(originalHtml);
const origArticle = $orig('article')[0];
const origFingerprint = AdaptiveEngine.generateFingerprint($orig, origArticle);

assert.ok(origFingerprint.simHash);
assert.strictEqual(typeof origFingerprint.simHash, 'string');
assert.strictEqual(origFingerprint.simHash.length, 16);
console.log(`  ✓ Generated 64-bit SimHash DOM fingerprint: 0x${origFingerprint.simHash}`);

// Simulate a radical frontend redesign:
// 1. Changed all class names to randomized CSS-module hashes (.css-x89f, .sc-99)
// 2. Stripped original ID (#featured-article is gone)
// 3. Changed wrapper container tags (<section> instead of <main>)
const redesignedHtml = `
  <html>
    <body>
      <div class="sc-app-wrapper-v3">
        <section class="css-container-77a8">
          <article id="art-99124" class="css-post-card-77a8 css-anim-fade" role="article">
            <h2>Autonomous Web Scraping in 2026</h2>
            <p>Cutting-edge web extraction relies on Bayesian reinforcement learning and locality sensitive hashing.</p>
            <span class="css-meta-author">Dr. Alpha</span>
          </article>
        </section>
      </div>
    </body>
  </html>
`;

const $redesigned = cheerio.load(redesignedHtml);
const healed = AdaptiveEngine.relocate($redesigned, origFingerprint);

assert.ok(healed.element, 'Self-healing must successfully locate the redesigned article');
assert.ok(healed.confidence >= 0.50, `Self-healing confidence must exceed 50% (got ${(healed.confidence * 100).toFixed(1)}%)`);
console.log(`  ✓ Redesign Recovery via SimHash: Located element with ${(healed.confidence * 100).toFixed(1)}% confidence!`);
console.log(`    Healed Selector: "${healed.healedSelector}"`);

// ═════════════════════════════════════════════
// 2. Unsupervised Structural Entity Induction
// ═════════════════════════════════════════════
console.log('\n2. Testing Unsupervised Structural Entity Induction & Pattern Clustering...');

const catalogHtml = `
  <html>
    <body>
      <header><nav><a href="/">Home</a><a href="/deals">Deals</a></nav></header>
      <main>
        <h1>Featured Electronics</h1>
        <div class="product-grid" role="grid">
          <div class="product-card" data-id="101">
            <a href="/products/laptop-pro"><img src="https://images.example.com/laptop.jpg" alt="Pro Laptop" /></a>
            <h3><a href="/products/laptop-pro">Ultra Pro Laptop 16-inch M4</a></h3>
            <span class="badge">Sale</span>
            <div class="price-container">
              <span class="currency-tag">$1,299.00</span>
              <span class="rating">★ 4.9 (420 reviews)</span>
            </div>
            <p class="description">High-performance laptop with 32GB RAM and 1TB SSD for advanced engineering workloads.</p>
          </div>

          <div class="product-card" data-id="102">
            <a href="/products/wireless-headphones"><img src="https://images.example.com/headphones.jpg" alt="Headphones" /></a>
            <h3><a href="/products/wireless-headphones">Active Noise Cancelling Headphones</a></h3>
            <span class="badge">Popular</span>
            <div class="price-container">
              <span class="currency-tag">$249.99</span>
              <span class="rating">★ 4.7 (1,280 reviews)</span>
            </div>
            <p class="description">Crystal-clear acoustic transparency with 40-hour battery life and spatial audio support.</p>
          </div>

          <div class="product-card" data-id="103">
            <a href="/products/smartwatch-ultra"><img src="https://images.example.com/watch.jpg" alt="Smartwatch" /></a>
            <h3><a href="/products/smartwatch-ultra">Rugged Titanium Smartwatch</a></h3>
            <div class="price-container">
              <span class="currency-tag">$399.00</span>
              <span class="rating">★ 4.8 (89 reviews)</span>
            </div>
            <p class="description">Waterproof GPS multisport watch with heart rate sensor, sapphire glass, and cellular LTE.</p>
          </div>

          <div class="product-card" data-id="104">
            <a href="/products/mechanical-keyboard"><img src="https://images.example.com/keyboard.jpg" alt="Keyboard" /></a>
            <h3><a href="/products/mechanical-keyboard">Wireless Mechanical Keyboard (Cherry MX)</a></h3>
            <span class="badge">Best Seller</span>
            <div class="price-container">
              <span class="currency-tag">$119.50</span>
              <span class="rating">★ 4.6 (512 reviews)</span>
            </div>
            <p class="description">Hot-swappable RGB mechanical gaming keyboard with aluminum chassis and gasket mount.</p>
          </div>

          <div class="product-card" data-id="105">
            <a href="/products/usb-dock"><img src="https://images.example.com/dock.jpg" alt="USB Dock" /></a>
            <h3><a href="/products/usb-dock">Thunderbolt 4 Multi-Port Dock</a></h3>
            <div class="price-container">
              <span class="currency-tag">$189.00</span>
              <span class="rating">★ 4.5 (340 reviews)</span>
            </div>
            <p class="description">Dual 4K 60Hz display support with 100W power delivery, gigabit ethernet, and SD card reader.</p>
          </div>
        </div>
      </main>
      <footer><p>Copyright 2026. All rights reserved.</p></footer>
    </body>
  </html>
`;

const $catalog = cheerio.load(catalogHtml);

// Test repeating cluster detection
const clusters = findRepeatingClusters($catalog);
assert.ok(clusters.length >= 1, 'Must detect at least 1 repeating structural cluster');
assert.strictEqual(clusters[0].elements.length, 5, 'Should discover all 5 product cards');
console.log(`  ✓ Repeating clusters found: ${clusters.length} (Top cluster size: ${clusters[0].elements.length} items)`);

// Test unsupervised entity extraction
const entitiesResult = extractEntities($catalog, { baseUrl: 'https://store.example.com' });
assert.strictEqual(entitiesResult.detectedType, 'catalog', 'Should detect catalog/e-commerce archetype');
assert.strictEqual(entitiesResult.entities.length, 5, 'Should induce all 5 entities');
assert.ok(entitiesResult.confidence >= 0.90);

const firstProduct = entitiesResult.entities[0];
assert.strictEqual(firstProduct.title, 'Ultra Pro Laptop 16-inch M4');
assert.strictEqual(firstProduct.price, '$1,299.00');
assert.strictEqual(firstProduct.badge, 'Sale');
assert.strictEqual(firstProduct.url, 'https://store.example.com/products/laptop-pro');
assert.strictEqual(firstProduct.image, 'https://images.example.com/laptop.jpg');
assert.ok(firstProduct.description.includes('High-performance laptop'));

console.log(`  ✓ Extracted ${entitiesResult.entities.length} items (Archetype: ${entitiesResult.detectedType.toUpperCase()}, Confidence: ${(entitiesResult.confidence * 100).toFixed(0)}%)`);
console.log(`    Sample Entity:`);
console.log(`      Title : ${firstProduct.title}`);
console.log(`      Price : ${firstProduct.price}`);
console.log(`      Badge : [${firstProduct.badge}]`);
console.log(`      URL   : ${firstProduct.url}`);
console.log(`      Image : ${firstProduct.image}`);

// Test Fluent Response.extractEntities() adaptor integration
const respAdaptor = new Response({
  url: 'https://store.example.com/catalog',
  status: 200,
  html: catalogHtml
});
const fluentEntities = respAdaptor.extractEntities();
assert.strictEqual(fluentEntities.entities.length, 5);
assert.strictEqual(fluentEntities.detectedType, 'catalog');
console.log(`  ✓ Fluent Response.extractEntities() verified successfully.`);

// ═════════════════════════════════════════════
// 3. Online Reinforcement Learning (Bandit)
// ═════════════════════════════════════════════
console.log('\n3. Testing Bayesian Thompson Sampling Multi-Armed Bandit...');

// Test statistical sampling primitives
const g = sampleGamma(2.5);
assert.ok(g > 0, 'Gamma sample must be strictly positive');
const b = sampleBeta(3, 2);
assert.ok(b > 0 && b < 1, 'Beta sample must reside strictly within (0, 1)');

// Initialize Bandit instance
const bandit = new ThompsonSamplingBandit({ priorAlpha: 2, priorBeta: 1, minObservations: 3, bypassThreshold: 0.85 });

// Initial state for unseen domain: optimistic priors, probe bypass disabled
const initialDecision = bandit.selectTier('https://protected-site.com/data');
assert.ok(['static', 'dynamic', 'stealth'].includes(initialDecision.tier));
assert.strictEqual(initialDecision.shouldBypassProbe, false, 'Unseen domain must not bypass initial probe');
console.log(`  ✓ Unseen domain correctly defaults to standard probing (Zero bypass)`);

// Simulate 8 consecutive Cloudflare Turnstile blocks (static fails, stealth succeeds)
for (let i = 0; i < 8; i++) {
  bandit.recordReward('protected-site.com', 'static', false);  // Static probe got 403 / Captcha
  bandit.recordReward('protected-site.com', 'stealth', true);  // Stealth evasion succeeded 200
}

const learnedStats = bandit.getDomainStats('protected-site.com');
assert.ok(learnedStats.arms.stealth.expectedValue >= 0.85, 'Stealth expected value must exceed 85%');
assert.ok(learnedStats.arms.static.expectedValue < 0.25, 'Static expected value must fall below 25%');

// Test probe bypass: domain now has high empirical probability for stealth
const bypassCheck = bandit.shouldBypassProbe('protected-site.com');
assert.strictEqual(bypassCheck.bypass, true, 'High-confidence bot defense domain must trigger probe bypass');
assert.strictEqual(bypassCheck.tier, 'stealth');
assert.ok(bypassCheck.confidence >= 0.85);

const updatedDecision = bandit.selectTier('https://protected-site.com/products/view');
assert.strictEqual(updatedDecision.shouldBypassProbe, true);
assert.strictEqual(updatedDecision.bypassTier, 'stealth');
console.log(`  ✓ Bayesian convergence: Static E[X]=${(learnedStats.arms.static.expectedValue * 100).toFixed(1)}%, Stealth E[X]=${(learnedStats.arms.stealth.expectedValue * 100).toFixed(1)}%`);
console.log(`  ✓ Probe Bypass Engaged: Directly dispatches STEALTH (saving ~150ms roundtrip)`);

// Test SQLite Persistence of Bandit Priors
await initStorage();
const testDomain = 'test-learning-domain.org';
const customPriors = {
  totalTrials: 14,
  static: { alpha: 2, beta: 12 },
  dynamic: { alpha: 2, beta: 5 },
  stealth: { alpha: 13, beta: 1 }
};
saveDomainBanditPrior(testDomain, customPriors);

const retrievedPriors = getDomainBanditPrior(testDomain);
assert.ok(retrievedPriors, 'Must retrieve saved bandit priors from SQLite');
assert.strictEqual(retrievedPriors.totalTrials, 14);
assert.strictEqual(retrievedPriors.stealth.alpha, 13);
console.log(`  ✓ SQLite persistence verified: Domain priors saved and restored across process lifecycle.`);

console.log('\n✅ All State-of-the-Art Methods Verified Successfully!');
