# 🌟 Project Overview: Scrapi v2.0

## 1. Project Purpose

**Scrapi v2.0** is an adaptive, high-throughput web scraping, crawling, and content extraction engine developed in Node.js. It addresses the fundamental fragility of traditional web scraping tools:

1. **Static vs. Dynamic Brittleness**: Simple HTTP clients fail on modern Single Page Applications (SPAs) like React, Vue, or Next.js, while headless browser automation (Puppeteer, Playwright) is too resource-heavy to run across thousands of static pages. Scrapi solves this through an adaptive multi-tier fetcher pool guided by machine-learning decision trees.
2. **Selector Breakage**: Minor DOM modifications and redesigns break hardcoded CSS selectors. Scrapi solves this with 64-bit SimHash locality-sensitive fingerprinting that auto-heals broken anchors.
3. **Incomplete Crawls**: Standard crawlers terminate prematurely due to arbitrary pagination limits or lose their place when following article links. Scrapi solves this with a persistent, dual-frontier crawl engine that systematically discovers every article under a topic from its earliest publication date to the present.
4. **Anti-Bot Defenses**: Modern sites deploy Cloudflare Turnstile, PerimeterX, and browser fingerprinting. Scrapi incorporates an anti-bot stealth fetcher and an online Bayesian multi-armed bandit that learns defense profiles.

---

## 2. Core Capabilities

### 2.1 Multi-Tier Progressive Fetching
- **Static HTTP Tier ([`src/fetchers/static.js`](../src/fetchers/static.js))**: Ultra-fast HTTP client leveraging connection pooling (HTTP Keep-Alive), automatic Brotli/Gzip decompression, conditional HTTP caching (`ETag` / `If-Modified-Since`), and randomized browser User-Agents.
- **Dynamic JS Tier ([`src/fetchers/dynamic.js`](../src/fetchers/dynamic.js))**: Headless Chromium instance managed via Playwright to render client-side JavaScript apps, auto-scroll infinite feeds, and await specific DOM selectors.
- **Stealth Evasion Tier ([`src/fetchers/stealth.js`](../src/fetchers/stealth.js))**: Specialized browser context that strips automated signatures (`navigator.webdriver`), simulates authentic plugin arrays, randomizes canvas/WebGL noise, and automates Cloudflare Turnstile challenge solving.
- **Adaptive Escalation ([`src/fetchers/index.js`](../src/fetchers/index.js))**: Automatically probes URLs with fast static requests and escalates to dynamic or stealth modes when client-side frameworks or anti-bot challenges are detected.

### 2.2 Machine Learning Decision Trees & Reinforcement Learning
- **Tier Router Tree ([`src/trees/tier_router.js`](../src/trees/tier_router.js))**: A 61-node CART decision tree that routes incoming HTML documents to `STATIC`, `DYNAMIC`, or `STEALTH` based on script-to-content ratios, SPA markers, and anti-bot challenge signatures.
- **Content Extractor Tree ([`src/trees/content_extractor.js`](../src/trees/content_extractor.js))**: Evaluates DOM nodes using text-to-tag ratios, link density, tag weights, and class semantics to isolate `MAIN_CONTENT` from navigation, sidebars, and ads.
- **Crawl Priority Tree ([`src/trees/crawl_prioritizer.js`](../src/trees/crawl_prioritizer.js))**: Rates discovered URLs on a 0–100 scale to prioritize high-value content over utility paths or tracking parameters.
- **Bayesian Multi-Armed Bandit ([`src/trees/bandit.js`](../src/trees/bandit.js))**: Uses Thompson Sampling over Beta distributions to learn which fetcher tier succeeds on a given domain, bypassing redundant static probe calls once confidence exceeds 85%.

### 2.3 Resilient Parsing & Self-Healing
- **Unified `Response` Adaptor ([`src/parser/adaptor.js`](../src/parser/adaptor.js))**: Consistent API providing `.css()`, `.xpath()`, `.toMarkdown()`, and `.extractMetadata()` across all fetcher tiers.
- **Adaptive Self-Healing Engine ([`src/parser/adaptive.js`](../src/parser/adaptive.js))**: Uses 64-bit SimHash DOM fingerprints ([`src/parser/simhash.js`](../src/parser/simhash.js)) to calculate Hamming distances across DOM elements, relocating target nodes even after significant layout redesigns.
- **Unsupervised Pattern Induction ([`src/parser/cluster_extractor.js`](../src/parser/cluster_extractor.js))**: Detects repeating card patterns (products, articles, listings) without manual selector definitions.

