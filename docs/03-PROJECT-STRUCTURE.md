# 📁 Project Structure: Scrapi v2.0

## 1. Directory Tree Overview

```text
Scrapi/
├── docs/                        # Complete project technical documentation
├── data/                        # Default SQLite database directory (scrapes.db)
├── output/                      # Default scrape output directory (Markdown & media)
├── src/                         # Application source code
│   ├── benchmark/               # Performance, throughput, and evasion benchmark suite
│   ├── cli/                     # CLI-specific utilities (interactive shell)
│   ├── fetchers/                # Progressive multi-tier HTTP and browser fetchers
│   ├── mcp/                     # Model Context Protocol (MCP) server implementation
│   ├── parser/                  # Unified Response adaptor, selectors, SimHash, and Markdown engine
│   ├── spiders/                 # CrawlEngine, dual-frontier queues, pagination, and topic crawler
│   ├── trees/                   # CART Decision Trees, Random Forest, and Bayesian Bandit
│   ├── ui/                      # Web dashboard, Express server, and visual selector picker
│   ├── cli.js                   # CLI commander entrypoint
│   ├── index.js                 # Public programmatic API exports
│   ├── llm.js                   # Anthropic Claude semantic extraction and summarization
│   ├── polyfill.js              # Node.js 18 File global polyfill
│   ├── scraper.js               # High-level scraping orchestration and category discovery
│   ├── spider.js                # Legacy runSpider entrypoint
│   └── storage.js               # SQLite database setup, queries, checkpoints, and file I/O
├── package.json                 # Project dependencies, scripts, and package metadata
├── README.md                    # Quickstart guide and architecture overview
├── test.js                      # Central test runner executing all suites
├── test_latest_methods.js       # Verifies SimHash, Entity induction, and Bayesian Bandit
├── test_decision_tree.js        # Verifies CART training, Random Forest, and decision trees
├── test_scrapling_arch.js       # Verifies Adaptor, XPath, Self-healing, and MCP server
├── test_spider.js               # Verifies site spidering and folder structure mapping
├── test_optimizations.js        # Verifies SQLite indexing and Cheerio noise cleanup
├── test_category_crawl.js       # Verifies category tagging, folder routing, and CLI crawl
└── test_topic_crawl.js          # Verifies exhaustive topic crawling and dynamic date coverage
```

---

## 2. Source Modules Manifest & Responsibilities

### 2.1 Root Source Files (`src/`)

| File | Exact Responsibility |
|---|---|
| [`src/cli.js`](../src/cli.js) | Defines the main CLI interface via Commander.js, handling all 15 subcommands (`scrape`, `crawl`, `topic`, `spider`, etc.), flag parsing, spinners, and stdout formatting. |
| [`src/index.js`](../src/index.js) | Central export hub exposing the public programmatic Node.js API (`fetchers`, `parser`, `spiders`, `storage`, `scraper`, `trees`). |
| [`src/scraper.js`](../src/scraper.js) | Orchestrates single-page scraping pipelines, delegates metadata extraction to `Response.extractMetadata()`, and provides category detection (`discoverCategories`) and link selector detection (`autoDetectLinkSelector`). |
| [`src/storage.js`](../src/storage.js) | Manages SQLite connection via `better-sqlite3` in WAL mode, database table schemas, CRUD queries, spider checkpoints, element fingerprints, and Markdown file saving. |
| [`src/spider.js`](../src/spider.js) | Legacy compatibility export providing `runSpider` by delegating to `CrawlEngine`. |
| [`src/llm.js`](../src/llm.js) | Integrates Anthropic Claude API (`@anthropic-ai/sdk`) for plain-English extraction, structured JSON schema mapping via Zod, and content summarization with SQLite caching. |
| [`src/polyfill.js`](../src/polyfill.js) | Polyfills global `File` in Node.js 18 environments to prevent runtime errors in `undici` and modern HTTP dependencies. |

---

### 2.2 Fetcher Subsystem (`src/fetchers/`)

| File | Exact Responsibility |
|---|---|
| [`src/fetchers/base.js`](../src/fetchers/base.js) | Abstract `BaseFetcher` class enforcing common interface (`fetch(url, options)`), User-Agent rotation, retry backoff, and execution timing. |
| [`src/fetchers/static.js`](../src/fetchers/static.js) | Fast HTTP fetcher using Axios with HTTP Keep-Alive connection pooling, Brotli/Gzip decompression, and conditional caching (`ETag` / `If-Modified-Since`). |
| [`src/fetchers/dynamic.js`](../src/fetchers/dynamic.js) | Headless Chromium fetcher using Playwright to render client-side JavaScript, auto-scroll infinite pages, and await specific DOM elements. |
| [`src/fetchers/stealth.js`](../src/fetchers/stealth.js) | Anti-bot evasion fetcher masking `navigator.webdriver`, injecting canvas/WebGL noise, spoofing Chrome plugins, and auto-solving Cloudflare Turnstile challenges. |
| [`src/fetchers/index.js`](../src/fetchers/index.js) | `FetcherPool` coordinating fetcher tiers, auto-escalation via `TierRouterTree`, Bayesian Bandit probe bypassing, and browser process cleanup via `closeAllFetchers()`. |

---

### 2.3 Parser Subsystem (`src/parser/`)

