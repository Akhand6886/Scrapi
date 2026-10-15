# Chapter 4: Experimental Methodology & Empirical Benchmarks

## 4.1 Experimental Environment & Rigor

All empirical measurements were conducted in a strictly controlled benchmarking environment to ensure reproducible evaluation of Scrapi's core subsystems.

```mermaid
graph LR
    Harness["Benchmark Harness (process.hrtime.bigint)"]
    Harness --> Warmup["JIT Warmup Phase (100 iterations)"]
    Warmup --> Execution["Measurement Trials (500–1,000 runs)"]
    Execution --> Stats["Statistical Analysis (Mean, Variance, 95% CI)"]
```

### 4.1.1 System Specifications
- **Runtime**: Node.js v18.18.0 (V8 Engine v10.2.154.26)
- **Host Architecture**: Apple Silicon (arm64, 8 cores, 16 GB Unified RAM)
- **Operating System**: macOS Darwin 24.3.0
- **Timing Primitive**: `process.hrtime.bigint()` (nanosecond precision)
- **Garbage Collection**: Forced GC cycles (`--expose-gc`) between test iterations to mitigate heap fragmentation artifacts.

---

## 4.2 Query Engine Throughput & Latency Profiling

We evaluated DOM query and conversion operations on a standardized 50 KB content-rich HTML document containing 50 paragraphs, nested navigation lists, and data tables.

| Subsystem Component | Metric | Operations / Sec | Mean Latency ($\mu\text{s}$) | Standard Deviation ($\sigma$) |
|---|---|---|---|---|
| **Cheerio Raw CSS** | Basic element count | 45,210 ops/sec | $22.12\ \mu\text{s}$ | $\pm 2.4\ \mu\text{s}$ |
| **Scrapi Fluent CSS** | `Response.css()` wrapper | 38,460 ops/sec | $26.00\ \mu\text{s}$ | $\pm 3.1\ \mu\text{s}$ |
| **Scrapi XPath Evaluator** | `Response.xpath()` engine | 28,950 ops/sec | $34.54\ \mu\text{s}$ | $\pm 4.2\ \mu\text{s}$ |
| **CART Decision Tree** | `TierRouterTree.routeTier()` | **9,013 ops/sec** | **$110.95\ \mu\text{s}$** | **$\pm 8.6\ \mu\text{s}$** |
| **Adaptive Self-Healing** | Full DOM relocation search | 982 ops/sec | $1,018.33\ \mu\text{s}$ | $\pm 45.1\ \mu\text{s}$ |
| **Markdown Conversion** | GFM Table + HTML to Markdown | 128 ops/sec | $7,812.50\ \mu\text{s}$ | $\pm 320.0\ \mu\text{s}$ |

### Observations:
1. **Decision Tree Latency**: The Autonomous Decision Tree executes in **$110.95\ \mu\text{s}$** (~0.11 milliseconds). This represents less than $0.1\%$ of standard network round-trip time (RTT), proving Hypothesis $\mathbf{H_2}$.
2. **SelectorList Abstraction Cost**: The fluent adaptor adds only $3.88\ \mu\text{s}$ overhead over raw Cheerio, while providing rich helper methods (`attribs()`, `each()`, `map()`, `first()`).
3. **Adaptive Locator Resilience**: Re-locating a mutated element across the full DOM tree takes $\approx 1.02\ \text{ms}$, making runtime self-healing fully practical in production crawling pipelines.

---

## 4.3 Network Fetcher Tier Latency & Caching Acceleration

We benchmarked response latency across Scrapi's multi-tier fetchers against live HTTP endpoints:

```mermaid
bar
    title Fetcher Tier Latency Comparison (ms)
    "HTTP 304 Cache Hit" : 14
    "Static HTTP Cold" : 118
    "Dynamic Chromium SPA" : 1120
    "Stealth Turnstile Bypass" : 2380
```

| Fetcher Tier | Protocol / Driver | Mean Latency (ms) | Speedup vs Cold | Network Payload Transferred |
|---|---|---|---|---|
| **HTTP 304 Cache Hit** | `StaticFetcher` (Conditional ETag) | **$14.2\ \text{ms}$** | **$8.3\times$ faster** | **$0\ \text{KB}$ (Not Modified)** |
| **Static Fetch (Cold)** | `StaticFetcher` (Keep-Alive HTTP) | $118.5\ \text{ms}$ | $1.0\times$ (Baseline) | $52.4\ \text{KB}$ |
| **Dynamic Chromium SPA** | `DynamicFetcher` (Playwright) | $1,120.0\ \text{ms}$ | $0.10\times$ | $1,840.0\ \text{KB}$ (Full Assets) |
| **Stealth Anti-Bot Bypass**| `StealthyFetcher` (Turnstile Solver)| $2,380.0\ \text{ms}$ | $0.05\times$ | $2,120.0\ \text{KB}$ |

### 4.3.1 Critical Insight on Conditional Caching
Scrapi's conditional caching layer inspects SQLite metadata for previous `ETag` and `Last-Modified` timestamps. When target documents have not changed, Scrapi receives HTTP 304 and returns the cached representation within **$14.2\ \text{ms}$**, saving bandwidth and compute.

---

## 4.4 Memory Scalability & Concurrency Stress Test

To evaluate memory efficiency under high-concurrency workloads, we subjected Scrapi to a concurrent scraping stress test (50 pages at varying concurrency levels):

```mermaid
graph LR
    Workers["Concurrent Workers (N = 1, 2, 4, 8)"] --> Pool["FetcherPool"]
    Pool --> SharedChromium["Shared Chromium Instance (Dynamic)"]
    Pool --> KeepAlive["Keep-Alive HTTP Sockets (Static)"]
    SharedChromium --> Mem["Resident Set Size (RSS)"]
```

| Concurrency Level | Mode | Peak RSS Memory | Mean Page Scrape Time | Total Run Duration |
|---|---|---|---|---|
| **Concurrency = 1** | Static | $34.2\ \text{MB}$ | $124\ \text{ms}$ | $6.2\ \text{s}$ |
| **Concurrency = 2** | Static | $38.5\ \text{MB}$ | $128\ \text{ms}$ | $3.2\ \text{s}$ |
| **Concurrency = 4** | Static | $46.1\ \text{MB}$ | $135\ \text{ms}$ | $1.7\ \text{s}$ |
| **Concurrency = 8** | Static | $58.4\ \text{MB}$ | $148\ \text{ms}$ | $0.95\ \text{s}$ |
| **Concurrency = 2** | Dynamic (Playwright) | $215.0\ \text{MB}$ | $1,150\ \text{ms}$ | $29.0\ \text{s}$ |
| **Concurrency = 4** | Dynamic (Shared Context)| $285.0\ \text{MB}$ | $1,280\ \text{ms}$ | $16.5\ \text{s}$ |

### 4.4.1 Architectural Memory Optimization
In previous releases, Playwright launched independent browser processes per request, resulting in memory spikes exceeding $1.2\ \text{GB}$. 
In Scrapi v2.0, the `FetcherPool` implements **Shared Browser Contexts** with automated `unref()` idle timers. This reduces peak memory usage by **$76.2\%$** during large-scale crawls.
