# 🔄 Data Flow: Scrapi v2.0

This document traces the exact step-by-step movement of data through Scrapi v2.0 across its major operational pipelines.

---

## 1. Single URL Scraping Pipeline

When a user requests a single page scrape via CLI (`scrapi scrape <url>`) or Web Dashboard (`POST /api/scrape`), data flows through five sequential stages:

```mermaid
flowchart TD
    A["User Input: URL, Options (selector, fetcher, images)"] --> B["FetcherPool.fetch() (src/fetchers/index.js)"]
    
    subgraph "Fetching Stage"
        B --> C{"Bandit Check: Domain Prior > 85%?"}
        C -- Yes --> D["Direct Dispatch (Dynamic or Stealth)"]
        C -- No --> E["StaticFetcher.fetch() (src/fetchers/static.js)"]
        E --> F{"TierRouter Decision: Escalation Needed?"}
        F -- "STATIC (Complete)" --> G["Raw HTML"]
        F -- "DYNAMIC (React/Vue SPA)" --> H["DynamicFetcher (Playwright)"]
        F -- "STEALTH (Cloudflare/Bot)" --> I["StealthyFetcher (Turnstile Solve)"]
        H --> G
        I --> G
        D --> G
    end

    subgraph "Parsing & Extraction Stage"
        G --> J["new Response({ html, url }) (src/parser/adaptor.js)"]
        J --> K["cleanDom() (Remove script, style, ads)"]
        K --> L["resolveUrls() (Convert relative href/src to absolute)"]
        L --> M["findBestContentRoot() (ContentExtractorTree or Selector)"]
        M --> N["MarkdownEngine.convert() (GFM Markdown)"]
        N --> O["extractMetadata() (JSON-LD, Date, Author, Category)"]
    end

    subgraph "Persistence & Output Stage"
        O --> P["saveMarkdownFile() -> output/host/path.md (src/storage.js)"]
        O --> Q["insertScrape() -> SQLite scrapes table (src/storage.js)"]
        P --> R["Return Result to CLI / Web UI"]
        Q --> R
    end
```

### Stage-by-Stage Trace:
1. **Input Reception**: [`src/cli.js`](../src/cli.js) or [`src/ui/server.js`](../src/ui/server.js) parses CLI flags or JSON payload into an options dictionary: `{ url, fetcher: 'auto', selector: 'auto', downloadMedia: false, ... }`.
2. **Bandit Consultation**: [`FetcherPool.fetch()`](../src/fetchers/index.js) queries [`BayesianBandit.shouldBypassProbe(domain)`](../src/trees/bandit.js). If the domain's defense probability exceeds 85%, the static probe is bypassed directly to `DYNAMIC` or `STEALTH`.
3. **Execution & Escalation**:
   - `StaticFetcher.fetch()` makes an HTTP request with connection pooling and conditional caching headers.
   - If `autoEscalate: true`, the raw HTML is sent to [`TierRouterTree.predict()`](../src/trees/tier_router.js).
   - If classified as `DYNAMIC` (client-rendered SPA) or `STEALTH` (anti-bot challenge), `FetcherPool` auto-dispatches the higher tier.
4. **DOM Wrapping**: The resulting HTML is wrapped in [`Response`](../src/parser/adaptor.js).
   - `this.$` lazily creates a Cheerio instance with noise scripts stripped.
   - `resolveUrls()` converts relative `href` and `src` attributes into absolute URLs based on `response.url`.
5. **Content Extraction**:
   - [`findBestContentRoot()`](../src/parser/adaptor.js) locates the primary container using CSS selector, self-healing fingerprint, or [`scoreContentElement()`](../src/trees/content_extractor.js).
   - [`MarkdownEngine.convert()`](../src/parser/markdown.js) converts the content DOM subtree into clean GitHub-Flavored Markdown.
   - [`extractMetadata()`](../src/parser/adaptor.js) inspects JSON-LD script blocks, `<meta>` tags, and `<time>` tags to populate title, date, author, category, tags, and canonical URL.
6. **Storage**:
   - [`saveMarkdownFile()`](../src/storage.js) writes the Markdown file with YAML frontmatter to `./output/<domain>/<path>.md`.
   - [`insertScrape()`](../src/storage.js) logs the URL, title, word count, timestamp, and status into SQLite `scrapes`.

---

## 2. Exhaustive Topic Crawling Pipeline

When executing a topic crawl via CLI (`scrapi topic <url> <topic>`) or Web Dashboard (`POST /api/topic/crawl`), data flows through a **dual-frontier asynchronous queue system**:

