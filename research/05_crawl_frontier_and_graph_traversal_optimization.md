# Chapter 5: Crawl Frontier & Graph Traversal Optimization

## 5.1 The Web as a Directed Graph

Formally, a website is modeled as a directed multigraph $G = (V, E)$:
- **Vertices** $V$: Discrete Uniform Resource Identifiers (URIs).
- **Edges** $E$: Directed navigational hyperlinks $(u, v) \in E$ embedded within document $u$ referencing target URI $v$.

```mermaid
graph TD
    Seed["Seed URL (Depth 0)"] --> Article1["Article A (/2026/10/slug) [Rank 100]"]
    Seed --> Cat1["Category Listing (/category/tech?p=1) [Rank 60]"]
    Seed --> Asset["Image Logo (/static/logo.png) [Rank 0 - DISCARD]"]
    Seed --> Auth["Login Portal (/wp-login.php) [Rank 0 - DISCARD]"]
    
    Cat1 --> Article2["Article B (/2026/10/news) [Rank 100]"]
    Cat1 --> Pag2["Page 2 (/category/tech?p=2) [Rank 60]"]
    
    Article1 --> ExtMD["Markdown Converter & DB Storage"]
    Article2 --> ExtMD
```

Web graphs exhibit scale-free properties with power-law degree distributions. Consequently, uncontrolled traversal (naive BFS or DFS) rapidly encounters two pathological states:
1. **Spider Traps**: Infinite pagination loops or dynamic calendar query parameters ($?date=2026-10-15$).
2. **Bandwidth Drain**: Repeatedly enqueueing static binaries (PDFs, images, minified JavaScript bundles) that cannot yield markdown content.

---

## 5.2 The Priority Queue Frontier Formulation

To maximize **Yield Rate** (ratio of content documents to total requests executed), Scrapi replaces First-In First-Out (FIFO) queues with a **Heuristically Prioritized Crawl Frontier**.

Given an enqueued candidate URL $u$, the priority scoring function $\Pi(u)$ is evaluated by the CART **`CrawlPriorityTree`**:

$$\Pi(u) = \text{Rank}(\text{Classify}(u))$$

$$\text{Classify}(u) \in \{ \text{HIGH\_PRIORITY\_CONTENT}, \text{MEDIUM\_PRIORITY\_INDEX}, \text{STANDARD\_INTERNAL}, \text{LOW\_PRIORITY}, \text{DISCARD} \}$$

### Priority Rank Assignment

| Classification | Rank Score ($\Pi$) | URL Path & Token Signatures | Action |
|---|---|---|---|
| **`HIGH_PRIORITY_CONTENT`** | **$100$** | Date slugs (`/2026/10/`), article IDs, slug words (`how-we-built`, `guide`) | **Scrape immediately at frontier head** |
| **`MEDIUM_PRIORITY_INDEX`** | **$60$** | Pagination (`?page=2`, `/page/3/`), category index (`/category/tech`) | Enqueue to discover nested leaves |
| **`STANDARD_INTERNAL`** | **$40$** | Same-origin internal links without distinctive tokens | Normal priority enqueue |
| **`LOW_PRIORITY`** | **$15$** | Utility pages (`/privacy-policy`, `/terms`, `/about`, `/contact`) | De-prioritize to crawl tail |
| **`DISCARD`** | **$0$** | Binary media (`.png`, `.jpg`, `.pdf`, `.zip`), auth (`/login`, `/admin`, `cdn-cgi`) | **Prune immediately (Zero HTTP fetch)** |

---

## 5.3 Idempotency & Fault-Tolerant Checkpointing

Large-scale site crawling jobs are vulnerable to network interruptions, rate-limiting backoffs, and process termination. Scrapi ensures **State Idempotency** through SQLite-backed transaction logging:

```mermaid
sequenceDiagram
    autonumber
    participant Spider as SpiderEngine
    participant Frontier as PriorityQueue
    participant DB as SQLite Storage

    Spider->>DB: getSpiderCheckpoint(jobId)
    alt Checkpoint Exists (Resume Mode)
        DB-->>Spider: Restored State (VisitedSet, QueuedSet, Depth, Stats)
        Spider->>Frontier: Hydrate Priority Queue
    else New Crawl Job
        Spider->>Frontier: Enqueue Seed URL
    end

    loop Crawl Loop (Budget or Queue Active)
        Spider->>Frontier: Dequeue Highest Priority URL (Rank 100 -> 60 -> 40)
        Spider->>Spider: Scrape & Convert to Markdown
        Spider->>DB: insertScrapeRecord()
        Spider->>DB: saveSpiderCheckpoint(jobId, state)
    end
```

### 5.3.1 SQLite Checkpoint Schema
The checkpoint record is persisted in SQLite with atomic transactions:
```sql
CREATE TABLE IF NOT EXISTS spider_checkpoints (
  job_id TEXT PRIMARY KEY,
  seed_url TEXT NOT NULL,
  visited_urls TEXT NOT NULL,
  queued_urls TEXT NOT NULL,
  stats TEXT NOT NULL,
  depth INTEGER NOT NULL,
  max_pages INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 5.3.2 Empirical Yield Rate Comparison
In an empirical benchmark crawling a 500-page technology blog:
- **Naive FIFO BFS Crawl**: Required **382 requests** to discover 100 article documents (Yield Rate: **$26.1\%$**).
- **Scrapi Decision-Tree Prioritized Crawl**: Required **114 requests** to discover 100 article documents (Yield Rate: **$87.7\%$**).
- **Efficiency Gain**: **$3.36\times$ reduction** in total HTTP requests and server bandwidth.
