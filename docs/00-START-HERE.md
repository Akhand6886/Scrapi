# 🧭 Scrapi v2.0 Documentation: Start Here

Welcome to the technical documentation for **Scrapi v2.0**. This document serves as the central directory and navigation guide for the entire documentation suite.

---

## What is Scrapi?

**Scrapi** is an adaptive, high-performance, developer-grade web scraping and crawling framework built for Node.js. It combines:

1. **Progressive Multi-Tier Fetching**: Automatic escalation across static HTTP requests, Playwright headless browser rendering, and stealth anti-bot evasion.
2. **Machine-Learning Tier Routing & Content Extraction**: CART Decision Trees and Random Forest ensembles that dynamically evaluate page complexity, anti-bot challenges, link priority, and main content candidates.
3. **Thompson-Sampling Bayesian Multi-Armed Bandit**: Online reinforcement learning that learns domain anti-bot defenses over time to bypass unnecessary probing roundtrips.
4. **Adaptive Self-Healing Selectors**: 64-bit SimHash DOM fingerprinting that automatically recalculates and recovers CSS selectors when website redesigns break them.
5. **Exhaustive Dual-Frontier Topic Crawling**: Non-interrupting link traversal that systematically discovers and extracts all content under a given topic or category from its earliest historical publication to the current date.
6. **Multi-Interface Access**: An interactive REPL shell, full CLI suite, Model Context Protocol (MCP) server for AI coding assistants, and a web dashboard with a visual element picker.

---

## 🗺️ Documentation Directory

| Document | Focus Area |
|---|---|
| [01-PROJECT-OVERVIEW.md](./01-PROJECT-OVERVIEW.md) | High-level purpose, capabilities, major features, design principles, and limitations. |
| [02-ARCHITECTURE.md](./02-ARCHITECTURE.md) | Subsystem architecture, component relationships, design patterns, and system diagrams. |
| [03-PROJECT-STRUCTURE.md](./03-PROJECT-STRUCTURE.md) | Codebase directory organization, file manifests, and individual module responsibilities. |
| [04-DATA-FLOW.md](./04-DATA-FLOW.md) | Step-by-step lifecycle of scrape and crawl requests from input to output with Mermaid diagrams. |
| [05-CORE-ENGINE.md](./05-CORE-ENGINE.md) | Scraper lifecycle, orchestration pipelines, and coordination across fetchers, parsers, and storage. |
| [06-FETCHERS.md](./06-FETCHERS.md) | `StaticFetcher`, `DynamicFetcher`, `StealthyFetcher`, `FetcherPool`, tier escalation, and HTTP caching. |
| [07-PARSERS-AND-SELECTORS.md](./07-PARSERS-AND-SELECTORS.md) | `Response` adaptor, CSS/XPath querying, regex filters, JSON-LD metadata extraction, and Markdown output. |
| [08-ADAPTIVE-ENGINE.md](./08-ADAPTIVE-ENGINE.md) | Self-healing engine, 64-bit SimHash fingerprinting, Hamming distance, and structural pattern clustering. |
| [09-CRAWLING-ENGINE.md](./09-CRAWLING-ENGINE.md) | Dual-frontier queues, `TopicCrawler`, `PaginationEngine`, `SitemapEngine`, `TopicMatcher`, and rate-limiting. |
| [10-DATABASE-AND-STORAGE.md](./10-DATABASE-AND-STORAGE.md) | SQLite schema, WAL mode, table indexes, Markdown file organization, and media downloads. |
| [11-CHECKPOINTS-AND-RESUME.md](./11-CHECKPOINTS-AND-RESUME.md) | State serialization in `spider_checkpoints`, deduplication, and crash recovery via `--resume`. |
| [12-CLI-COMMANDS.md](./12-CLI-COMMANDS.md) | Comprehensive reference for all 15 CLI commands with arguments, flags, and usage examples. |
| [13-WEB-DASHBOARD.md](./13-WEB-DASHBOARD.md) | Express API, React 18 dashboard, iframe visual selector picker proxy, and real-time state monitors. |
| [14-MCP-SERVER.md](./14-MCP-SERVER.md) | Model Context Protocol stdio server, tool definitions, schemas, and integration with AI coding assistants. |
| [15-API-REFERENCE.md](./15-API-REFERENCE.md) | Public programmatic Node.js API exports, class signatures, method parameters, and code snippets. |
| [16-CONFIGURATION.md](./16-CONFIGURATION.md) | Environment variables, defaults, rate limits, timeouts, and CLI options. |
| [17-ERROR-HANDLING.md](./17-ERROR-HANDLING.md) | Error taxonomy, fetcher retry strategies, anti-bot challenge fallbacks, and crawl failure logging. |
| [18-PERFORMANCE.md](./18-PERFORMANCE.md) | HTTP Keep-Alive pooling, Cheerio noise stripping, WAL SQLite indexing, and memory optimization. |
| [19-SECURITY.md](./19-SECURITY.md) | Anti-bot stealth simulation, iframe proxy sandbox, input sanitization, and credential handling. |
| [20-INSTALLATION-AND-SETUP.md](./20-INSTALLATION-AND-SETUP.md) | Prerequisites, Node.js polyfills, package installation, Playwright browser setup, and smoke testing. |
| [21-USER-GUIDE.md](./21-USER-GUIDE.md) | Practical step-by-step user tutorials for single-page scraping, site crawling, and topic extraction. |
| [22-DEVELOPER-GUIDE.md](./22-DEVELOPER-GUIDE.md) | Codebase navigation, adding custom fetchers, training new decision trees, and extending parsers. |
| [23-TROUBLESHOOTING.md](./23-TROUBLESHOOTING.md) | Diagnostic workflows, common error messages, Playwright headless issues, and recovery actions. |
| [24-LIMITATIONS-AND-GAPS.md](./24-LIMITATIONS-AND-GAPS.md) | Identified architectural gaps, partial implementations, edge cases, and future work. |
| [25-DEPENDENCIES.md](./25-DEPENDENCIES.md) | Third-party dependency inventory, purposes, module relationships, and version constraints. |

