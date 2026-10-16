# 🔒 Security & Safety Controls: Scrapi v2.0

## 1. Security Architecture Overview

Web scrapers and crawlers interact with untrusted external web content. Scrapi v2.0 establishes strict defensive boundaries across:
1. **Filesystem Path Traversal Defenses**
2. **Browser Execution Sandboxing**
3. **Web Dashboard Proxy Isolation**
4. **Crawl Origin Boundaries**
5. **Secret & Credential Management**

---

## 2. Path Traversal & Filename Sanitization

Writing scraped files to disk based on arbitrary remote URLs poses a severe **Directory Traversal (`../`)** risk. A malicious page with URL `https://example.com/../../etc/passwd` could attempt to overwrite sensitive operating system files.

In [`src/spiders/engine.js`](../src/spiders/engine.js) and [`src/storage.js`](../src/storage.js), Scrapi enforces rigorous sanitization:

```javascript
// 1. Sanitize hostname (strip non-alphanumeric characters)
const host = urlObj.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');

// 2. Sanitize every path segment, eliminating '../' and '.'
const segments = pathname.split('/')
  .map(seg => seg.replace(/[^a-zA-Z0-9_.-]/g, '_'))
  .filter(seg => seg && seg !== '..' && seg !== '.');

// 3. Extract and bound base filename length
const rawBaseName = segments.pop() || 'index';
const safeFilename = rawBaseName.slice(0, 50);

// 4. Resolve strictly within designated outputDir
const targetPath = path.resolve(outputDir, host, ...segments, `${safeFilename}.md`);
if (!targetPath.startsWith(path.resolve(outputDir))) {
  throw new Error('Access Denied: Path traversal detected.');
}
```

---

## 3. Crawl Origin & Domain Boundary Enforcement

To prevent accidental crawling of the public internet when scraping a specific site, [`CrawlEngine.isAllowedUrl()`](../src/spiders/engine.js) enforces origin containment:

1. **Origin Matching**: By default, the crawler restricts itself strictly to `new URL(seedUrl).origin`. Links pointing to external domains (e.g. social media, third-party CDNs, external trackers) are immediately discarded.
2. **Allowed Domains List**: When provided via `options.allowedDomains`, links are only traversed if `new URL(targetUrl).hostname` exactly matches or is a subdomain of an allowed domain (e.g. `blog.example.com` matches `example.com`).
3. **Protocol Filtering**: Non-HTTP protocols (`javascript:`, `file:`, `data:`, `mailto:`, `tel:`, `ssh:`) are rejected before enqueueing.

---

## 4. Web Dashboard Proxy Sandboxing

The Web Dashboard visual picker uses a backend proxy (`/api/proxy?url=...` in [`src/ui/server.js`](../src/ui/server.js)) to render target web pages in an iframe:

- **Script Stripping**: Potentially malicious third-party scripts that could attempt clickjacking or frame-busting are stripped from the proxied HTML.
- **Header Rewriting**: Strips restrictive `Content-Security-Policy` (CSP) and `X-Frame-Options` headers that would otherwise prevent local developer inspection.
- **CORS Configuration**: Restricts API cross-origin requests to authorized local interfaces.

---

## 5. Browser Automation Security

In [`src/fetchers/dynamic.js`](../src/fetchers/dynamic.js) and [`src/fetchers/stealth.js`](../src/fetchers/stealth.js):
- **Chromium Sandboxing**: Runs Playwright using standard OS sandboxing boundaries.
- **Context Isolation**: Every dynamic request executes inside an isolated browser context, ensuring cookies, localStorage, and authentication sessions from previous sites cannot bleed into subsequent requests.
- **Lifecycle Guarantees**: Contexts and pages are closed in `finally` blocks, preventing resource exhaustion or memory retention.

---

## 6. Secret & Credential Handling

- **Zero Hardcoded Secrets**: Scrapi contains no embedded API keys or database passwords.
- **Environment Isolation**: The Anthropic Claude API key (`ANTHROPIC_API_KEY`) is read strictly from `process.env`.
- **Database Sanitization**: SQLite tables (`scrapes`, `profiles`) store only scraped document text, CSS selectors, and public URLs—never environment variables, auth tokens, or private keys.
