# 📦 Scrapi v2.0: Dependencies & Package Architecture

This document provides a comprehensive inventory of all third-party and native dependencies used across Scrapi v2.0, detailing why each package is used, which internal modules depend on it, and version compatibility requirements.

---

## 1. Production Dependencies

The following packages are installed under `dependencies` in [`package.json`](../package.json):

| Package | Version | Primary Purpose | Consuming Modules |
|---|---|---|---|
| [`axios`](https://www.npmjs.com/package/axios) | `^1.7.2` | High-performance HTTP client with Keep-Alive connection pooling. | [`src/fetchers/static.js`](../src/fetchers/static.js), [`src/spiders/sitemap.js`](../src/spiders/sitemap.js) |
| [`better-sqlite3`](https://www.npmjs.com/package/better-sqlite3) | `^11.0.0` | Ultra-fast, synchronous SQLite database driver in WAL mode. | [`src/storage.js`](../src/storage.js), [`src/spiders/engine.js`](../src/spiders/engine.js) |
| [`playwright`](https://www.npmjs.com/package/playwright) | `^1.60.0` | Headless Chromium automation and anti-bot stealth emulation. | [`src/fetchers/dynamic.js`](../src/fetchers/dynamic.js), [`src/fetchers/stealth.js`](../src/fetchers/stealth.js) |
| [`cheerio`](https://www.npmjs.com/package/cheerio) | `^1.0.0-rc.12` | Fast, lightweight HTML/XML parser and jQuery-like query engine. | [`src/parser/adaptor.js`](../src/parser/adaptor.js), [`src/parser/selector.js`](../src/parser/selector.js), [`src/scraper.js`](../src/scraper.js) |
| [`commander`](https://www.npmjs.com/package/commander) | `^12.1.0` | Command-line interface framework for options, subcommands, and help. | [`src/cli.js`](../src/cli.js) |
| [`express`](https://www.npmjs.com/package/express) | `^5.2.1` | Minimal web server for the Web Dashboard and iframe picker proxy. | [`src/ui/server.js`](../src/ui/server.js) |
| [`turndown`](https://www.npmjs.com/package/turndown) | `^7.2.0` | HTML-to-Markdown conversion engine. | [`src/parser/markdown.js`](../src/parser/markdown.js), [`src/scraper.js`](../src/scraper.js) |
| [`turndown-plugin-gfm`](https://www.npmjs.com/package/turndown-plugin-gfm) | `^1.0.2` | GitHub-Flavored Markdown plugin (tables, checklists, strikethrough). | [`src/parser/markdown.js`](../src/parser/markdown.js) |
| [`zod`](https://www.npmjs.com/package/zod) | `^4.4.3` | Schema declaration and runtime validation for MCP tools and profiles. | [`src/mcp/server.js`](../src/mcp/server.js), [`src/llm.js`](../src/llm.js) |
| [`dotenv`](https://www.npmjs.com/package/dotenv) | `^16.4.5` | Zero-dependency environment variable loader from `.env`. | [`src/cli.js`](../src/cli.js), [`src/ui/server.js`](../src/ui/server.js) |
| [`cors`](https://www.npmjs.com/package/cors) | `^2.8.6` | Cross-Origin Resource Sharing middleware for Express API routes. | [`src/ui/server.js`](../src/ui/server.js) |
| [`chalk`](https://www.npmjs.com/package/chalk) | `^5.3.0` | Terminal string styling and color formatting. | [`src/cli.js`](../src/cli.js) |
| [`ora`](https://www.npmjs.com/package/ora) | `^8.0.1` | Elegant terminal spinner animations for CLI tasks. | [`src/cli.js`](../src/cli.js) |
| [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk) | `^0.104.1` | Official Claude SDK for LLM-assisted selector and content extraction. | [`src/llm.js`](../src/llm.js) (optional) |

---

## 2. Development Dependencies

| Package | Version | Purpose |
|---|---|---|
| [`esbuild`](https://www.npmjs.com/package/esbuild) | `^0.28.0` | Ultra-fast JSX/JavaScript bundler that compiles [`src/ui/app.jsx`](../src/ui/app.jsx) into [`src/ui/app.js`](../src/ui/app.js) in $\sim 15\text{ms}$. Run via `npm run build:ui`. |

---

## 3. Detailed Package Justifications

### 3.1 `better-sqlite3` vs. `sqlite3`
* **Why chosen**: `better-sqlite3` executes queries synchronously using native C++ SQLite bindings. Because scraping creates thousands of small insert and update transactions (caching, frontier updates, checkpoints), asynchronous drivers introduce heavy Promise queuing and event-loop lag.
* **Performance gain**: `better-sqlite3` in Write-Ahead Logging (WAL) mode delivers $>30,000$ operations per second on local SSDs, preventing database I/O from bottlenecking network crawlers.

### 3.2 `cheerio` vs. `jsdom`
* **Why chosen**: Cheerio builds an in-memory abstract syntax tree (AST) using `htmlparser2` without simulating a full browser DOM, layout engine, or CSSOM.
* **Performance gain**: Cheerio parses HTML $\sim 8\text{--}10\times$ faster than JSDOM and uses less than $1/5\text{th}$ the memory footprint, making it ideal for high-throughput batch scrapers.

### 3.3 `playwright` vs. `puppeteer`
* **Why chosen**: Playwright provides superior multi-context isolation, built-in network idle triggers, robust anti-detection evasion, and unified cross-platform browser support.
* **Stealth capabilities**: Allows deep customization of `navigator.webdriver`, WebGL vendor strings, canvas noise, and realistic mouse trajectory interpolation.

### 3.4 `turndown` + `turndown-plugin-gfm`
* **Why chosen**: Industry-standard, highly extensible HTML-to-Markdown parser. The GFM plugin guarantees accurate rendering of table structures, code fences, and task lists.

---

## 4. Native Node.js Modules Used

Scrapi minimizes external package bloat by relying heavily on native Node.js standard library modules:

| Native Module | Usage in Scrapi |
|---|---|
| `node:buffer` | Used in [`src/polyfill.js`](../src/polyfill.js) to provide `globalThis.File` under Node.js 18. |
| `node:crypto` | Generates 64-bit SimHash tokens, content hashes, and random session IDs. |
| `node:fs` / `node:fs/promises` | Reads templates, writes output Markdown and JSON files to disk. |
| `node:path` | Cross-platform file path resolution and output directory sanitization. |
| `node:url` | URL parsing, origin validation, relative link resolution, and query parameter handling. |
| `node:http` / `node:https` | Connection pooling agents (`http.Agent`, `https.Agent`) with `keepAlive: true`. |
| `node:child_process` | Used in test runners ([`test.js`](../test.js)) to spawn isolated test suites. |
| `node:util` | `promisify` helpers and object inspection utilities. |

---

## 5. Compatibility & System Requirements

- **Node.js**: Requires `v18.0.0` or higher.
  - Verified on Node.js `v18.18.0`, `v20.11.0`, and `v22.x`.
  - Node.js 18 requires [`src/polyfill.js`](../src/polyfill.js) for `File` support.
- **NPM**: Version `9.0.0` or higher.
- **Operating Systems**:
  - **macOS**: Apple Silicon (M1/M2/M3/M4) and Intel x64.
  - **Linux**: Ubuntu 20.04+, Debian 11+, RHEL/CentOS 8+, Arch Linux. Requires standard Playwright dependencies (`npx playwright install-deps chromium`).
  - **Windows**: Windows 10/11 x64 (Native or WSL2 recommended).
