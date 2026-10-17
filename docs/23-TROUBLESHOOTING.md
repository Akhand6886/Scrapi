# 🩺 Scrapi v2.0: Troubleshooting & Diagnostics

This document provides a systematic diagnostic guide for resolving common errors, runtime failures, and unexpected behaviors encountered when using or extending Scrapi v2.0.

---

## 1. Quick Diagnostic Checklist

When encountering an unexpected failure, run this quick sequence:

1. **Verify dependencies and test suite**:
   ```bash
   npm test
   ```
2. **Test URL in the interactive REPL shell**:
   ```bash
   node src/cli.js shell https://example.com/target-page
   ```
3. **Inspect database records and error logs**:
   ```bash
   sqlite3 scrapi.db "SELECT id, url, status, error FROM scrapes ORDER BY id DESC LIMIT 5;"
   ```

---

## 2. Common Errors and Resolutions

### 2.1 `ReferenceError: File is not defined`
* **Symptom**: Node.js throws an unhandled reference exception during fetch or import:
  ```text
  ReferenceError: File is not defined
      at node_modules/undici/lib/fetch/file.js:12:1
  ```
* **Root Cause**: You are running Node.js 18.x, which does not define the global `File` object by default.
* **Relevant File**: [`src/polyfill.js`](../src/polyfill.js)
* **Resolution**:
  Ensure that [`src/polyfill.js`](../src/polyfill.js) is imported as the very first line of your entry script:
  ```javascript
  import './src/polyfill.js';
  import { Scraper } from './src/scraper.js';
  ```

---

### 2.2 `Executable doesn't exist at .../playwright/chromium...`
* **Symptom**: Dynamic or stealth scraping fails with:
  ```text
  browserType.launch: Executable doesn't exist at /Users/alpha/Library/Caches/ms-playwright/chromium-1155/chrome-mac/Chromium.app
  ```
* **Root Cause**: Playwright was installed via `npm install`, but the headless Chromium browser binaries have not been downloaded.
* **Relevant File**: [`src/fetchers/dynamic.js`](../src/fetchers/dynamic.js), [`src/fetchers/stealth.js`](../src/fetchers/stealth.js)
* **Resolution**:
  Run the Playwright CLI to download the required browser binaries:
  ```bash
  npx playwright install chromium
  ```

---

### 2.3 `Host system is missing dependencies to run browsers` (Linux / Docker)
* **Symptom**: On Linux environments (Ubuntu, Debian, Alpine), Playwright fails to launch Chromium:
  ```text
  browserType.launch: Host system is missing dependencies to run browsers.
  Missing libraries: libnss3.so, libasound.so.2, libxss.so.1
  ```
* **Root Cause**: The headless Linux OS lacks required shared C++ GUI and audio libraries.
* **Resolution**:
  Install system dependencies automatically using Playwright:
  ```bash
  npx playwright install-deps chromium
  ```
  Or on Ubuntu/Debian:
  ```bash
  sudo apt-get update && sudo apt-get install -y libnss3 libasound2 libxss1 libgbm1
  ```

---

### 2.4 HTTP 403 Forbidden or Cloudflare Turnstile Block
* **Symptom**: Scrape returns empty content or an error:
  ```text
  Scrape failed: Request failed with status code 403
  ```
  The HTML body contains phrases like *"Just a moment..."*, *"Checking your browser"*, or *"Cloudflare"*.
* **Root Cause**: The target website's Web Application Firewall (WAF) detected standard HTTP client headers (Axios/curl) and challenged the request.
* **Relevant Files**: [`src/fetchers/stealth.js`](../src/fetchers/stealth.js), [`src/fetchers/index.js`](../src/fetchers/index.js)
* **Resolution**:
  1. Switch to the **stealth** fetcher tier, which launches Chromium with randomized fingerprints, spoofed navigator properties, and realistic viewport sizes:
     ```bash
     node src/cli.js scrape https://target.com/article --stealth
     ```
  2. Increase inter-request delay to simulate human browsing:
     ```bash
     node src/cli.js scrape https://target.com/article --stealth --delay 2500
     ```

---

### 2.5 HTTP 429 Too Many Requests (Rate Limiting)
* **Symptom**: Requests initially succeed, but subsequent requests fail with `HTTP 429` or connection timeouts.
* **Root Cause**: High concurrency or zero delay triggered origin rate-limiting rules.
* **Relevant Files**: [`src/spiders/topic_crawler.js`](../src/spiders/topic_crawler.js), [`src/spiders/engine.js`](../src/spiders/engine.js)
* **Resolution**:
  1. Reduce concurrency:
     ```bash
     --concurrency 1
     ```
  2. Increase inter-request delay (in milliseconds):
     ```bash
     --delay 3000
     ```
  3. Enable HTTP caching so previously fetched pages are not requested again:
     ```bash
     --cache
     ```