```mermaid
sequenceDiagram
    autonumber
    actor User as User Request (URL, Topic: "Analysis")
    participant Crawler as TopicCrawler (src/spiders/topic_crawler.js)
    participant Engine as CrawlEngine (src/spiders/engine.js)
    participant Matcher as TopicMatcher & Pagination (src/spiders/)
    participant Pool as FetcherPool (src/fetchers/)
    participant DB as SQLite Storage (src/storage.js)

    User->>Crawler: crawl(websiteUrl, "Analysis")
    Crawler->>Matcher: resolveTopicEntrypoint()
    Matcher-->>Crawler: Entrypoint URL (/analysis/)
    Crawler->>Engine: crawl(entrypointUrl)

    Note over Engine: Initialize Dual-Frontier Queues
    Engine->>Engine: discoveryQueue.push(/analysis/)

    loop Worker Loop (discoveryQueue or articleQueue)
        alt discoveryQueue has items (Priority)
            Engine->>Engine: item = discoveryQueue.shift()
            Engine->>Pool: fetch(item.url)
            Pool-->>Engine: Listing Response Adaptor

            Engine->>Matcher: extractArticleLinksFromListing(Response)
            Matcher-->>Engine: 15 Article URLs
            Engine->>Engine: Push unique articles to articleQueue

            Engine->>Matcher: findNextPageUrl() & findNumberedPageUrls()
            Matcher-->>Engine: /analysis/page/2/
            Engine->>Engine: Push unique pagination to discoveryQueue

            Engine->>Matcher: findSubcategoryUrls() & findArchiveUrls()
            Matcher-->>Engine: /analysis/crypto/, /archive/2024/
            Engine->>Engine: Push subcategories & archives to discoveryQueue

        else articleQueue has items (Content)
            Engine->>Engine: item = articleQueue.shift()
            
            opt Incremental Deduplication
                Engine->>DB: isUrlScraped(item.url)
                DB-->>Engine: true (Already scraped)
                Engine->>Engine: skippedExisting++ (Skip download)
            end

            Engine->>Pool: fetch(item.url)
            Pool-->>Engine: Article Response Adaptor

            Engine->>Engine: toMarkdown() & extractMetadata()
            Engine->>Engine: recordDate(metadata.date) -> Update earliest/latest date
            Engine->>DB: saveMarkdownFile() -> output/host/path.md
            Engine->>DB: insertScrape() -> SQLite scrapes table
        end

        opt Every 5 Visited URLs
            Engine->>DB: saveCheckpoint(jobId) -> SQLite spider_checkpoints
        end
    end

    Engine-->>User: Crawl Complete (Stats, Date Range, Succeeded)
```

---

## 3. Visual Selector Picker Data Flow

When a user uses the Visual Picker in the Web Dashboard (`src/ui/app.jsx`), data flows through an **injected iframe proxy**:

```mermaid
sequenceDiagram
    autonumber
    actor User as User Browser (Web Dashboard)
    participant UI as Dashboard React App (src/ui/app.jsx)
    participant Server as Express Server (src/ui/server.js)
    participant Remote as Target Website
    participant Picker as Injected Script (src/ui/picker.js)

    User->>UI: Enter Target URL in Visual Picker Mode
    UI->>Server: Load iframe src="/api/proxy?url=https://target.com"
    Server->>Remote: Fetch target page HTML
    Remote-->>Server: HTML Content
    Server->>Server: Rewrite internal links to route through /api/proxy
    Server->>Server: Inject picker.js script & overlay styles into HTML
    Server-->>UI: Proxied HTML rendered inside iframe

    Note over User,Picker: User moves mouse inside iframe
    User->>Picker: Hover over DOM element
    Picker->>Picker: Draw blue highlight border around element
    User->>Picker: Click element
    Picker->>Picker: Generate optimal CSS selector & 64-bit SimHash fingerprint
    Picker->>UI: window.parent.postMessage({ type: 'ELEMENT_SELECTED', selector, signature })
    UI->>UI: Populate Selector field in Dashboard form
    UI->>Server: POST /api/fingerprints (Save signature to SQLite)
```

---

## 4. MCP Server AI Integration Flow

When an AI coding assistant (Cursor, Claude, Antigravity) uses Scrapi via Model Context Protocol:

```mermaid
sequenceDiagram
    autonumber
    actor Agent as AI Coding Assistant (e.g. Cursor / Claude)
    participant Stdio as stdio (JSON-RPC 2.0)
    participant MCPServer as MCPServer (src/mcp/server.js)
    participant Pool as FetcherPool (src/fetchers/index.js)
    participant Adaptor as Response Adaptor (src/parser/adaptor.js)

    Agent->>Stdio: JSON-RPC Request: "tools/call" (name: "scrapi_fetch", url: "...")
    Stdio->>MCPServer: handleToolCall("scrapi_fetch", args)
    MCPServer->>Pool: fetch(args.url, { fetcher: args.fetcher })
    Pool-->>MCPServer: Response instance
    MCPServer->>Adaptor: toMarkdown({ selector, images })
    Adaptor-->>MCPServer: { markdown, metadata }
    MCPServer->>Stdio: JSON-RPC Result { content: [{ type: "text", text: Markdown }] }
    Stdio-->>Agent: AI receives clean Markdown with metadata
```
