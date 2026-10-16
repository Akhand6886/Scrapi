# ⚙️ Configuration & Environment: Scrapi v2.0

## 1. Environment Variables

Scrapi loads configuration and secrets using `dotenv`. Create a `.env` file in the project root:

```env
# Optional Anthropic Claude API key for semantic extraction (--llm)
ANTHROPIC_API_KEY=sk-ant-api03-...

# Web Dashboard Server Port (default: 3000)
PORT=3000

# SQLite Database Storage Directory (default: ./data)
SCRAPI_DATA_DIR=./data

# Markdown & Media Output Directory (default: ./output)
SCRAPI_OUTPUT_DIR=./output
```

### Environment Variables Detail:
| Variable | Required? | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | No | `null` | Required only if running `--llm`, `--extract`, or `--summarize` with Claude. |
| `PORT` | No | `3000` | Port for the Express Web Dashboard server (`scrapi serve`). |
| `SCRAPI_DATA_DIR` | No | `./data` | Directory where `scrapes.db` is stored. |
| `SCRAPI_OUTPUT_DIR`| No | `./output`| Root directory where Markdown files and media assets are saved. |

---

## 2. Default Runtime Settings

Scrapi uses conservative, reliable defaults designed to protect system resources and avoid triggering IP bans:

| Setting | Default Value | Relevant Module | Overridden By |
|---|---|---|---|
| **Fetcher Tier** | `'auto'` | [`src/fetchers/index.js`](../src/fetchers/index.js) | `-f, --fetcher <type>` |
| **Request Timeout** | `15000ms` (15s) | [`src/fetchers/base.js`](../src/fetchers/base.js) | `--timeout <ms>` |
| **Crawl Concurrency** | `2` workers | [`src/spiders/engine.js`](../src/spiders/engine.js) | `-c, --concurrency <n>` |
| **Crawl Delay** | `1000ms` (1s) | [`src/spiders/engine.js`](../src/spiders/engine.js) | `--delay <ms>` |
| **Spider Max Pages** | `100` | [`src/spiders/engine.js`](../src/spiders/engine.js) | `-m, --max-pages <n>` |
| **Topic Max Pages** | `Infinity` | [`src/spiders/topic_crawler.js`](../src/spiders/topic_crawler.js) | `-m, --max-pages <n>` |
| **Crawl Max Depth** | `Infinity` | [`src/spiders/engine.js`](../src/spiders/engine.js) | `-d, --depth <n>` |
| **Sitemap Discovery**| `true` | [`src/spiders/topic_crawler.js`](../src/spiders/topic_crawler.js) | `--no-sitemap` |
| **HTTP Caching** | Enabled (`true`) | [`src/fetchers/static.js`](../src/fetchers/static.js) | `--no-cache` |
| **SQLite WAL Mode** | Enabled (`true`) | [`src/storage.js`](../src/storage.js) | Database Pragma |
| **Checkpoint Interval**| Every 5 URLs | [`src/spiders/engine.js`](../src/spiders/engine.js) | Hardcoded threshold |

---

## 3. Concurrency & Rate Limiting Guidelines

### 3.1 Concurrency (`-c, --concurrency`)
- **Static Fetcher**: Safe to run at `c = 4` to `c = 8` for high-speed indexing.
- **Dynamic / Stealth Fetcher**: Keep at `c = 1` to `c = 3`. Each Playwright browser page consumes 150MB–300MB of RAM. Exceeding 4 concurrent pages may cause memory pressure on standard developer machines.

### 3.2 Politeness Delay (`--delay`)
- Scrapi pauses each worker for `--delay <ms>` after processing a page.
- **Aggressive/Testing**: `50ms`–`200ms` (only on local mock servers or private staging APIs).
- **Standard Public Sites**: `1000ms`–`2000ms` (prevents rate limits and 429 Too Many Requests).
- **Strictly Protected Sites**: `3000ms`–`5000ms` with random variance.
