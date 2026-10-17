# ⚠️ Scrapi v2.0: Limitations, Architectural Gaps & Known Issues

This document provides a realistic, code-accurate evaluation of the technical boundaries, architectural limitations, and known gaps in Scrapi v2.0. Understanding these boundaries helps developers choose the right strategies and avoid misapplying the framework.

---

## 1. Architectural Boundaries

### 1.1 Single-Node Process Memory Architecture
* **Implementation Reality**: The crawling frontiers (`discoveryQueue` and `articleQueue` in [`src/spiders/topic_crawler.js`](../src/spiders/topic_crawler.js) and [`src/spiders/engine.js`](../src/spiders/engine.js)) reside in Node.js process memory.
* **Limitation**: Scrapi is a single-node, single-process framework. It does not integrate distributed message queues (e.g., Redis, RabbitMQ, or Apache Kafka).
* **Impact**: You cannot split a single crawl job across multiple physical worker machines out-of-the-box. Crawling at internet-scale (millions of pages daily) requires manually partitioning seed domains across separate machine instances.

---

### 1.2 SQLite Single-Writer Concurrency Ceiling & Recovery
* **Implementation Reality**: Storage uses `better-sqlite3` in Write-Ahead Logging (WAL) mode ([`src/storage.js`](../src/storage.js)).
* **Resilience Measures Added**:
  - `busy_timeout = 5000` to buffer concurrent write spikes and prevent immediate `SQLITE_BUSY` crashes.
  - `synchronous = NORMAL` for durable, high-throughput writes.
  - Automatic corruption recovery: checks `quick_check` on launch, backs up damaged files to `scrapes.db.corrupt.<timestamp>`, and transparently re-initializes a fresh database.
* **Limitation**: While WAL mode allows multiple concurrent readers, SQLite enforces a **single-writer lock**.
* **Impact**: Very high concurrency (e.g., $>50$ concurrent worker threads writing large HTML bodies simultaneously) may encounter lock contention or timeout delays. Scrapi is optimized for vertical concurrency up to $\sim 10\text{--}20$ parallel workers per instance.

---

## 2. Extraction & Anti-Bot Boundaries

### 2.1 Interactive Visual CAPTCHAs
* **Implementation Reality**: [`src/fetchers/stealth.js`](../src/fetchers/stealth.js) bypasses passive bot detection (TLS fingerprinting, navigator flags, WebGL spoofing, natural cursor movements) and auto-clicks Cloudflare Turnstile checkboxes.
* **Limitation**: Scrapi does **not** include an automated OCR or interactive puzzle solver for hard CAPTCHA barriers (such as Google reCAPTCHA v2 image grids, GeeTest sliders, or Arkose Labs challenges).
* **Impact**: If a website explicitly blocks access until a user manually solves an interactive image puzzle, Scrapi will fail the request after its timeout expires.

---

### 2.2 Infinite Scroll Without URL Mutation
* **Implementation Reality**: [`src/spiders/pagination.js`](../src/spiders/pagination.js) discovers next pages via URL parameters (`?page=2`, `?p=2`), path segments (`/page/2/`), and HTML `rel="next"` links.
* **Limitation**: Infinite-scroll pages that load content exclusively via internal JavaScript AJAX/GraphQL events without altering the URL or rendering standard pagination links cannot be automatically traversed by the static or base spider tiers.
* **Impact**: For custom single-page infinite-scroll apps, custom Playwright scrolling scripts must be written.

---

### 2.3 Closed Shadow DOM & Cross-Origin Iframes
* **Implementation Reality**: Scrapi's core parsing engine uses Cheerio ([`src/parser/adaptor.js`](../src/parser/adaptor.js)) to parse static DOM trees.
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
* **Recommendation**: For AI assistant interactions, use `scrapi_fetch` or `scrapi_extract` for single articles, or run large crawls via the terminal CLI and inspect results using SQLite queries.

---

### 3.2 Machine Learning Model Telemetry Loop
* **Implementation Reality**: The CART Decision Trees in [`src/trees/engine.js`](../src/trees/engine.js) are initialized with pre-computed decision rules and split thresholds. The Bayesian Thompson Sampling Multi-Armed Bandit ([`src/trees/bandit.js`](../src/trees/bandit.js)) learns domain success distributions and stores priors in SQLite (`bandit_domain_priors`).
* **Limitation**: While bandit priors update dynamically per domain, the underlying CART decision tree split thresholds remain static until updated in code.

---

## 4. Feature Implementation Matrix