### 2.4 Exhaustive Topic-Based Crawling
- **Dual-Frontier Architecture ([`src/spiders/engine.js`](../src/spiders/engine.js))**: Strictly separates `discoveryQueue` (listings, subcategories, numbered pagination, archives) from `articleQueue` (content extraction), ensuring complete category coverage without traversal interruption.
- **Dynamic Date Tracking**: Reads publication dates from JSON-LD schema, HTML5 `<time>`, OpenGraph meta tags, and URL date slugs, computing date ranges (`earliestDate` ➔ `latestDate`) from earliest available historical records to the present.
- **Persistent State & Incremental Deduplication**: SQLite checkpoints save queue states for crash recovery (`--resume`). Fast SQLite indexing (`idx_scrapes_url`) skips previously scraped articles during re-crawls.

### 2.5 Multi-Interface Delivery
- **CLI Commands ([`src/cli.js`](../src/cli.js))**: 15 terminal subcommands for single scrapes, full-site spiders, topic crawling, benchmarks, and interactive REPL exploration.
- **Web UI & Visual Picker ([`src/ui/server.js`](../src/ui/server.js) & [`src/ui/app.jsx`](../src/ui/app.jsx))**: Local web console with live log streaming, visual selector iframe proxy, and crawl management.
- **Model Context Protocol Server ([`src/mcp/server.js`](../src/mcp/server.js))**: Enables AI coding agents (Claude, Cursor, Antigravity) to execute scrapes, queries, and crawls directly over stdio JSON-RPC.

---

## 3. Major Features Summary

| Feature | Primary Module | Benefit |
|---|---|---|
| **Static Fetcher** | [`src/fetchers/static.js`](../src/fetchers/static.js) | Sub-150ms HTTP scraping with connection pooling and caching. |
| **Dynamic Fetcher** | [`src/fetchers/dynamic.js`](../src/fetchers/dynamic.js) | Headless browser execution for React, Vue, Next.js SPAs. |
| **Stealth Fetcher** | [`src/fetchers/stealth.js`](../src/fetchers/stealth.js) | Bypasses Cloudflare Turnstile, PerimeterX, and headless detection. |
| **Thompson Bandit** | [`src/trees/bandit.js`](../src/trees/bandit.js) | Learns domain defense strategies to bypass probe roundtrips. |
| **SimHash Self-Healing** | [`src/parser/adaptive.js`](../src/parser/adaptive.js) | Recovers broken CSS selectors using 64-bit structural hashing. |
| **Pattern Induction** | [`src/parser/cluster_extractor.js`](../src/parser/cluster_extractor.js) | Auto-extracts product cards and collections without selectors. |
| **Dual-Frontier Engine** | [`src/spiders/engine.js`](../src/spiders/engine.js) | Crawls category listings and articles independently without deadlocks. |
| **Pagination Engine** | [`src/spiders/pagination.js`](../src/spiders/pagination.js) | Follows Next links, numbered buttons, and year/month archives. |
| **Sitemap Engine** | [`src/spiders/sitemap.js`](../src/spiders/sitemap.js) | Discovers and filters historical topic URLs via XML sitemaps. |
| **Topic Crawler** | [`src/spiders/topic_crawler.js`](../src/spiders/topic_crawler.js) | Scrapes complete topic histories from earliest record to current date. |
| **SQLite Storage** | [`src/storage.js`](../src/storage.js) | WAL-mode SQLite storage for history, fingerprints, and checkpoints. |
| **Visual Selector Picker** | [`src/ui/picker.js`](../src/ui/picker.js) | Point-and-click selector generation via injected iframe proxy. |
| **MCP Server** | [`src/mcp/server.js`](../src/mcp/server.js) | Native AI agent integration over stdio JSON-RPC. |

---

## 4. Current Limitations

While Scrapi v2.0 provides robust scraping capabilities, developers should be aware of specific constraints:

1. **JavaScript Environment Requirements**: Node.js 18 lacks native `File` globals required by modern `undici` HTTP drivers, necessitating Scrapi's [`src/polyfill.js`](../src/polyfill.js) on initialization.
2. **Single-Node Architecture**: Crawling queues operate in-memory on a single Node.js process backed by local SQLite. Scrapi does not natively distribute crawl queues across multiple cluster nodes or Redis instances.
3. **Browser Resource Consumption**: Running high concurrency (e.g. `concurrency > 10`) under `dynamic` or `stealth` tiers requires substantial RAM (approximately 150MB–300MB per active Playwright page).
4. **CAPTCHA Limitations**: While Scrapi automates Cloudflare Turnstile checkmark solving via DOM inspection, it does not include third-party human-solving CAPTCHA APIs (e.g., 2Captcha, Anti-Captcha) for audio or image grid challenges.
5. **LLM Integration Dependencies**: Semantic extraction (`--llm`) relies on an optional Anthropic Claude API key (`ANTHROPIC_API_KEY`). If omitted, extraction defaults to deterministic rule-based algorithms.
