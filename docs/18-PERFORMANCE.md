# ⚡ Performance & Optimization: Scrapi v2.0

## 1. Architectural Performance Principles

Scrapi v2.0 is engineered for high throughput while maintaining strict memory and resource bounds on local developer environments:

1. **Sub-150ms Static Scraping**: Server-rendered content is scraped without browser overhead.
2. **Shared Browser Reuse**: Headless Playwright instances are launched once and reused across tasks.
3. **Consolidated DOM Cleanup**: Noise tags are stripped in a single Cheerio query pass rather than chained iterations.
4. **Conditional Caching**: Bandwidth and latency are saved by reusing local HTML bodies on HTTP 304.
5. **WAL SQLite Indexing**: Sub-millisecond URL lookups via indexed B-trees.

---

## 2. Benchmark Numbers & Validation

Performance metrics measured by [`src/benchmark/`](../src/benchmark/) and verified in [`test_optimizations.js`](../test_optimizations.js):

| Metric | StaticFetcher | DynamicFetcher | StealthyFetcher |
|---|---|---|---|
| **Cold Start Latency** | $\sim 90\text{ms}$ | $\sim 850\text{ms}$ | $\sim 1400\text{ms}$ |
| **Warm Page Latency** | $\sim 45\text{ms}$ | $\sim 250\text{ms}$ | $\sim 650\text{ms}$ |
| **Throughput (Concurrency: 4)** | $45\text{ pages/sec}$ | $8\text{ pages/sec}$ | $3\text{ pages/sec}$ |
| **Memory per Task** | $\sim 12\text{MB}$ | $\sim 180\text{MB}$ | $\sim 240\text{MB}$ |

---

## 3. Key Optimization Mechanisms

### 3.1 Consolidated DOM Cleaning (~1.5x Speedup)
In early scraper implementations, noise elements were removed with multiple individual Cheerio calls:
```javascript
// Legacy Slow Approach: Multiple sequential traversals
$('nav').remove();
$('header').remove();
$('footer').remove();
$('script').remove();
// ... 8 more calls
```
Scrapi v2.0 consolidates this into a single compiled selector pass in [`cleanDom()`](../src/scraper.js) and [`Response.cleanDom()`](../src/parser/adaptor.js):
```javascript
// Optimized Single-Pass
$(NOISE_SELECTORS.join(', ')).remove();
```
*Verification*: Tested in [`test_optimizations.js`](../test_optimizations.js), reducing Cheerio DOM cleaning execution time from $3.12\text{ms}$ to $2.07\text{ms}$ per document ($\sim 1.5\times$ performance boost).

---

### 3.2 HTTP Keep-Alive & Connection Pooling
In [`src/fetchers/static.js`](../src/fetchers/static.js), persistent agents maintain active TCP and TLS sessions across HTTP requests:
```javascript
this.httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
this.httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });
```
This saves $50\text{ms}$–$150\text{ms}$ of TLS handshake latency on every subsequent request to the same domain.

---

### 3.3 Conditional Caching (ETag / If-Modified-Since)
When requesting pages repeatedly:
1. `StaticFetcher` retrieves stored headers from SQLite `http_cache`.
2. Sends `If-None-Match: <etag>` and `If-Modified-Since: <last_modified>`.
3. If the server responds with `304 Not Modified`, the local cached body is returned in $<1\text{ms}$ with zero network transfer.

---

### 3.4 Shared Browser Context Lifecycle
Launching a new Chromium process on every request takes $\ge 800\text{ms}$ and consumes heavy CPU. In [`src/fetchers/dynamic.js`](../src/fetchers/dynamic.js):
- A single `sharedBrowser` process is initialized on first demand.
- Individual requests create and close lightweight browser pages (`await page.close()`).
- Memory remains bounded without zombie Chrome processes.

---

### 3.5 SQLite Write-Ahead Logging & Query Indexing
In [`src/storage.js`](../src/storage.js):
- **WAL Mode (`journal_mode = WAL`)**: Allows concurrent reads while writes are occurring without database locks.
- **URL Index (`idx_scrapes_url`)**: Indexes `scrapes(url)`:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_scrapes_url ON scrapes(url);
  ```
  During exhaustive crawling, checking `isUrlScraped(url)` runs in $<0.2\text{ms}$, preventing queue lookups from degrading as the database grows to thousands of records.
