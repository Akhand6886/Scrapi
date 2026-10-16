# 🛠️ Installation & Setup: Scrapi v2.0

## 1. System Prerequisites

Before installing Scrapi v2.0, ensure your environment meets the following requirements:

- **Node.js**: Version `18.0.0` or higher (verified on Node.js `v18.18.0` and Node.js `v20.x`).
- **NPM**: Version `9.0.0` or higher.
- **Operating System**: macOS (Apple Silicon & Intel), Linux (Ubuntu 20.04+, Debian, Arch), or Windows 10/11 (WSL2 recommended).
- **System Libraries for Chromium**: If running on headless Linux, install standard Playwright system dependencies (`libasound2`, `libnss3`, `libxss1`).

---

## 2. Step-by-Step Installation

### Step 1: Clone the Repository
```bash
git clone https://github.com/Akhand6886/Scrapi.git
cd Scrapi
```

### Step 2: Install Node.js Dependencies
```bash
npm install
```

### Step 3: Install Playwright Headless Browser
Scrapi requires Playwright Chromium for its `dynamic` and `stealth` fetcher tiers. Install the Chromium browser binary:
```bash
npx playwright install chromium
```
*(Optional on Linux)*: If missing system GUI libraries, run:
```bash
npx playwright install-deps chromium
```

### Step 4: Build the Web UI Bundle
Compile the React 18 dashboard interface:
```bash
npm run build:ui
```
This runs `esbuild` to compile [`src/ui/app.jsx`](../src/ui/app.jsx) into [`src/ui/app.js`](../src/ui/app.js) in $\sim 15\text{ms}$.

---

## 3. Node.js 18 Polyfill Notice

Node.js v18 does not define the global `File` constructor by default, which causes modern HTTP libraries (`undici`, `axios`) to throw runtime exceptions.

Scrapi automatically includes a polyfill at [`src/polyfill.js`](../src/polyfill.js):
```javascript
import { File } from 'node:buffer';
if (typeof globalThis.File === 'undefined') {
  globalThis.File = File;
}
```
All CLI entrypoints, test files, and servers import `./src/polyfill.js` first to ensure seamless execution across Node 18, 20, and 22.

---

## 4. Verification & Smoke Testing

To verify that all subsystems, decision trees, SQLite tables, fetchers, and spiders are functioning correctly, run the comprehensive test suite:

```bash
npm test
```

Expected output:
```text
🚀 Running all Scrapi test suites...

▶ Running test_latest_methods.js...
✅ test_latest_methods.js passed!

▶ Running test_decision_tree.js...
✅ test_decision_tree.js passed!

▶ Running test_scrapling_arch.js...
✅ test_scrapling_arch.js passed!

▶ Running test_spider.js...
✅ test_spider.js passed!

▶ Running test_optimizations.js...
✅ test_optimizations.js passed!

▶ Running test_category_crawl.js...
✅ test_category_crawl.js passed!

▶ Running test_topic_crawl.js...
✅ test_topic_crawl.js passed!

🎉 All test suites passed successfully!
```

---

## 5. Running Scrapi

### 5.1 Launch the CLI
```bash
node src/cli.js --help
```

### 5.2 Launch the Web Dashboard
```bash
node src/cli.js serve --port 3000
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5.3 Launch the Interactive REPL Shell
```bash
node src/cli.js shell https://example.com
```
