# 📖 Scrapi v2.0: Practical User Guide

This guide provides beginner-friendly, step-by-step instructions for using Scrapi v2.0 to scrape individual web pages, extract clean Markdown, crawl entire publication topics, and use interactive tools like the Web Dashboard, Visual Picker, and REPL shell.

---

## 1. Quickstart: Scraping a Single Page

The most common use case is extracting the main text, metadata, and structured content from an article or blog post.

### 1.1 Basic Scrape to Terminal
To scrape a page and display its extracted metadata and content in the terminal:

```bash
node src/cli.js scrape https://example.com/blog/sample-post
```

### 1.2 Save Clean Markdown to File
By default, Scrapi's core engine cleans advertising noise, navigation headers, and footers, converting the article body into clean GitHub-Flavored Markdown:

```bash
node src/cli.js scrape https://example.com/blog/sample-post --markdown -o output/sample.md
```

### 1.3 Handling JavaScript-Rendered Pages
If the target website is a Single Page Application (SPA) built with React, Vue, or Angular, static HTTP requests will only receive an empty container (`<div id="root"></div>`). Use the `--dynamic` flag to render the page in headless Chromium:

```bash
node src/cli.js scrape https://spa-website.com/posts/123 --dynamic
```

### 1.4 Bypassing Anti-Bot Defenses
If a site returns `403 Forbidden` or displays a Cloudflare verification challenge, use the `--stealth` flag to enable anti-detection measures (fingerprint spoofing, WebGL emulation, humanized mouse movements):

```bash
node src/cli.js scrape https://protected-site.com/data --stealth
```

---

## 2. Exhaustive Topic & Category Crawling

When you want to capture **all articles** published under a specific topic, category, or section from the earliest historical archives to the present date, use the `topic-crawl` command.

### 2.1 Basic Topic Crawl
To start discovering and archiving articles under a specific topic:

```bash
node src/cli.js topic-crawl https://techcrunch.com/category/artificial-intelligence/ \
  --topic "artificial-intelligence" \
  --out-dir ./downloads/ai-articles
```

### 2.2 Date Filtering (Historical Crawls)
To restrict your crawl to articles published on or after a specific date (e.g., from January 1, 2024 to present):

```bash
node src/cli.js topic-crawl https://example.com/news/finance/ \
  --topic "finance" \
  --since 2024-01-01 \
  --out-dir ./downloads/finance-2024
```

### 2.3 Controlling Crawl Speed & Concurrency
To respect server capacity or avoid rate-limit bans (HTTP 429), configure request concurrency and inter-request delays:

```bash
node src/cli.js topic-crawl https://example.com/category/tech/ \
  --topic "tech" \
  --concurrency 3 \
  --delay 1000 \
  --out-dir ./downloads/tech
```
- `--concurrency 3`: Up to 3 parallel requests simultaneously.
- `--delay 1000`: 1-second pause between outgoing requests per worker.

### 2.4 Resuming an Interrupted Crawl
If a crawl of 5,000 articles is interrupted due to network loss or machine reboot, you can resume exactly where it stopped without re-scraping existing pages:

```bash
node src/cli.js topic-crawl https://example.com/category/tech/ \
  --resume \
  --topic "tech" \
  --out-dir ./downloads/tech
```
Scrapi loads the previous state from SQLite (`spider_checkpoints`) and skips all URLs already marked as `completed`.

---

## 3. General Website Spidering

If you want to crawl all pages across an entire domain rather than filtering by a specific topic, use the `crawl` command.

### 3.1 Domain-Constrained Crawl
Crawl up to 50 pages belonging to `example.com`:

```bash
node src/cli.js crawl https://example.com --max-pages 50
```

### 3.2 Depth-Limited Crawl
Limit link traversal depth to 2 clicks from the homepage:

```bash
node src/cli.js crawl https://example.com --max-depth 2
```

---

## 4. Interactive Tools

