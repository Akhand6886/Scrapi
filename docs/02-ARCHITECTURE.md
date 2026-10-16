# 🏛️ System Architecture: Scrapi v2.0

## 1. High-Level Architectural Model

Scrapi v2.0 is organized into decoupled subsystems that isolate networking, machine-learning decision engines, DOM parsing, crawl coordination, and persistence:

```mermaid
graph TD
    subgraph "Clients & Entrypoints"
        CLI["CLI Commands (src/cli.js)"]
        UI["Web Dashboard & Proxy (src/ui/server.js)"]
        MCP["MCP Server (src/mcp/server.js)"]
        REPL["Interactive Shell (src/cli/shell.js)"]
        API["Programmatic API (src/index.js)"]
    end

    subgraph "Core Orchestration"
        Scraper["Scraper Engine (src/scraper.js)"]
        TopicCrawler["TopicCrawler (src/spiders/topic_crawler.js)"]
        CrawlEngine["CrawlEngine (src/spiders/engine.js)"]
    end

    subgraph "Machine-Learning Subsystem (src/trees/)"
        Bandit["Bayesian Bandit (bandit.js)"]
        TierTree["TierRouterTree (tier_router.js)"]
        ContentTree["ContentExtractorTree (content_extractor.js)"]
        PrioritizerTree["CrawlPrioritizerTree (crawl_prioritizer.js)"]
    end

    subgraph "Fetcher Subsystem (src/fetchers/)"
        Pool["FetcherPool (index.js)"]
        StaticF["StaticFetcher (static.js)"]
        DynamicF["DynamicFetcher (dynamic.js)"]
        StealthF["StealthyFetcher (stealth.js)"]
    end

    subgraph "Parser Subsystem (src/parser/)"
        Response["Response Adaptor (adaptor.js)"]
        Selector["Selector & AdaptorElement (selector.js)"]
        SimHash["64-bit SimHash (simhash.js)"]
        AdaptiveEngine["AdaptiveEngine (adaptive.js)"]
        Cluster["ClusterExtractor (cluster_extractor.js)"]
        Markdown["MarkdownEngine (markdown.js)"]
    end

    subgraph "Crawling Subsystem (src/spiders/)"
        Pagination["PaginationEngine (pagination.js)"]
        Sitemap["SitemapEngine (sitemap.js)"]
        Matcher["TopicMatcher (topic_matcher.js)"]
        SpiderBase["Spider Base Class (spider.js)"]
    end

    subgraph "Storage & Database Subsystem (src/storage.js)"
        SQLite[("SQLite: data/scrapes.db (WAL Mode)")]
        Disk[("Markdown Files: output/")]
    end

    CLI --> Scraper
    CLI --> TopicCrawler
    CLI --> CrawlEngine
    UI --> Scraper
    UI --> TopicCrawler
    MCP --> Pool
    MCP --> AdaptiveEngine
    API --> Pool
    API --> TopicCrawler

    Scraper --> Pool
    CrawlEngine --> Pool
    TopicCrawler --> CrawlEngine

    Pool --> Bandit
    Pool --> TierTree
    Pool --> StaticF
    Pool --> DynamicF
    Pool --> StealthF

    StaticF --> Response
    DynamicF --> Response
    StealthF --> Response

    Response --> Selector
    Response --> Markdown
    Response --> Cluster
    Response --> AdaptiveEngine
    AdaptiveEngine --> SimHash

    CrawlEngine --> ContentTree
    CrawlEngine --> PrioritizerTree
    CrawlEngine --> Pagination
    CrawlEngine --> Sitemap
    CrawlEngine --> Matcher

    Scraper --> SQLite
    Scraper --> Disk
    CrawlEngine --> SQLite
    CrawlEngine --> Disk
    Bandit --> SQLite
    AdaptiveEngine --> SQLite
```

---

## 2. Core Subsystems & Component Responsibilities

### 2.1 Entrypoint & Presentation Layer
Provides external interfaces to invoke scraping, crawling, and parsing:
- **CLI Driver ([`src/cli.js`](../src/cli.js))**: Commander-based command-line interface defining 15 subcommands (`scrape`, `crawl`, `topic`, `spider`, `shell`, `mcp`, `serve`, `batch`, `list`, `show`, `export`, `discover`, `benchmark`, `entities`, `bandit`).
- **Interactive Shell ([`src/cli/shell.js`](../src/cli/shell.js))**: Node.js REPL session preloading a target `Response` object for live query testing.
- **MCP Server ([`src/mcp/server.js`](../src/mcp/server.js))**: JSON-RPC 2.0 stdio server implementing the Model Context Protocol for AI coding assistants.
- **Web UI Server ([`src/ui/server.js`](../src/ui/server.js))**: Express backend providing REST endpoints for scraping, spider state polling, and the visual selector picker iframe proxy.

