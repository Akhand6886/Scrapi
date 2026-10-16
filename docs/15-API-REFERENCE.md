# 📚 Programmatic API Reference: Scrapi v2.0

All primary modules are exported from the main entrypoint:
```javascript
import {
  // Fetchers
  fetch,
  fetchDynamic,
  fetchStealth,
  globalFetcherPool,
  FetcherPool,
  closeAllFetchers,

  // Parser & Selectors
  Response,
  SelectorList,
  AdaptorElement,
  createAdaptor,
  normalizeDate,
  AdaptiveEngine,
  SimHash,

  // Spiders & Crawling
  CrawlEngine,
  TopicCrawler,
  runTopicCrawl,
  runSpider,
  Spider,
  PaginationEngine,
  SitemapEngine,
  TopicMatcher,

  // Storage
  initStorage,
  insertScrape,
  getAllScrapes,
  getScrapeById,
  getScrapeByUrl,
  isUrlScraped,
  saveMarkdownFile,

  // Scraper & Discovery
  scrapePage,
  fetchHtml,
  cleanDom,
  discoverCategories,
  autoDetectLinkSelector,

  // Machine Learning
  TierRouterTree,
  ContentExtractorTree,
  CrawlPriorityTree,
  globalBandit
} from 'scrapi';
```

---

## 1. Fetcher APIs

### `fetch(url, options)`
Fetches a URL using the progressive multi-tier pool with auto-escalation.
- **Parameters**:
  - `url` *(string)*: Target website URL.
  - `options` *(object, optional)*: `{ fetcher: 'auto'|'static'|'dynamic'|'stealth', timeout: 15000, noCache: false }`.
- **Returns**: `Promise<Response>`.
- **Example**:
  ```javascript
  const response = await fetch('https://example.com');
  console.log(response.css('h1').text);
  ```

### `fetchDynamic(url, options)`
Directly fetches a URL using Playwright Chromium.
- **Returns**: `Promise<Response>`.

### `fetchStealth(url, options)`
Directly fetches a URL using anti-bot evasion and Cloudflare Turnstile auto-solving.
- **Returns**: `Promise<Response>`.

### `closeAllFetchers()`
Terminates shared browser instances and closes open pools.
- **Returns**: `Promise<void>`.

---

## 2. Parser & Response APIs

### `class Response` ([`src/parser/adaptor.js`](../src/parser/adaptor.js))
Unified response wrapper returned by all fetchers.
- **Properties**:
  - `url` *(string)*: Requested URL.
  - `status` *(number)*: HTTP status code.
  - `headers` *(object)*: Response headers.
  - `rawHtml` *(string)*: Unparsed HTML text.
  - `fetcher` *(string)*: Fetcher tier used.
  - `timing` *(number)*: Request latency in ms.
  - `$` *(Cheerio)*: Cheerio instance with noise scripts stripped.
  - `fullDom` *(Cheerio)*: Full Cheerio instance preserving `<script type="application/ld+json">`.
- **Methods**:
  - `css(selector)` ➔ `SelectorList`
  - `xpath(xpathQuery)` ➔ `SelectorList`
  - `cleanDom()` ➔ `this`
  - `resolveUrls()` ➔ `this`
  - `extractMetadata()` ➔ `object`
  - `toMarkdown(options)` ➔ `{ markdown, metadata, media, frontmatter }`
  - `extractEntities(options)` ➔ `{ entities, detectedType, confidence }`
  - `adaptive(selectorOrSignature)` ➔ `{ element, healed, confidence, selector }`

### `normalizeDate(rawDate, url)`
Standardizes raw date strings, ISO timestamps, or URL date slugs to `YYYY-MM-DD`.
- **Parameters**: `rawDate` *(string|null)*, `url` *(string, optional)*.
- **Returns**: `{ dateStr: string|null, rawDate: string|null }`.

---

## 3. Crawling & Spidering APIs