---

## 🔍 "I Want to Understand..."

Use this index to jump directly to the exact file covering your question:

- **How does Scrapi work internally from a high level?**  
  ➔ Read [02-ARCHITECTURE.md](./02-ARCHITECTURE.md)

- **What does each file and directory in `src/` do?**  
  ➔ Read [03-PROJECT-STRUCTURE.md](./03-PROJECT-STRUCTURE.md)

- **How does data travel from a CLI or Web UI request into a saved file?**  
  ➔ Read [04-DATA-FLOW.md](./04-DATA-FLOW.md)

- **How does the multi-tier fetcher choose between Static, Dynamic, and Stealth modes?**  
  ➔ Read [06-FETCHERS.md](./06-FETCHERS.md)

- **How do CSS, XPath, and JSON-LD metadata extractors work?**  
  ➔ Read [07-PARSERS-AND-SELECTORS.md](./07-PARSERS-AND-SELECTORS.md)

- **How does self-healing recover broken CSS selectors when a website redesigns?**  
  ➔ Read [08-ADAPTIVE-ENGINE.md](./08-ADAPTIVE-ENGINE.md)

- **How does Scrapi discover every article under a topic from 2024 to the present?**  
  ➔ Read [09-CRAWLING-ENGINE.md](./09-CRAWLING-ENGINE.md)

- **Where is scraped data stored and what does the SQLite database schema look like?**  
  ➔ Read [10-DATABASE-AND-STORAGE.md](./10-DATABASE-AND-STORAGE.md)

- **How does pause and resume work if a large crawl stops halfway?**  
  ➔ Read [11-CHECKPOINTS-AND-RESUME.md](./11-CHECKPOINTS-AND-RESUME.md)

- **How do I run Scrapi commands from the terminal?**  
  ➔ Read [12-CLI-COMMANDS.md](./12-CLI-COMMANDS.md)

- **How does the Web Dashboard and visual iframe selector picker work?**  
  ➔ Read [13-WEB-DASHBOARD.md](./13-WEB-DASHBOARD.md)

- **How do AI agents (Claude, Cursor, Antigravity) control Scrapi via MCP?**  
  ➔ Read [14-MCP-SERVER.md](./14-MCP-SERVER.md)

- **How do I import and use Scrapi in my own Node.js code?**  
  ➔ Read [15-API-REFERENCE.md](./15-API-REFERENCE.md)

- **What environment variables and configuration options exist?**  
  ➔ Read [16-CONFIGURATION.md](./16-CONFIGURATION.md)

- **Why did my crawl fail or get blocked by Cloudflare?**  
  ➔ Read [17-ERROR-HANDLING.md](./17-ERROR-HANDLING.md) and [23-TROUBLESHOOTING.md](./23-TROUBLESHOOTING.md)

- **What are the known limitations or incomplete features in Scrapi v2.0?**  
  ➔ Read [24-LIMITATIONS-AND-GAPS.md](./24-LIMITATIONS-AND-GAPS.md)