| File | Exact Responsibility |
|---|---|
| [`src/parser/adaptor.js`](../src/parser/adaptor.js) | Implements `Response` class wrapping raw HTML with Cheerio, noise stripping, URL resolution, `.css()`, `.xpath()`, `.toMarkdown()`, and metadata extraction. |
| [`src/parser/selector.js`](../src/parser/selector.js) | Implements `AdaptorElement` and `SelectorList`, providing fluent chainable DOM queries, text extraction, attribute lookups, and XPath evaluation. |
| [`src/parser/adaptive.js`](../src/parser/adaptive.js) | Implements `AdaptiveEngine` to compute DOM element signatures and relocate broken elements using multi-anchor structural and text similarity. |
| [`src/parser/simhash.js`](../src/parser/simhash.js) | Implements 64-bit SimHash algorithm using FNV-1a hashing to compute compact locality-sensitive fingerprints and Hamming distances for DOM trees. |
| [`src/parser/cluster_extractor.js`](../src/parser/cluster_extractor.js) | Unsupervised structural entity induction algorithm that identifies repeating DOM card patterns and clusters them into structured JSON collections. |
| [`src/parser/markdown.js`](../src/parser/markdown.js) | Implements `MarkdownEngine` using Turndown with GFM tables, code blocks, checklists, and YAML frontmatter formatting. |
| [`src/parser/index.js`](../src/parser/index.js) | Export hub for all parsing, selector, and self-healing modules. |

---

### 2.4 Machine-Learning & Decision Trees (`src/trees/`)

| File | Exact Responsibility |
|---|---|
| [`src/trees/engine.js`](../src/trees/engine.js) | Core CART Decision Tree engine supporting Gini impurity, continuous feature splits, tree pruning, prediction confidence, and Random Forest ensembles. |
| [`src/trees/tier_router.js`](../src/trees/tier_router.js) | 61-node decision tree evaluating HTML documents to route between `STATIC`, `DYNAMIC`, and `STEALTH` fetcher tiers. |
| [`src/trees/content_extractor.js`](../src/trees/content_extractor.js) | 29-node decision tree evaluating DOM candidate nodes to classify and rank `MAIN_CONTENT` versus `NOISE`. |
| [`src/trees/crawl_prioritizer.js`](../src/trees/crawl_prioritizer.js) | 35-node decision tree evaluating discovered link URLs to assign crawl priority scores (0–100) and filter out noise paths. |
| [`src/trees/bandit.js`](../src/trees/bandit.js) | Thompson Sampling multi-armed bandit tracking domain defense distributions in SQLite to bypass static probes when anti-bot certainty exceeds 85%. |
| [`src/trees/index.js`](../src/trees/index.js) | Export hub for decision trees and the global bandit instance. |

---

### 2.5 Spider & Crawling Subsystem (`src/spiders/`)

| File | Exact Responsibility |
|---|---|
| [`src/spiders/engine.js`](../src/spiders/engine.js) | Implements `CrawlEngine`, managing concurrent worker loops, dual-frontier queues (`discoveryQueue` vs `articleQueue`), dynamic date tracking, and SQLite checkpoints. |
| [`src/spiders/topic_crawler.js`](../src/spiders/topic_crawler.js) | High-level `TopicCrawler` orchestrator resolving entrypoints and running exhaustive topic crawls from earliest available content to current date. |
| [`src/spiders/topic_matcher.js`](../src/spiders/topic_matcher.js) | Creates topic profiles, tokenizes slugs, filters system noise, classifies page roles (`LISTING_PAGE`, `ARTICLE_PAGE`, `ARCHIVE_PAGE`), and isolates article card links. |
| [`src/spiders/pagination.js`](../src/spiders/pagination.js) | Detects Next Page links, numbered page sets, subcategories, archives, generates page URLs, and checks listing depletion markers. |
| [`src/spiders/sitemap.js`](../src/spiders/sitemap.js) | Discovers `robots.txt` directives and extracts topic-filtered URLs and lastmod timestamps from XML sitemaps. |
| [`src/spiders/spider.js`](../src/spiders/spider.js) | Base `Spider` class allowing users to define Scrapy-like crawler classes with custom `startUrls` and `parse()` methods. |
| [`src/spiders/index.js`](../src/spiders/index.js) | Export hub for all crawling, spidering, and pagination modules. |

---

### 2.6 Web UI Subsystem (`src/ui/`)

| File | Exact Responsibility |
|---|---|
| [`src/ui/server.js`](../src/ui/server.js) | Express HTTP server providing REST API endpoints for scraping, spider control, topic crawling, profile saving, and the visual picker proxy. |
| [`src/ui/app.jsx`](../src/ui/app.jsx) | React 18 single-page application dashboard providing 4 console modes: Quick Scrape, Site Spider, Visual Picker, and Topic Crawl. |
| [`src/ui/app.js`](../src/ui/app.js) | Pre-bundled production JavaScript bundle compiled from `app.jsx` via `esbuild`. |
| [`src/ui/index.html`](../src/ui/index.html) | HTML shell loading React, Babel/ESBuild bundles, fonts, and dark-mode CSS variables. |
| [`src/ui/picker.js`](../src/ui/picker.js) | Client-side visual selector script injected into the iframe proxy to highlight hovered elements and generate optimal CSS selectors. |

---

### 2.7 MCP & CLI Utilities (`src/mcp/`, `src/cli/`, `src/benchmark/`)

| File | Exact Responsibility |
|---|---|
| [`src/mcp/server.js`](../src/mcp/server.js) | Implements JSON-RPC 2.0 over stdio for the Model Context Protocol, exposing `scrapi_fetch`, `scrapi_extract`, `scrapi_adaptive_query`, and `scrapi_crawl`. |
| [`src/cli/shell.js`](../src/cli/shell.js) | Launches an interactive Node.js REPL session with pre-fetched `Response`, `$`, and `response` objects for live selector testing. |
| [`src/benchmark/`](../src/benchmark/) | Automated performance benchmark suite evaluating fetcher latency, parser throughput, memory consumption, and anti-bot evasion rates. |