### `runTopicCrawl(websiteUrl, topicName, options, onProgress)`
Executes an exhaustive topic crawl from earliest available publication to the present.
- **Parameters**:
  - `websiteUrl` *(string)*: Starting URL.
  - `topicName` *(string)*: Topic or category name (e.g. `'Analysis'`).
  - `options` *(object)*: `{ concurrency: 2, delay: 1000, sitemap: true, output: './output' }`.
  - `onProgress` *(function)*: Callback receiving `{ type, message, stats }`.
- **Returns**: `Promise<object>` containing `visited`, `succeeded`, `failed`, `skippedExisting`, and `dateCoverage`.
- **Example**:
  ```javascript
  const result = await runTopicCrawl('https://example.com', 'Analysis', {
    concurrency: 2,
    delay: 500
  }, (evt) => {
    if (evt.type === 'log') console.log(evt.message);
  });
  console.log(`Discovered date range: ${result.dateCoverage.earliestDate} to ${result.dateCoverage.latestDate}`);
  ```

### `runSpider(seedUrl, options, onProgress)`
Recursively spiders an entire website under the same origin.
- **Parameters**:
  - `seedUrl` *(string)*: Starting URL.
  - `options` *(object)*: `{ maxPages: 100, depth: 3, concurrency: 2, delay: 1500 }`.
  - `onProgress` *(function)*: Callback receiving status events.
- **Returns**: `Promise<object>`.

### `class TopicCrawler` ([`src/spiders/topic_crawler.js`](../src/spiders/topic_crawler.js))
Class orchestrating topic entrypoint resolution and exhaustive crawl execution.
- **Methods**:
  - `resolveTopicEntrypoint(websiteUrl, topicName)` ➔ `Promise<string>`
  - `crawl(websiteUrl, topicName, onProgress)` ➔ `Promise<object>`

### `class CrawlEngine` ([`src/spiders/engine.js`](../src/spiders/engine.js))
Core dual-frontier crawler engine.
- **Constructor Options**: `{ topic, category, maxPages, depth, concurrency, delay, resume, jobId, output }`.
- **Methods**:
  - `crawl(seedOrSpider, onProgress)` ➔ `Promise<object>`
  - `saveCheckpoint(seedUrl)` ➔ `void`
  - `resumeFromCheckpoint(jobId)` ➔ `boolean`

---

## 4. Storage APIs ([`src/storage.js`](../src/storage.js))

### `initStorage(dbDir, outputDir)`
Initializes the SQLite database schema, indexes, and output directory.
- **Parameters**: `dbDir` *(default: `'./data'`)*, `outputDir` *(default: `'./output'`)*.
- **Returns**: `Promise<void>`.

### `insertScrape(record)`
Inserts or updates a scrape row in SQLite table `scrapes`.
- **Parameters**: `record` *(object)*: `{ url, title, description, filename, word_count, scraped_at, selector, status, category }`.
- **Returns**: `object` (Database run result).

### `isUrlScraped(url)`
Checks if a URL has already been successfully scraped in SQLite.
- **Parameters**: `url` *(string)*.
- **Returns**: `boolean`.

### `getAllScrapes(category)`
Queries historical scrape records from SQLite with optional category filtering.
- **Parameters**: `category` *(string, optional)*.
- **Returns**: `Array<object>`.

### `saveMarkdownFile(markdown, metadata, options)`
Saves formatted Markdown content and sidecar JSON metadata to disk under hierarchical domain subfolders.
- **Parameters**:
  - `markdown` *(string)*: Markdown body.
  - `metadata` *(object)*: Document metadata.
  - `options` *(object)*: `{ output: './output', subdir: 'domain/path', filename: 'slug' }`.
- **Returns**: `Promise<string>` (Relative file path).

---

## 5. Machine Learning & Bandit APIs (`src/trees/`)

### `globalBandit` ([`src/trees/bandit.js`](../src/trees/bandit.js))
Global Thompson Sampling multi-armed bandit instance.
- **Methods**:
  - `selectArm(domain)` ➔ `'static' | 'dynamic' | 'stealth'`
  - `recordResult(domain, arm, success)` ➔ `void`
  - `shouldBypassProbe(domain)` ➔ `boolean`
  - `getPriors(domain)` ➔ `object`
