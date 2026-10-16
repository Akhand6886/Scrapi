# 💻 Scrapi v2.0: Developer & Contributor Guide

This guide is designed for software engineers and contributors who want to navigate, extend, debug, and maintain the Scrapi v2.0 codebase. It details the internal patterns, module interfaces, extension points, and testing workflows.

---

## 1. Architectural Principles & Patterns

Scrapi is designed around several core engineering principles:

1. **Pure ES Modules**: All codebase files use native Node.js ESM (`import`/`export`) with `"type": "module"` in [`package.json`](../package.json).
2. **Pluggable Multi-Tier Fetching**: Fetchers adhere to a strict interface (`BaseFetcher`), allowing new networking or browser engines to be plugged in seamlessly.
3. **Dual-Frontier Crawling**: Crawler architectures strictly decouple discovery links (categories, tags, archives, pagination) from terminal article links to avoid memory starvation and queue blocking.
4. **Synchronous Fast SQLite**: Database operations use `better-sqlite3` in Write-Ahead Logging (WAL) mode for high-throughput, synchronous database access without Promise queue overhead.
5. **Node.js 18 Compatibility**: Any script entrypoint must import [`src/polyfill.js`](../src/polyfill.js) first to guarantee `globalThis.File` availability.

---

## 2. Codebase Map

| Subsystem | Directory | Key Files | Responsibility |
|---|---|---|---|
| **Core** | `src/` | [`scraper.js`](../src/scraper.js), [`cli.js`](../src/cli.js), [`polyfill.js`](../src/polyfill.js) | Main coordinator, CLI command routing, global polyfills. |
| **Fetchers** | `src/fetcher/` | [`base.js`](../src/fetcher/base.js), [`static.js`](../src/fetcher/static.js), [`dynamic.js`](../src/fetcher/dynamic.js), [`stealthy.js`](../src/fetcher/stealthy.js), [`pool.js`](../src/fetcher/pool.js) | Network request handlers, Playwright wrappers, Keep-Alive pooling. |
| **Parser** | `src/parser/` | [`response.js`](../src/parser/response.js), [`adaptor.js`](../src/parser/adaptor.js), [`markdown.js`](../src/parser/markdown.js) | Cheerio DOM traversal, CSS/XPath query engines, Turndown Markdown. |
| **Spider** | `src/spider/` | [`spider.js`](../src/spider/spider.js), [`topicCrawler.js`](../src/spider/topicCrawler.js), [`paginationEngine.js`](../src/spider/paginationEngine.js), [`sitemapEngine.js`](../src/spider/sitemapEngine.js) | Crawling frontiers, sitemap parsers, pagination generators. |
| **Adaptive** | `src/adaptive/` | [`decisionTree.js`](../src/adaptive/decisionTree.js), [`selfHealing.js`](../src/adaptive/selfHealing.js), [`bandit.js`](../src/adaptive/bandit.js) | CART classification trees, 64-bit SimHash, Bayesian multi-armed bandit. |
| **Storage** | `src/db/` | [`sqliteStorage.js`](../src/db/sqliteStorage.js) | SQLite schema, WAL mode, migrations, profile & cache tables. |
| **Dashboard** | `src/dashboard/` | [`server.js`](../src/dashboard/server.js), [`src/ui/app.jsx`](../src/ui/app.jsx) | Express API, iframe visual picker proxy, React 18 interface. |
| **MCP** | `src/mcp/` | [`server.js`](../src/mcp/server.js) | Model Context Protocol stdio server for AI coding assistants. |

---

## 3. Extending the Fetcher Subsystem

All fetchers inherit from `BaseFetcher` located in [`src/fetcher/base.js`](../src/fetcher/base.js).

### 3.1 Step 1: Implement a Custom Fetcher
To create a new fetcher (e.g., using an external proxy rotating service or specialized headless engine):

```javascript
// src/fetcher/proxyFetcher.js
import { BaseFetcher } from './base.js';
import axios from 'axios';

export class ProxyFetcher extends BaseFetcher {
  constructor(options = {}) {
    super(options);
    this.proxyUrl = options.proxyUrl || process.env.SCRAPI_PROXY_URL;
  }

  async fetch(url, options = {}) {
    const startTime = Date.now();
    try {
      const response = await axios.get(url, {
        proxy: { host: 'proxy.provider.com', port: 8080 },
        timeout: options.timeout || this.options.timeout || 30000,
        headers: { 'User-Agent': 'Scrapi/2.0 Custom Proxy' },
        validateStatus: () => true
      });

      return {
        url,
        status: response.status,
        headers: response.headers,
        text: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
        durationMs: Date.now() - startTime,
        tier: 'proxy'
      };
    } catch (err) {
      throw new Error(`ProxyFetcher failed for ${url}: ${err.message}`);
    }
  }

  async close() {
    // Teardown connections or browser pools
  }
}
```

### 3.2 Step 2: Register in `FetcherPool`
Edit [`src/fetcher/pool.js`](../src/fetcher/pool.js) to instantiate and provide the new fetcher:

```javascript
import { ProxyFetcher } from './proxyFetcher.js';

// Inside FetcherPool constructor:
this.proxyFetcher = new ProxyFetcher(options);

// Inside getFetcher(type):
if (type === 'proxy') return this.proxyFetcher;
```

---

## 4. Extending Content Extraction & Heuristics