### 2.2 Machine-Learning & Routing Subsystem (`src/trees/`)
Guides execution tier selection, content extraction, and crawl prioritization:
- **`DecisionTree` & `CARTTrainer` ([`src/trees/engine.js`](../src/trees/engine.js))**: Binary decision tree implementation supporting Gini impurity calculations, continuous split finding, cost-complexity pruning, and Random Forest ensembles.
- **`TierRouterTree` ([`src/trees/tier_router.js`](../src/trees/tier_router.js))**: Evaluates incoming HTML features (body length, script tag ratio, React/Next.js SPA markers, Cloudflare challenge signatures) to determine if a static request must escalate to `DYNAMIC` or `STEALTH`.
- **`ContentExtractorTree` ([`src/trees/content_extractor.js`](../src/trees/content_extractor.js))**: Scores DOM elements using text length, link density, tag weight, and class name sentiment to classify nodes as `MAIN_CONTENT` or `NOISE`.
- **`CrawlPriorityTree` ([`src/trees/crawl_prioritizer.js`](../src/trees/crawl_prioritizer.js))**: Ranks discovered links (0–100) based on URL depth, pathname tokens, anchor text semantics, and tracking query noise.
- **`BayesianBandit` ([`src/trees/bandit.js`](../src/trees/bandit.js))**: Maintains Beta distribution priors $(\alpha, \beta)$ per domain. Once a domain's defense probability exceeds 85%, it triggers **Probe Bypass**, launching directly into `DYNAMIC` or `STEALTH` without wasting time on a failed static probe.

### 2.3 Fetcher Subsystem (`src/fetchers/`)
Handles networking, HTTP connection reuse, browser automation, and bot evasion:
- **`BaseFetcher` ([`src/fetchers/base.js`](../src/fetchers/base.js))**: Abstract base class establishing timeout defaults, randomized User-Agent rotation, exponential backoff retries, and timing calculations.
- **`StaticFetcher` ([`src/fetchers/static.js`](../src/fetchers/static.js))**: Axios-based client with persistent HTTP/HTTPS agents (`keepAlive: true`), Brotli/Gzip decompression, and conditional caching via SQLite table `http_cache`.
- **`DynamicFetcher` ([`src/fetchers/dynamic.js`](../src/fetchers/dynamic.js))**: Playwright headless Chromium client managing a shared browser process, page recycling, auto-scrolling, and DOM selector waiting.
- **`StealthyFetcher` ([`src/fetchers/stealth.js`](../src/fetchers/stealth.js))**: Anti-bot browser engine injecting evasive runtime shims (`navigator.webdriver`, WebGL vendor spoofing, canvas noise, Chrome plugin lists) and auto-solving Cloudflare Turnstile checkboxes.
- **`FetcherPool` ([`src/fetchers/index.js`](../src/fetchers/index.js))**: Singleton pool coordinating fetcher instances, routing through the Bayesian Bandit and TierRouter tree, and handling auto-escalation.

### 2.4 Parser & Self-Healing Subsystem (`src/parser/`)
Parses HTML, resolves elements, extracts structured metadata, and generates Markdown:
- **`Response` Adaptor ([`src/parser/adaptor.js`](../src/parser/adaptor.js))**: Unified abstraction returned by all fetchers. Wraps raw HTML with Cheerio, strips noise scripts, resolves relative URLs, and provides `.css()`, `.xpath()`, `.toMarkdown()`, and `.extractMetadata()`.
- **`AdaptorElement` & `SelectorList` ([`src/parser/selector.js`](../src/parser/selector.js))**: Fluent element wrappers providing chainable methods (`.text`, `.cleanText`, `.attr()`, `.attribs()`, `.texts`, `.xpath()`, `.css()`).
- **`SimHash` ([`src/parser/simhash.js`](../src/parser/simhash.js))**: 64-bit FNV-1a locality-sensitive hashing algorithm converting element structural paths, tag hierarchies, classes, and text into a 64-bit BigInt fingerprint.
- **`AdaptiveEngine` ([`src/parser/adaptive.js`](../src/parser/adaptive.js))**: Evaluates candidate elements against stored fingerprints using Hamming distance similarity to relocate moved or renamed elements after website redesigns.
- **`ClusterExtractor` ([`src/parser/cluster_extractor.js`](../src/parser/cluster_extractor.js))**: Unsupervised structural induction algorithm that groups repeating DOM subtree signatures to extract product or article card collections.
- **`MarkdownEngine` ([`src/parser/markdown.js`](../src/parser/markdown.js))**: Turndown-based converter configured with GitHub-Flavored Markdown (tables, code blocks, checklists) and YAML frontmatter generation.

