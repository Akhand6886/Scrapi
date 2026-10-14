# 🥊 BeautifulSoup (BS4) vs. Scrapi (v2.0)

A comprehensive architectural and performance comparison between **BeautifulSoup (BS4)** and **Scrapi (v2.0)**.

---

## 📊 Quick Comparison Matrix

| Feature / Dimension | BeautifulSoup (BS4) | Scrapi (v2.0 / Scrapling Architecture) |
| :--- | :--- | :--- |
| **Primary Scope** | HTML/XML DOM parser library only | Full end-to-end web scraping & crawling framework |
| **HTTP Fetching** | ❌ None (Requires `requests`, `httpx`, or `urllib`) | ✅ Built-in **`StaticFetcher`** (Keep-alive, TLS headers, ETag caching) |
| **JavaScript / SPA Rendering** | ❌ None (Requires external Selenium / Playwright setup) | ✅ Built-in **`DynamicFetcher`** (Headless Playwright browser automation) |
| **Anti-Bot & Turnstile Bypass** | ❌ None | ✅ Built-in **`StealthyFetcher`** (`navigator.webdriver` masking, Turnstile bypass) |
| **Selector Resilience** | ⚠️ **Brittle** (Fails if CSS classes or DOM structure changes) | 🛡️ **Adaptive & Self-Healing** (Multi-anchor fingerprints auto-relocate elements) |
| **Query Engine** | CSS selectors & Python methods (`find`, `find_all`) | CSS, XPath (`evaluateXPath`), Regex (`.re()`), text filters, and chaining |
| **Spider & Crawling Engine** | ❌ None (Must build custom loops or use Scrapy) | ✅ Built-in **`CrawlEngine`** with BFS/DFS queues, auto-throttling & pause/resume |
| **Markdown & LLM Readiness** | ❌ Manual string extraction required | ✅ Native GFM Markdown conversion, frontmatter, and sidecar JSON metadata |
| **AI / Agent Integration** | ❌ None | ✅ Built-in **MCP Server** (`scrapi mcp`) for Claude, Cursor, and Antigravity |
| **Interface & Tooling** | Code-only library | CLI commands (`scrape`, `crawl`, `shell`), REPL console, and Visual Web UI |
| **Runtime & Performance** | Python (synchronous, CPU-heavy DOM tree construction) | Node.js / V8 (asynchronous non-blocking I/O, connection pooling) |

---

## 🔍 Deep Dive Breakdown

### 1. "Parser Only" vs "All-in-One Framework"
* **BeautifulSoup**: BS4 is strictly a DOM parser. To build a functioning scraper, you must manually glue multiple disparate libraries together:
  $$\text{Requests / Httpx} \longrightarrow \text{BeautifulSoup} \longrightarrow \text{Custom Regex / File logic} \longrightarrow \text{Database driver}$$
* **Scrapi**: Unifies the entire pipeline into one cohesive framework. With a single method call or CLI command, it handles request retries, browser rendering, anti-bot evasion, parsing, SQLite storage, and media asset downloading.

### 2. Selector Brittleness vs Adaptive Self-Healing
* **BeautifulSoup**: If a website updates its design or changes `.post-body-v1` to `.article_content_x9`, BeautifulSoup throws `AttributeError: 'NoneType' object has no attribute 'text'`.
* **Scrapi**: Uses `AdaptiveEngine` to compute multi-anchor element fingerprints (DOM hierarchy, text snippets, parent alignment, text-to-tag ratio). When the site structure changes, Scrapi automatically relocates the element and logs the dynamic recovery.

### 3. Static vs Dynamic vs Stealth Fetching
* **BeautifulSoup**: Cannot scrape single-page applications (React/Vue/Angular) or Cloudflare-protected sites without separate browser automation tools.
* **Scrapi**: Provides progressive 3-tier fetching via `FetcherPool`:
  1. `static`: Ultra-fast HTTP client for standard pages.
  2. `dynamic`: Playwright browser automation for JavaScript rendering.
  3. `stealth`: Advanced anti-fingerprinting evasion for bot-protected pages.

### 4. AI & Modern Agentic Workflows
* **BeautifulSoup**: Raw HTML extraction often overflows LLM token windows due to boilerplate scripts, headers, footers, and inline styles.
* **Scrapi**: Features a built-in **Model Context Protocol (MCP)** server (`scrapi mcp`) that passes token-efficient clean Markdown and structured schema outputs directly to AI assistants.

---

## 💡 Summary: When to Use Which?

* **Use BeautifulSoup** if: You are writing a quick one-off Python script, already have raw HTML files on disk, and only need basic tag extraction.
* **Use Scrapi** if: You need a robust, production-grade scraping pipeline with JavaScript execution, anti-bot evasion, self-healing selectors, site spidering, interactive CLI/UI tools, or AI agent integration.
