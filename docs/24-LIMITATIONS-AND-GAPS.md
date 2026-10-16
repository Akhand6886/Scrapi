# ⚠️ Scrapi v2.0: Limitations, Architectural Gaps & Known Issues

This document provides a realistic, code-accurate evaluation of the technical boundaries, architectural limitations, and known gaps in Scrapi v2.0. Understanding these boundaries helps developers choose the right strategies and avoid misapplying the framework.

---

## 1. Architectural Boundaries

### 1.1 Single-Node Process Memory Architecture
* **Implementation Reality**: The crawling frontiers (`discoveryQueue` and `articleQueue` in [`src/spider/topicCrawler.js`](../src/spider/topicCrawler.js)) reside in Node.js process memory.
* **Limitation**: Scrapi is a single-node, single-process framework. It does not integrate distributed message queues (e.g., Redis, RabbitMQ, or Apache Kafka).
* **Impact**: You cannot split a single crawl job across multiple physical worker machines out-of-the-box. Crawling at internet-scale (millions of pages daily) requires manually partitioning seed domains across separate machine instances.

---

### 1.2 SQLite Single-Writer Concurrency Ceiling
* **Implementation Reality**: Storage uses `better-sqlite3` in Write-Ahead Logging (WAL) mode ([`src/db/sqliteStorage.js`](../src/db/sqliteStorage.js)).
* **Limitation**: While WAL mode allows multiple concurrent readers, SQLite enforces a **single-writer lock**.
* **Impact**: Very high concurrency (e.g., $>50$ concurrent worker threads writing large HTML bodies simultaneously) may encounter lock contention or `SQLITE_BUSY` warnings. Scrapi is optimized for vertical concurrency up to $\sim 10\text{--}20$ parallel workers per instance.

---

## 2. Extraction & Anti-Bot Boundaries

### 2.1 Interactive Visual CAPTCHAs
* **Implementation Reality**: [`src/fetcher/stealthy.js`](../src/fetcher/stealthy.js) bypasses passive bot detection (TLS fingerprinting, navigator flags, WebGL spoofing, natural cursor movements).
* **Limitation**: Scrapi does **not** include an automated OCR or interactive puzzle solver for hard CAPTCHA barriers (such as Google reCAPTCHA v2 image grids, GeeTest sliders, or Arkose Labs challenges).
* **Impact**: If a website explicitly blocks access until a user manually solves an interactive image puzzle, Scrapi will fail the request after its timeout expires.

---

### 2.2 Infinite Scroll Without URL Mutation
* **Implementation Reality**: [`src/spider/paginationEngine.js`](../src/spider/paginationEngine.js) discovers next pages via URL parameters (`?page=2`, `?p=2`), path segments (`/page/2/`), and HTML `rel="next"` links.
* **Limitation**: Infinite-scroll pages that load content exclusively via internal JavaScript AJAX/GraphQL events without altering the URL or rendering standard pagination links cannot be automatically traversed by the static or base spider tiers.
* **Impact**: For custom single-page infinite-scroll apps, custom Playwright scrolling scripts must be written.

---

### 2.3 Closed Shadow DOM & Cross-Origin Iframes
* **Implementation Reality**: Scrapi's core parsing engine uses Cheerio ([`src/parser/response.js`](../src/parser/response.js)) to parse static DOM trees.
* **Limitation**: Cheerio operates on the initial static HTML string. It cannot pierce closed Shadow DOM roots or fetch contents of cross-origin `<iframe>` tags embedded on the page.
* **Impact**: Content rendered inside third-party embedded frames (such as certain comment sections or paywall widgets) is omitted from the extracted Markdown.

---

### 2.4 Non-HTML Binary Documents
* **Implementation Reality**: Scrapi is an HTML, XHTML, and XML scraper.
* **Limitation**: It does not parse or OCR binary documents such as PDFs, Microsoft Word (`.docx`), Excel spreadsheets, or scanned image attachments.
* **Impact**: Links to PDF documents are captured and recorded as URLs, but their text is not extracted into Markdown format.

---

## 3. Tooling & Integration Boundaries

### 3.1 Synchronous MCP Tool Timeouts on Large Crawls
* **Implementation Reality**: The Model Context Protocol (MCP) server exposes `topic_crawl` as a direct tool call ([`src/mcp/server.js`](../src/mcp/server.js)).
* **Limitation**: Most AI agent clients (Claude Desktop, Cursor) have a strict 60-second to 120-second timeout on tool executions.
* **Impact**: Triggering an exhaustive crawl of 1,000 articles via an MCP tool call will cause the AI client to report a timeout, even though the Node.js process continues running in the background.
* **Recommendation**: For AI assistant interactions, use `scrape_page` for single articles, or run large crawls via the terminal CLI and inspect results using `get_crawl_status`.

---

### 3.2 Machine Learning Model Telemetry Loop
* **Implementation Reality**: The CART Decision Trees in [`src/adaptive/decisionTree.js`](../src/adaptive/decisionTree.js) are initialized with pre-computed decision rules and split thresholds.
* **Limitation**: Although telemetry is logged to `scrapi.db`, there is currently no continuous background auto-retraining daemon running in production. Tree weights remain static until updated.

---

## 4. Feature Implementation Matrix

| Feature | Status | Notes |
|---|---|---|
| Static HTTP Scraping | ✅ **Fully Implemented** | Axios + Keep-Alive connection pooling. |
| Dynamic Headless Rendering | ✅ **Fully Implemented** | Playwright Chromium with network idle triggers. |
| Anti-Detection Fingerprinting | ✅ **Fully Implemented** | Spoofed navigator, WebGL, canvas, and headers. |
| Interactive CAPTCHA Solver | ❌ **Not Implemented** | Requires third-party OCR / human solver API. |
| 64-bit SimHash Self-Healing | ✅ **Fully Implemented** | Bitwise SimHash with Hamming distance threshold. |
| Dual-Frontier Topic Crawling | ✅ **Fully Implemented** | Decoupled discovery and article queues. |
| Distributed Spider Cluster | ❌ **Not Implemented** | Requires Redis/Kafka queue infrastructure. |
| XML Sitemap Discovery | ✅ **Fully Implemented** | Sitemap index recursion and gzip decompression. |
| PDF/Binary Text OCR | ❌ **Not Implemented** | Extracts URLs only; no internal PDF parser. |
| Local SQLite Storage | ✅ **Fully Implemented** | Synchronous WAL mode via `better-sqlite3`. |
| Web Dashboard & Visual Picker | ✅ **Fully Implemented** | Express backend + React 18 frontend + iframe proxy. |
| MCP AI Integration | ✅ **Fully Implemented** | Standard JSON-RPC stdio server with 4 tools. |
