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
  - `list`: Show database history of past scrapes.
  - `show <id>`: Print Markdown content of a past scrape from DB.
  - `export <id>`: Re-export scraped Markdown to a custom output path.

### Phase 2: Interactive UI (Planned)
- Local React visual interface with element hover highlighting and click-to-select CSS selector auto-generation.
- Reuse saved profiles directly from the CLI via `scrape --profile <name> <url>`.

### Phase 3: LLM Intelligence (Planned)
- Structured schema-validated JSON extraction using Anthropic Claude & Zod.
- Predefined schemas: `article`, `product`, `event`, and `contact`.
- Auto-summarize and multi-scrape grouping.

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

### Run Batch Scrapes
Create a `urls.txt` file (one URL per line) and run:
```bash
node src/cli.js batch urls.txt
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