### 2.5 Crawling Subsystem (`src/spiders/`)
Coordinates multi-page traversal, topic filtering, pagination, and persistent state:
- **`CrawlEngine` ([`src/spiders/engine.js`](../src/spiders/engine.js))**: Core crawling coordinator operating a worker pool across dual queues: `discoveryQueue` for listing/pagination navigation, and `articleQueue` for content scraping. Tracks dynamic publication date ranges and saves periodic checkpoints.
- **`TopicCrawler` ([`src/spiders/topic_crawler.js`](../src/spiders/topic_crawler.js))**: High-level orchestrator that resolves topic entrypoints, configures exhaustive crawling parameters, and manages end-to-end topic execution.
- **`TopicMatcher` ([`src/spiders/topic_matcher.js`](../src/spiders/topic_matcher.js))**: Normalizes topic slugs, tests URL segment tokens, excludes system noise paths (`/login`, `/cart`, `wp-admin`), and classifies page roles (`LISTING_PAGE`, `ARTICLE_PAGE`, `ARCHIVE_PAGE`).
- **`PaginationEngine` ([`src/spiders/pagination.js`](../src/spiders/pagination.js))**: Identifies Next Page links, numbered pagination buttons, subcategories, and archive directories, checking depletion markers to prevent infinite loops.
- **`SitemapEngine` ([`src/spiders/sitemap.js`](../src/spiders/sitemap.js))**: Probes `robots.txt` and XML sitemaps to uncover historical topic URLs.
- **`Spider` ([`src/spiders/spider.js`](../src/spiders/spider.js))**: Scrapy-inspired base class for defining custom programmatic spiders with `startUrls` and `parse()` callbacks.

### 2.6 Database & Storage Subsystem (`src/storage.js`)
Manages persistence via SQLite and filesystem storage:
- **SQLite Engine**: Utilizes `better-sqlite3` with Write-Ahead Logging (`WAL` mode) for synchronous and concurrent read/write performance.
- **Schema Management**: Creates tables for scrape records (`scrapes`), visual profiles (`profiles`), HTTP cache (`http_cache`), LLM cache (`llm_cache`), crawl checkpoints (`spider_checkpoints`), DOM element fingerprints (`element_fingerprints`), and domain bandit priors (`bandit_domain_priors`).
- **Filesystem Mapping**: Organizes output Markdown files into hierarchical domain and category subfolders (e.g. `./output/example.com/analysis/article-1.md`) alongside metadata sidecar JSON files.

---

## 3. Component Interaction Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User as User / CLI / Web UI
    participant Crawler as TopicCrawler / CrawlEngine
    participant Matcher as TopicMatcher & Pagination
    participant Pool as FetcherPool & DecisionTree
    participant Fetcher as Static / Dynamic / Stealth
    participant Adaptor as Response & Parser
    participant DB as SQLite & File Storage

    User->>Crawler: Start Crawl (URL, Topic: "Analysis")
    Crawler->>Matcher: Resolve Entrypoint & Check Sitemap
    Matcher-->>Crawler: Entrypoint URL (/analysis/)
    Crawler->>Crawler: Enqueue /analysis/ into discoveryQueue

    loop While Queues Have Items
        Crawler->>Crawler: Shift URL (discoveryQueue or articleQueue)
        Crawler->>Pool: fetch(targetUrl, autoEscalate: true)
        Pool->>Pool: Query Bayesian Bandit (Priors)
        Pool->>Fetcher: Execute Request
        Fetcher-->>Adaptor: Wrap raw HTML into Response Adaptor
        Adaptor-->>Pool: Response Object
        Pool->>Pool: Evaluate TierRouterTree (Escalate if needed)
        Pool-->>Crawler: Final Response Object

        alt Target is Listing Page (discoveryQueue)
            Crawler->>Matcher: extractArticleLinksFromListing(Response)
            Matcher-->>Crawler: Discovered Article URLs
            Crawler->>Crawler: Push unique articles to articleQueue
            Crawler->>Matcher: findNextPageUrl() & findNumberedPageUrls()
            Matcher-->>Crawler: Next Pagination URLs
            Crawler->>Crawler: Push unique pages to discoveryQueue
        else Target is Article Page (articleQueue)
            Crawler->>Adaptor: toMarkdown() & extractMetadata()
            Adaptor-->>Crawler: Markdown, Date, Author, Category
            Crawler->>Crawler: Update Dynamic Date Coverage
            Crawler->>DB: Save Markdown file to output/
            Crawler->>DB: Insert record into SQLite scrapes table
        end

        Crawler->>DB: Save Checkpoint (every 5 visited URLs)
    end

    Crawler-->>User: Crawl Complete (Stats, Date Range, Succeeded Count)
```
