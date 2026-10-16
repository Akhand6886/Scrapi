# 💻 CLI Commands Reference: Scrapi v2.0

Scrapi provides 15 command-line subcommands via [`src/cli.js`](../src/cli.js).

---

## 1. `scrape <url>`
Scrapes a single web page, extracts structured metadata, and saves clean Markdown.

### Syntax
```bash
node src/cli.js scrape <url> [options]
```

### Options
| Option | Description | Default |
|---|---|---|
| `-f, --fetcher <type>` | Fetcher tier: `auto`, `static`, `dynamic`, `stealth` | `'auto'` |
| `-s, --selector <css>` | Target specific CSS selector for main content | `'auto'` |
| `-o, --output <dir>` | Directory to save Markdown output file | `'./output'` |
| `--images` | Include image Markdown tags (`![alt](src)`) in output | `false` |
| `--download-media` | Download embedded images to local `media/` directory | `false` |
| `--no-meta` | Skip YAML frontmatter header block | `false` |
| `--no-db` | Skip logging scrape record into SQLite | `false` |
| `--no-cache` | Bypass conditional HTTP caching (`If-None-Match`) | `false` |
| `--timeout <ms>` | Request timeout in milliseconds | `15000` |
| `--profile <name>` | Load visual selector profile by name | `null` |
| `--llm` | Enable LLM post-processing via Anthropic Claude | `false` |
| `--extract <prompt>` | Plain-English extraction prompt for LLM | `null` |
| `--summarize` | Generate concise summary via LLM | `false` |
| `--schema <name>` | Zod validation schema (`article`, `product`, `event`) | `'custom'` |

### Example
```bash
node src/cli.js scrape https://example.com/blog/article-1 -f dynamic --download-media
```

---

## 2. `topic <url> [topic]`
Exhaustively crawls and extracts all content under a category or topic from earliest available date to current date.

### Syntax
```bash
node src/cli.js topic <url> [topic] [options]
```

### Options
| Option | Description | Default |
|---|---|---|
| `-f, --fetcher <type>` | Fetcher tier: `auto`, `static`, `dynamic`, `stealth` | `'auto'` |
| `-o, --output <dir>` | Output folder for Markdown files | `'./output'` |
| `-c, --concurrency <n>`| Number of parallel scraper workers | `2` |
| `-m, --max-pages <n>` | Maximum page limit | `Infinity` |
| `-d, --depth <n>` | Maximum depth level | `Infinity` |
| `--delay <ms>` | Polite delay between requests in milliseconds | `1000` |
| `--no-sitemap` | Disable historical XML sitemap discovery | `false` |
| `--download-media` | Download images to local media directory | `false` |
| `--resume <jobId>` | Resume crawl from a saved checkpoint ID | `null` |

### Example
```bash
node src/cli.js topic https://example.com "Analysis" --concurrency 4 --delay 500
```

---

## 3. `crawl <url>`
Crawls a listing page, extracts discovered links, and scrapes them concurrently under a category.

### Syntax
```bash
node src/cli.js crawl <url> [options]
```

### Options
| Option | Description | Default |
|---|---|---|
| `-s, --selector <css>` | CSS selector targeting anchor links on list page | `'a'` |
| `--category <name>` | Category tag to organize scrapes and subfolders | hostname |
| `-l, --limit <n>` | Maximum number of discovered links to scrape | unlimited |
| `-c, --concurrency <n>`| Concurrent worker threads | `2` |
| `--topic <name>` | Filter links matching a topic name | `null` |
| `--exhaustive` | Enable exhaustive traversal to earliest publication | `false` |
| `--sitemap` | Discover historical sitemaps | `false` |

### Example
```bash
node src/cli.js crawl https://example.com/news -s "article.post a" --category news -c 3
```

---

## 4. `spider <url>`
Recursively crawls and scrapes an entire website under the same origin.

### Syntax
```bash
node src/cli.js spider <url> [options]
```

### Options
| Option | Description | Default |
|---|---|---|
| `-m, --max-pages <n>` | Maximum pages to visit | `100` |
| `-d, --depth <n>` | Maximum crawl depth from seed URL | `Infinity` |
| `-c, --concurrency <n>`| Concurrent worker threads | `2` |
| `--delay <ms>` | Polite delay between requests | `1500` |
| `--resume <jobId>` | Resume an interrupted crawl | `null` |

### Example
```bash
node src/cli.js spider https://example.com -m 50 -d 3 -c 4 --delay 500
```

---

## 5. `shell [url]`
Opens an interactive Node.js REPL console to test CSS selectors, XPath queries, and Markdown conversion live.

### Syntax
```bash
node src/cli.js shell [url]
```

### Example
```bash
node src/cli.js shell https://example.com
```
Inside the shell:
```javascript
response.css('h1').text;
response.xpath('//article//a').attribs('href');
response.toMarkdown();
```

---

## 6. `mcp`
Starts the Model Context Protocol (MCP) server over stdio for AI agent integration (Cursor, Claude, Antigravity).

### Syntax
```bash
node src/cli.js mcp
```

---

## 7. `serve`
Launches the Web Dashboard and visual selector picker server.

### Syntax
```bash
node src/cli.js serve [options]
```

### Options
| Option | Description | Default |
|---|---|---|
| `-p, --port <port>` | Port number to bind HTTP server | `3000` |

### Example
```bash
node src/cli.js serve --port 3000
```

---

## 8. `batch <file>`
Scrapes a list of URLs from a plain-text file (one URL per line).

### Syntax
```bash
node src/cli.js batch urls.txt [options]
```

---

## 9. `list`
Displays a formatted terminal table of past scrapes from the SQLite database.

### Syntax
```bash
node src/cli.js list [options]
```

### Options
| Option | Description | Default |
|---|---|---|
| `-l, --limit <n>` | Maximum rows to display | `20` |
| `--category <name>` | Filter rows by category tag | `null` |

---

## 10. `show <id>`
Prints the extracted Markdown content of a past scrape by its SQLite database ID.

### Syntax
```bash
node src/cli.js show 42
```

---

## 11. `export <id>`
Re-exports a past scrape from SQLite to a new Markdown file.

### Syntax
```bash
node src/cli.js export 42 [options]
```

---

## 12. `discover <url>`
Inspects a web page and lists all discovered internal links matching a CSS selector without downloading full content.

### Syntax
```bash
node src/cli.js discover https://example.com/blog -s "article a"
```

---

## 13. `entities <url>`
Runs unsupervised structural entity induction to extract repeating cards (products, listings) into JSON without manual selectors.

### Syntax
```bash
node src/cli.js entities https://store.example.com/products [options]
```

---

## 14. `bandit [domain]`
Inspects the reinforcement learning multi-armed bandit's defense distribution priors for a domain or displays all known domain profiles.

### Syntax
```bash
# View all domain defense profiles
node src/cli.js bandit

# View specific domain priors and probe bypass status
node src/cli.js bandit example.com
```

---

## 15. `benchmark`
Executes automated latency, throughput, memory consumption, and anti-bot evasion benchmark suites.

### Syntax
```bash
node src/cli.js benchmark [options]
```