Content extraction logic resides in [`src/scraper.js`](../src/scraper.js).

### 4.1 Modifying Noise Cleaning
The DOM cleaner removes elements that match generic boilerplate selectors. To add custom element stripping:

```javascript
// In src/scraper.js -> cleanDom($)
const noiseSelectors = [
  'script', 'style', 'noscript', 'iframe', 'svg',
  'nav', 'header', 'footer', '.ad', '.ads', '.advertisement',
  '.cookie-banner', '.newsletter-signup', '.social-share',
  // Add your custom noise selectors:
  '.sponsored-widget', '#cookie-consent-modal'
];
$(noiseSelectors.join(', ')).remove();
```

### 4.2 Refining Content Root Scoring
`findBestContentRoot($)` calculates a composite score for candidate container tags (`<article>`, `<main>`, `<div id="content">`, etc.):

$$\text{Score} = (\text{TextLength} \times 1.0) + (\text{ParagraphCount} \times 50) - (\text{LinkTextRatio} \times 100)$$

To adjust weights or add new scoring factors (such as image density or header tag counts), modify `findBestContentRoot` in [`src/scraper.js`](../src/scraper.js).

---

## 5. Extending Crawlers & Spiders

The dual-frontier crawler lives in [`src/spider/topicCrawler.js`](../src/spider/topicCrawler.js).

### 5.1 Customizing Topic Relevance Heuristics
Topic matching is performed by `TopicMatcher` in [`src/spider/topicMatcher.js`](../src/spider/topicMatcher.js). It evaluates URL paths, slug tokens, anchor texts, and headline keywords.

To implement a custom topic rule:
```javascript
// src/spider/topicMatcher.js
isUrlRelevant(url, topicKeywords) {
  const parsed = new URL(url);
  const segments = parsed.pathname.toLowerCase().split(/[\/-]/);
  return topicKeywords.some(kw => segments.includes(kw.toLowerCase()));
}
```

### 5.2 Enhancing Pagination Detection
Pagination patterns are evaluated in [`src/spider/paginationEngine.js`](../src/spider/paginationEngine.js). It inspects:
- `rel="next"` `<link>` or `<a>` tags.
- URL query parameters (`?p=2`, `?page=2`, `?offset=20`).
- Path patterns (`/page/2/`, `/p/2`).

To support new pagination styles (e.g., cursor-based pagination query strings), append pattern regexes to `PaginationEngine.extractNextPageUrl()`.

---

## 6. Machine Learning & Adaptive Decision Trees

Scrapi uses CART decision trees in [`src/adaptive/decisionTree.js`](../src/adaptive/decisionTree.js) to classify:
1. **Fetcher Tier Selection**: Predicts whether a URL requires `static`, `dynamic`, or `stealth` fetching.
2. **Main Content Root Selection**: Classifies candidate DOM nodes as main article vs boilerplate.
3. **Topic Relevance**: Predicts link priority in the crawler frontier.

### 6.1 Inspecting Feature Vectors
Feature vectors are normalized arrays of numerical metrics:
```javascript
const featureVector = [
  urlLength,             // float
  pathDepth,             // int
  hasStructuredData,     // 0 or 1
  isKnownDynamicDomain,  // 0 or 1
  historicalFailureRate  // float [0.0 - 1.0]
];
```

### 6.2 Retraining Decision Trees
To update decision tree weights:
1. Collect training telemetry from `scrapi.db` (`scrapes` and `http_cache` tables).
2. Instantiate `DecisionTreeClassifier` with new training nodes or adjust tree splits in [`src/adaptive/decisionTree.js`](../src/adaptive/decisionTree.js).

---

## 7. Testing & Quality Assurance

### 7.1 Running All Test Suites
Scrapi contains 7 verified automated test suites covering unit tests, decision trees, spiders, and topic crawling:

```bash
npm test
```

### 7.2 Individual Test Suites
You can run any test suite individually:

```bash
node test_latest_methods.js   # Response adaptor, CSS, XPath, regex
node test_decision_tree.js    # ML CART classification tree
node test_scrapling_arch.js   # Core scraping pipeline
node test_spider.js           # Base spider and crawl frontier
node test_optimizations.js    # Noise cleaning and performance
node test_category_crawl.js   # Category-based article discovery
node test_topic_crawl.js      # Topic crawling and date filtering
```

### 7.3 Running Benchmarks
To run performance and throughput benchmarks:

```bash
npm run benchmark
# Or: node benchmark.js
```

---

## 8. Web UI Development

The web dashboard is built with React 18 and compiled using `esbuild`.

1. The source component is located at [`src/ui/app.jsx`](../src/ui/app.jsx).
2. To rebuild the production bundle after making modifications:
   ```bash
   npm run build:ui
   ```
3. This outputs [`src/ui/app.js`](../src/ui/app.js) which is statically served by Express in [`src/dashboard/server.js`](../src/dashboard/server.js).

---

## 9. Contribution Checklist

Before submitting code changes:
- [ ] Ensure **all 7 test suites pass** via `npm test`.
- [ ] Preserve Node.js 18 compatibility (`src/polyfill.js`).
- [ ] Do not add unneeded runtime dependencies; use native Node.js APIs whenever possible.
- [ ] Ensure any new database schemas or columns include migrations in [`src/db/sqliteStorage.js`](../src/db/sqliteStorage.js).
- [ ] If modifying the React dashboard, recompile via `npm run build:ui`.