| Subsystem | Feature | Status | Implementation Details |
|---|---|---|---|
| **Fetchers** | Static HTTP Scraping | ✅ **Fully Implemented** | Axios with Keep-Alive connection pooling & HTTP cache ([`src/fetchers/static.js`](../src/fetchers/static.js)) |
| **Fetchers** | Dynamic Headless Rendering | ✅ **Fully Implemented** | Playwright Chromium with network idle triggers ([`src/fetchers/dynamic.js`](../src/fetchers/dynamic.js)) |
| **Fetchers** | Anti-Detection Fingerprinting | ✅ **Fully Implemented** | Spoofed navigator, WebGL, canvas, and Turnstile auto-solving ([`src/fetchers/stealth.js`](../src/fetchers/stealth.js)) |
| **Fetchers** | Interactive CAPTCHA Solver | ❌ **Not Implemented** | Requires third-party OCR / human solver API |
| **Parser** | Scrapling Adaptor & Selectors | ✅ **Fully Implemented** | Cheerio DOM, CSS & XPath emulation, text filtering ([`src/parser/adaptor.js`](../src/parser/adaptor.js), [`src/parser/selector.js`](../src/parser/selector.js)) |
| **Parser** | 64-bit SimHash Self-Healing | ✅ **Fully Implemented** | Bitwise SimHash with Hamming distance threshold ([`src/parser/simhash.js`](../src/parser/simhash.js), [`src/parser/adaptive.js`](../src/parser/adaptive.js)) |
| **Parser** | Rich Metadata & Date Normalization | ✅ **Fully Implemented** | JSON-LD, OpenGraph, `<time>`, regex slug fallback ([`src/parser/adaptor.js`](../src/parser/adaptor.js)) |
| **Spiders** | Dual-Frontier Topic Crawling | ✅ **Fully Implemented** | Decoupled discovery & article queues with date coverage tracking ([`src/spiders/topic_crawler.js`](../src/spiders/topic_crawler.js), [`src/spiders/engine.js`](../src/spiders/engine.js)) |
| **Spiders** | Missing-Link & 404 Fallback | ✅ **Fully Implemented** | Seed URL fallback recovery on broken/empty speculative entrypoints ([`src/spiders/engine.js`](../src/spiders/engine.js)) |
| **Spiders** | Multi-Anchor Card Resolution | ✅ **Fully Implemented** | Heading priority & container link inspection ([`src/spiders/topic_matcher.js`](../src/spiders/topic_matcher.js)) |
| **Spiders** | Pagination & Sitemap Discovery | ✅ **Fully Implemented** | Rel="next", numbered pages, subcategories, archives, XML sitemaps ([`src/spiders/pagination.js`](../src/spiders/pagination.js), [`src/spiders/sitemap.js`](../src/spiders/sitemap.js)) |
| **Spiders** | Distributed Spider Cluster | ❌ **Not Implemented** | Requires Redis/Kafka queue infrastructure |
| **Storage** | SQLite Persistence & WAL | ✅ **Fully Implemented** | Better-sqlite3 in WAL mode with `busy_timeout=5000` ([`src/storage.js`](../src/storage.js)) |
| **Storage** | SQLite Corruption Auto-Recovery | ✅ **Fully Implemented** | Integrity checking with timestamped corrupt file backups and auto-reinit ([`src/storage.js`](../src/storage.js)) |
| **Storage** | Checkpoint Resume | ✅ **Fully Implemented** | JSON serialization of dual queues in `spider_checkpoints` ([`src/storage.js`](../src/storage.js)) |
| **ML & Trees** | Autonomous Tier Routing | ✅ **Fully Implemented** | Static vs Dynamic vs Stealth routing trees ([`src/trees/tier_router.js`](../src/trees/tier_router.js)) |
| **ML & Trees** | Thompson Sampling Bandit | ✅ **Fully Implemented** | Bayesian Beta-distribution online learning stored in SQLite ([`src/trees/bandit.js`](../src/trees/bandit.js)) |
| **UI** | Web Dashboard & Visual Picker | ✅ **Fully Implemented** | Express backend + React frontend + iframe proxy ([`src/ui/server.js`](../src/ui/server.js)) |
| **AI** | MCP AI Integration | ✅ **Fully Implemented** | Standard JSON-RPC stdio server with tools ([`src/mcp/server.js`](../src/mcp/server.js)) |
| **AI** | LLM Structured Extraction | ⚠️ **Requires API Key** | Anthropic Claude API client with Zod schemas; falls back when key absent ([`src/llm.js`](../src/llm.js)) |