---

### 2.6 Blank or Truncated Markdown Output
* **Symptom**: The scrape succeeds (`status: 200`), but the generated Markdown file is empty or only contains navigation text.
* **Root Causes**:
  1. **Client-Side Rendering**: The page is a Single Page Application (SPA). Content is rendered dynamically by JavaScript after initial HTML loads.
  2. **Over-Aggressive Noise Stripping**: The content container matched generic noise patterns (e.g., class names containing `ad`, `share`, or `comment`).
* **Relevant Files**: [`src/scraper.js`](../src/scraper.js), [`src/parser/markdown.js`](../src/parser/markdown.js)
* **Resolution**:
  1. Re-run with `--dynamic` so Playwright renders the DOM and waits for network idle:
     ```bash
     node src/cli.js scrape https://target.com/spa-post --dynamic
     ```
  2. Test specific selectors using the shell to verify if content exists:
     ```bash
     node src/cli.js shell https://target.com/spa-post
     > response.css('article').text
     ```

---

### 2.7 Crawler Missing Older Articles or Stopping Early
* **Symptom**: `topic-crawl` discovers only the first 10 or 20 articles and finishes without traversing historical archives.
* **Root Causes**:
  1. **Infinite Scroll / Dynamic AJAX Pagination**: The site loads older pages via AJAX instead of standard `<a>` tags with `href` links.
  2. **Strict Date Filter**: The `--since` date filter rejected pages lacking explicit ISO timestamp metadata.
  3. **Unmatched Topic Terms**: Articles do not contain the exact topic slug in their URL path or anchor text.
* **Relevant Files**: [`src/spiders/topic_crawler.js`](../src/spiders/topic_crawler.js), [`src/spiders/pagination.js`](../src/spiders/pagination.js), [`src/spiders/topic_matcher.js`](../src/spiders/topic_matcher.js)
* **Resolution**:
  1. Check if the site provides an XML sitemap:
     ```bash
     node src/cli.js sitemap https://target.com
     ```
  2. Inspect pagination patterns in [`src/spiders/pagination.js`](../src/spiders/pagination.js) to confirm page query parameter compatibility.
  3. Provide broader topic keywords:
     ```bash
     node src/cli.js topic-crawl https://target.com --topic "tech,ai,software"
     ```

---

### 2.8 `SqliteError: database is locked` (SQLITE_BUSY)
* **Symptom**: Database write operations throw `SqliteError: database is locked`.
* **Root Cause**: Multiple simultaneous CLI commands or processes are attempting uncoordinated writes to `scrapes.db` without WAL mode enabled, or an external SQLite browser holds an open write transaction.
* **Relevant File**: [`src/storage.js`](../src/storage.js)
* **Resolution**:
  1. Verify Write-Ahead Logging (WAL) is enabled:
     ```bash
     sqlite3 data/scrapes.db "PRAGMA journal_mode;"
     # Output should be: wal
     ```
  2. Close any external SQLite desktop GUI applications (e.g., DB Browser for SQLite) that may be locking the file.
  3. In [`src/storage.js`](../src/storage.js), verify that `db.pragma('busy_timeout = 5000');` is configured (default in Scrapi v2.0).

---

### 2.9 High Memory Consumption During Deep Crawls
* **Symptom**: Node.js memory usage climbs significantly during continuous crawls of $>10,000$ pages.
* **Root Cause**: In-memory storage of visited URL Sets or SQLite WAL file accumulating uncheckpointed pages.
* **Relevant Files**: [`src/spiders/topic_crawler.js`](../src/spiders/topic_crawler.js), [`src/storage.js`](../src/storage.js)
* **Resolution**:
  1. Force an SQLite WAL checkpoint to disk:
     ```bash
     sqlite3 data/scrapes.db "PRAGMA wal_checkpoint(TRUNCATE);"
     ```
  2. Segment very large crawls by topic or subcategory rather than running unconstrained whole-domain sweeps.
  3. Increase Node.js heap ceiling if performing massive concurrent batch jobs:
     ```bash
     node --max-old-space-size=4096 src/cli.js topic-crawl <url> --topic <topic>
     ```

---

## 3. Diagnostic Commands Summary

| Task | Command |
|---|---|
| Verify all test suites | `npm test` |
| Test DOM query in REPL | `node src/cli.js shell <url>` |
| Test stealth fetcher | `node src/cli.js scrape <url> --stealth` |
| Discover XML sitemaps | `node src/cli.js sitemap <url>` |
| Verify SQLite integrity | `sqlite3 scrapi.db "PRAGMA integrity_check;"` |
| Inspect recent crawl logs | `sqlite3 scrapi.db "SELECT * FROM spider_checkpoints ORDER BY updated_at DESC LIMIT 1;"` |