### 4.1 Web Dashboard & Visual Element Picker
Scrapi includes a web dashboard that allows you to trigger scrapes, inspect crawl jobs, and point-and-click to select DOM elements in a live preview.

1. Start the server:
   ```bash
   node src/cli.js serve --port 3000
   ```
2. Open your browser to [http://localhost:3000](http://localhost:3000).
3. Navigate between the four tabs:
   - **Dashboard**: System telemetry, memory usage, and recent scrapes.
   - **Visual Picker**: Enter any URL to render it inside an interactive sandbox. Click on headlines, authors, or content blocks to visually extract their CSS selectors.
   - **Profiles**: View saved domain profiles and selector configurations.
   - **Logs & Monitor**: Real-time server and crawl logs.

### 4.2 Interactive REPL Shell
For quick debugging and experimenting with CSS or XPath selectors directly from your terminal:

```bash
node src/cli.js shell https://news.ycombinator.com
```

Inside the interactive shell:
```javascript
// Query all story headlines
response.css('.titleline > a').map(el => el.text)

// Query via XPath
response.xpath('//span[@class="score"]').map(el => el.text)

// View page status code and headers
response.status
response.headers
```

---

## 5. Inspecting Saved Scrapes & Database Storage

All scraping operations are automatically persisted in a local SQLite database (`scrapi.db`).

### 5.1 CLI Inspection
To view metadata and the first 200 characters of a stored scrape by ID:

```bash
node src/cli.js inspect 1
```

### 5.2 Direct SQLite Access
You can inspect or query the database using the standard SQLite CLI or any GUI (e.g., DB Browser for SQLite):

```bash
sqlite3 scrapi.db "SELECT id, url, title, fetched_at FROM scrapes ORDER BY id DESC LIMIT 5;"
```

---

## 6. Programmatic Usage in Node.js

You can import Scrapi directly into your own Node.js scripts:

```javascript
import './src/polyfill.js';
import { Scraper } from './src/scraper.js';

const scraper = new Scraper({
  fetcherType: 'static',
  enableCache: true
});

async function run() {
  const result = await scraper.scrapePage('https://example.com/article', {
    markdown: true
  });

  console.log('Title:', result.title);
  console.log('Published:', result.publishedTime);
  console.log('Markdown Content:\n', result.markdown);
}

run();
```

---

## 7. Connecting Scrapi to AI Assistants (Claude & Cursor)

Scrapi exposes an official **Model Context Protocol (MCP)** server over standard I/O (`stdio`), allowing AI coding assistants to scrape web pages and crawl topics on demand.

### 7.1 Starting the MCP Server
```bash
node src/cli.js mcp
```

### 7.2 Cursor Integration
In Cursor Settings ➔ Features ➔ MCP Servers, click **Add New MCP Server**:
- **Name**: `scrapi`
- **Type**: `command`
- **Command**: `node /absolute/path/to/Scrapi/src/cli.js mcp`

### 7.3 Claude Desktop Integration
Add the following configuration to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "scrapi": {
      "command": "node",
      "args": ["/absolute/path/to/Scrapi/src/cli.js", "mcp"]
    }
  }
}
```

Once connected, your AI assistant can use tools like `scrape_page`, `topic_crawl`, `extract_content`, and `get_crawl_status` directly inside chat prompts.

---

## 8. Summary of Common Workflows

| Task | Recommended Command |
|---|---|
| Single article to terminal | `node src/cli.js scrape <url>` |
| Single article to Markdown file | `node src/cli.js scrape <url> --markdown -o article.md` |
| JavaScript-heavy SPA | `node src/cli.js scrape <url> --dynamic` |
| Cloudflare-protected site | `node src/cli.js scrape <url> --stealth` |
| Full topic/category archive | `node src/cli.js topic-crawl <url> --topic <topic> --out-dir <dir>` |
| Interactive element selector | `node src/cli.js serve` ➔ Visual Picker |
| Interactive selector testing | `node src/cli.js shell <url>` |
| AI Agent Integration | `node src/cli.js mcp` |
