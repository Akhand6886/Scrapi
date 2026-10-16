# ⚙️ Core Engine: Scrapi v2.0

## 1. Core Engine Overview

The Core Engine is implemented in [`src/scraper.js`](../src/scraper.js). It acts as the central coordinator between:
1. **Networking & Fetchers** ([`src/fetchers/`](../src/fetchers/))
2. **Parsing & Content Scoring** ([`src/parser/`](../src/parser/) and [`src/trees/`](../src/trees/))
3. **Database & File Storage** ([`src/storage.js`](../src/storage.js))

It encapsulates single-page scraping workflows, element selection heuristics, automated category link discovery, and link selector detection.

---

## 2. Core Functions Reference (`src/scraper.js`)

### 2.1 `scrapePage(url, options)`
The primary programmatic function for scraping a single web page.

- **Signature**: `async function scrapePage(url, options = {})`
- **Parameters**:
  - `url` *(string, required)*: The target HTTP/HTTPS URL.
  - `options` *(object, optional)*:
    - `fetcher`: Fetcher tier (`'auto'`, `'static'`, `'dynamic'`, `'stealth'`). Defaults to `'auto'`.
    - `selector`: Custom CSS selector or signature object for targeting main content. Defaults to `'auto'`.
    - `downloadMedia`: Boolean indicating whether to download embedded images locally.
    - `noCache`: Boolean to bypass HTTP cache.
    - `timeout`: Timeout in milliseconds.
- **Return Value**: `Promise<object>` containing:
  - `metadata`: Comprehensive metadata object (title, description, date, author, category, tags, canonical URL).
  - `markdown`: Clean GitHub-Flavored Markdown string.
  - `media`: Array of downloaded media objects (`{ url, filename }`).
  - `decisionTree`: Diagnostic report from the `TierRouterTree` if auto-escalation ran.
- **Execution Flow**:
  ```javascript
  // 1. Fetch page using global pool with auto-escalation
  const response = await globalFetcherPool.fetch(url, options);

  // 2. Extract metadata via Response adaptor
  const $ = response.$;
  const metadata = extractMetadata($, url);

  // 3. Clean DOM and resolve relative URLs
  cleanDom($);
  resolveUrls($, url);

  // 4. Locate best content root using selector or Decision Tree
  const contentRoot = findBestContentRoot($, options.selector);

  // 5. Convert content root to Markdown
  const markdown = convertToMarkdown(contentRoot, options);
  metadata.word_count = contentRoot.text().trim().split(/\s+/).filter(Boolean).length;
  ```

---

### 2.2 `fetchHtml(url, options)`
Lightweight helper to retrieve raw HTML from a URL using the global fetcher pool.

- **Signature**: `async function fetchHtml(url, options = {})`
- **Parameters**: `url` *(string)*, `options` *(object)*.
- **Return Value**: `Promise<string>` (raw HTML text).
- **Implementation**:
  ```javascript
  export async function fetchHtml(url, options = {}) {
    const response = await globalFetcherPool.fetch(url, options);
    return response.rawHtml;
  }
  ```

---

### 2.3 `cleanDom($)`
Removes noisy, non-content elements from the Cheerio DOM instance in a single optimized pass.

- **Signature**: `export function cleanDom($)`
- **Elements Removed**: Defined in [`NOISE_SELECTORS`](../src/parser/adaptor.js):
  - Structural: `nav`, `header`, `footer`, `aside`, `iframe`
  - Scripts: `script`, `style`, `noscript`
  - Utility/Overlays: `.cookie-banner`, `.popup`, `.ad`, `.advertisement`, `[aria-hidden="true"]`, `#cookie-consent`, `.social-share`
- **Implementation**:
  ```javascript
  export function cleanDom($) {
    $(NOISE_SELECTORS.join(', ')).remove();
  }
  ```

---

### 2.4 `findBestContentRoot($, selector)`
Determines the primary content container element within the DOM using a prioritized fallback hierarchy:

1. **Explicit Custom Selector**: If `selector` is provided and not `'auto'`, tests `$(selector)`.
2. **Self-Healing Relocation**: If custom selector fails and an element signature is provided, triggers [`AdaptiveEngine.relocate($, signature)`](../src/parser/adaptive.js).
3. **Decision Tree Evaluation**: Runs all candidate containers (`article`, `main`, `section`, `div.content`, `div.post`) through [`scoreContentElement($, elem)`](../src/trees/content_extractor.js). If a candidate achieves `classification === 'MAIN_CONTENT'`, it is selected.
4. **Standard Semantic Fallbacks**:
   - `$('article').first()`
   - `$('main, [role="main"]').first()`
   - `$('.content, .post-content, .article-body, #content, #main').first()`
5. **Text-to-Tag Ratio Div**: Computes text-to-tag ratio for all `div` elements with text length > 100 characters:
   $$\text{Ratio} = \frac{\text{textLength}}{\text{tagCount} + 1}$$
   The `div` with the highest ratio is selected.
6. **Ultimate Fallback**: `$('body').first()`.

---

### 2.5 `extractMetadata($, url)`
Extracts structured document metadata. In Scrapi v2.0, this function delegates directly to [`Response.extractMetadata()`](../src/parser/adaptor.js) to maintain a single source of truth:

```javascript
export function extractMetadata($, url) {
  const html = typeof $.html === 'function' ? $.html() : '';
  const resp = new Response({ html, url });
  return resp.extractMetadata();
}
```

---

### 2.6 `resolveUrls($, baseUrl)`
Normalizes relative URLs across all `<a>` tags and `<img>` tags in the DOM to absolute URLs:
- Skips anchor fragments (`#`), JavaScript links (`javascript:`), and mail/tel links (`mailto:`, `tel:`).
- Applies `new URL(href, baseUrl).href` inside a safe `try / catch` block.

---

### 2.7 `discoverCategories(url)`
Discovers category and section navigation links from a target website.

- **Signature**: `async function discoverCategories(url)`
- **Return Value**: `Promise<Array<{ url: string, name: string }>>`
- **Algorithm**:
  1. Fetches HTML and loads into Cheerio.
  2. Inspects navigation elements: `nav a, .menu a, #menu a, header a, .categories a, footer a`.
  3. Filters out off-origin external links, fragments, and utility paths (`/login`, `/about`, `/contact`, `/terms`, `/privacy`).
  4. If fewer than 2 categories are found, falls back to scanning all `<a>` tags matching `/category/` or `/tag/`.
  5. Returns deduplicated category objects with normalized URLs and display names.

---

### 2.8 `autoDetectLinkSelector(url)`
Heuristically analyzes a listing or blog index page to determine the optimal CSS selector for main article links.

- **Signature**: `async function autoDetectLinkSelector(url)`
- **Return Value**: `Promise<string|null>`
- **Algorithm**:
  1. Removes noise elements (`nav`, `header`, `footer`, `aside`, `.sidebar`, `.widget`, `.comments`).
  2. Iterates over all remaining internal `<a>` links.
  3. Generates parent-child structural signatures: `${parentTag}.${parentClasses} > a.${aClasses}`.
  4. Counts signature frequencies in a map.
  5. Selects the most frequent signature having at least 2 occurrences as the candidate selector (e.g. `article.post > a.entry-title`).
