# 🕷️ WebScraper (Scrapi)

A terminal-first, developer-grade web scraping tool built in Node.js. It extracts clean Markdown from web pages, logs scrape metadata to a SQLite database, supports visual scraping profiles, and leverages Anthropic Claude for smart content structuring.

---

## 🛠️ Features

### Phase 1: Terminal CLI (Complete)
- **High-Fidelity DOM Cleaning**: Strips banners, ads, headers, footers, popups, scripts, and styling to target only relevant content.
- **Smart Content Detection**: Automatically detects article or main body containers using text-to-tag heuristics.
- **Markdown Conversion**: Uses Turndown to produce clean, formatted Markdown files.
- **Metadata Logging**: Records URL, status, word count, filename, and timestamps in a local SQLite database.
- **Subcommands**:
  - `scrape <url>`: Scrape a single URL.
  - `batch <file>`: Process multiple URLs listed in a text file.
  - `spider <url>`: Recursively crawl and scrape an entire website under the same origin.
  - `list`: Show database history of past scrapes.
  - `show <id>`: Print Markdown content of a past scrape from DB.
  - `export <id>`: Re-export scraped Markdown to a custom output path.

### Phase 2: Interactive UI (Complete)
- **Local React Visual Console**: Beautiful dark-mode interface with element hover highlighting and click-to-select CSS selector generation.
- **Dual-Mode Hybrid Proxy**: Static render mode via Axios for instant preview frames (<100ms), falling back to Playwright only for dynamic/JS rendering.
- **Lag-Free Visual Selection**: 50ms debounced pointer events and caching on target DOM trees to avoid visual picker reflow lag.
- **Visual Scraping Profiles**: Save config as a named profile to SQLite, and execute it from terminal: `scrape --profile <name> <url>`.
- **Batch Scraping Enhancements**: 
  - **Category Sync**: Automatically discover and sync navigation categories from any target website into 1-click batch scrapers.
  - **Auto-Detect Link Selector**: One-click "🪄 Auto" heuristic scanner that mathematically determines the CSS selector for the dominant article/post feed on a page.
- **Media Downloading**: Automatically extract `<img>` tags, download assets locally into a `media/` subdirectory, and rewrite markdown paths to support full offline viewing.

### Phase 3: LLM Intelligence (Complete)
- **Structured JSON Extraction**: Convert Markdown to schema-validated JSON using Anthropic Claude or Local LLM.
- **Predefined Zod Schemas**: Support for `article`, `product`, `event`, and `contact` models.
- **Smart Result Caching**: Caches LLM parsing runs based on input SHA-256 hash to prevent redundant paid API calls.
- **Offline Fallbacks**: Automatically falls back to rule-based heuristic extraction patterns if API keys or endpoints are unavailable.
- **Auto-Summarization & Batch Grouping**: Multi-page grouping index maps URLs dynamically.
- **Crawl & Category Scraping**: Discover links on listing/index pages, scrape nested pages concurrently, tag them with database categories, and write files in hierarchical subdirectories (e.g. `./output/<category>/`).

---

## 🚀 Installation & Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```
2. **Make the CLI Executable**:
   ```bash
   chmod +x src/cli.js
   ```
3. **Start the Visual Web Console UI**:
   ```bash
   node src/ui/server.js
   ```
   This boots the server on `http://localhost:3001` and initializes the shared headless browser. Open `http://localhost:3001` in your web browser to access the interactive selector and dashboard.

---

## 📖 Usage Examples

### Scrape a Page (Save to Output Folder)
```bash
node src/cli.js scrape https://example.com
```

### Scrape & Print to Terminal (Skip DB Insert)
```bash
node src/cli.js scrape https://example.com --print --no-db
```

### Scrape with Custom Filename and Selector
```bash
node src/cli.js scrape https://news.ycombinator.com -s "table.itemlist" -f hn-home
```

### Scrape with Image Alt-Text Enabled
```bash
node src/cli.js scrape https://example.com --images
```

### Scrape and Download Local Media Copies
Automatically download images into a `./output/media/` folder and rewrite markdown paths:
```bash
node src/cli.js scrape https://example.com --images --download-media
```

### Run Batch Scrapes
Create a `urls.txt` file (one URL per line) and run:
```bash
node src/cli.js batch urls.txt
```

### Run Batch Scrapes with Custom Concurrency (Parallel Workers)
```bash
node src/cli.js batch urls.txt --concurrency 4
```

### View Scrape History
```bash
node src/cli.js list
```

### Show Saved Scrape Markdown Content
```bash
node src/cli.js show <scrape-id>
```

### Re-export past Scrape
```bash
node src/cli.js export <scrape-id> -d ./custom-folder/my-scraped-file.md
```

### Crawl and Scrape Nested Links
Extract anchor links matching a CSS selector on an index/list page and scrape them in parallel under a custom category:
```bash
node src/cli.js crawl https://news.ycombinator.com -s ".titleline > a" --category TechNews --concurrency 3
```

### Scrape and Tag with a Category
Save output in `./output/blog/` and log in SQLite under the category tag:
```bash
node src/cli.js scrape https://example.com/blog-post-1 --category blog
```

### Filter Scrapes List by Category
```bash
node src/cli.js list --category TechNews
```

### Spider and Crawl an Entire Website Recursively
Traverse internal links and save them using directory structures matching the site layout:
```bash
node src/cli.js spider https://example.com --max-pages 50 --concurrency 3 --delay 1000
```

---

## 🗄️ Database Schema (`data/scrapes.db`)

Scrapes are logged using the following schema:
- `id` (INTEGER, PK): Unique scrape reference.
- `url` (TEXT): Src URL.
- `title` (TEXT): Page `<title>` or OG equivalent.
- `description` (TEXT): Page meta description.
- `filename` (TEXT): Saved Markdown filename in `./output`.
- `word_count` (INTEGER): Words in extracted content.
- `scraped_at` (DATETIME): UTC timestamp.
- `status` (TEXT): `success` or `failed`.
- `error` (TEXT): Exception details if scraping failed.



## 📅 1-Week Sprint Tasks Progress

- [x] **Day 1: Setup & Scraper Core**
  - [x] Initialize workspace, create `package.json` with ESM, install dependencies
  - [x] Create `scraper.js` core fetching logic with Axios
  - [x] Create HTML DOM cleaning logic using Cheerio
  - [x] Implement smart content root detection fallbacks
  - [x] Convert HTML to clean Markdown with Turndown
- [x] **Day 2: DB Layer & CLI Commands**
  - [x] Initialize SQLite database schema (`scrapes` and `profiles` tables) in `storage.js`
  - [x] Implement query/insert database helper methods
  - [x] Implement CLI entry point in `cli.js` with Commander.js
  - [x] Add subcommands: `scrape`, `batch`, `list`, `show`, `export`
- [x] **Day 3: Express & Playwright Server**
  - [x] Install Playwright and set up browser launcher
  - [x] Implement local Express backend bridge in `ui/server.js`
  - [x] Implement endpoint to serve target page contents
- [x] **Day 4: React UI & Selector Gen**
  - [x] Build element highlighting picker dashboard (`index.html` and `picker.js`)
  - [x] Integrate visual click-to-selector generation
  - [x] Connect profile saving from UI to SQLite and support in CLI `scrape --profile <name>`
- [x] **Day 5: LLM API & Zod Validation**
  - [x] Integrate Anthropic SDK / Local LLM / Rule-based fallback in `llm.js`
  - [x] Define Zod validation schemas (`article`, `product`, `event`, `contact`)
  - [x] Connect CLI flags for LLM processing (`--llm`, `--extract`, `--summarize`, `--schema`)
- [x] **Day 6: Grouping, Categorization & Testing**
  - [x] Implement batch categorization and grouping logic (`--group`)
  - [x] Run manual integration tests on 10+ real-world URLs
- [x] **Day 7: Documentation & Polish**
  - [x] Write user guide in `README.md`
  - [x] Final visual design adjustments and error boundary checks
  - [x] Create walkthrough and architecture documentation