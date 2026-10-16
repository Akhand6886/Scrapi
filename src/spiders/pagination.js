/**
 * Scrapi Pagination Engine
 * ─────────────────────────
 * Exhaustive discovery and traversal of website pagination, numbered pages,
 * archive navigation, and subcategories.
 */

const NEXT_PAGE_SELECTORS = [
  'link[rel="next"]',
  'a[rel="next"]',
  'a.next',
  'a.next-page',
  'a.pagination-next',
  'a.pagination__next',
  'a.nav-next',
  '.pagination .next a',
  '.nav-links .next a',
  '.pager .next a',
  'ul.pagination li.next a',
  'a[aria-label*="next" i]',
  'a[aria-label*="next page" i]',
  'a[title*="next" i]',
  'a[title*="next page" i]'
];

const NEXT_TEXT_REGEX = /^(next|older|older posts|older articles|next page|next\s*»|»|›|>|→|\s*next\s*)$/i;

const PAGINATION_CONTAINER_SELECTORS = [
  '.pagination',
  '.nav-links',
  '.page-numbers',
  'ul.pagination',
  'ol.pagination',
  '.pager',
  'nav[role="navigation"]',
  'nav[aria-label*="pagination" i]',
  '.navigation.pagination',
  '.archive-pagination',
  '.post-pagination'
];

export class PaginationEngine {
  /**
   * Resolves a relative or absolute URL against baseUrl safely.
   */
  static cleanUrl(href, baseUrl) {
    if (!href) return null;
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) {
      return null;
    }
    try {
      const u = new URL(trimmed, baseUrl);
      u.hash = '';
      return u.href;
    } catch {
      return null;
    }
  }

  /**
   * Detects the explicit "Next Page" URL from a page response.
   * @param {import('../parser/adaptor.js').Response|object} response 
   * @param {string} [currentUrl] 
   * @returns {string|null}
   */
  static findNextPageUrl(response, currentUrl) {
    const $ = response.$ || (typeof response.css === 'function' ? response.$ : null);
    const baseUrl = currentUrl || response.url;
    if (!$) return null;

    // 1. Selector-based next page
    for (const sel of NEXT_PAGE_SELECTORS) {
      const el = $(sel);
      if (el.length > 0) {
        const href = el.attr('href');
        const resolved = this.cleanUrl(href, baseUrl);
        if (resolved && resolved !== baseUrl) {
          return resolved;
        }
      }
    }

    // 2. Text-based next page search across all <a> tags
    let textMatchedUrl = null;
    $('a').each((_, elem) => {
      if (textMatchedUrl) return;
      const text = $(elem).text().trim();
      if (NEXT_TEXT_REGEX.test(text)) {
        const href = $(elem).attr('href');
        const resolved = this.cleanUrl(href, baseUrl);
        if (resolved && resolved !== baseUrl) {
          textMatchedUrl = resolved;
        }
      }
    });

    if (textMatchedUrl) return textMatchedUrl;

    // 3. Heuristic: Numbered pagination - find the page immediately following the active/current page
    let activePageNumber = null;
    for (const containerSel of PAGINATION_CONTAINER_SELECTORS) {
      const container = $(containerSel);
      if (container.length === 0) continue;

      // Find current active item
      const activeEl = container.find('.current, .active, [aria-current="page"], .page-numbers.current, span.page-number.active');
      if (activeEl.length > 0) {
        const num = parseInt(activeEl.text().trim(), 10);
        if (!isNaN(num)) activePageNumber = num;
      }

      // If active found, look for number num + 1
      if (activePageNumber !== null) {
        const targetNum = activePageNumber + 1;
        let foundTarget = null;
        container.find('a').each((_, a) => {
          if (foundTarget) return;
          const aText = $(a).text().trim();
          if (parseInt(aText, 10) === targetNum) {
            const resolved = this.cleanUrl($(a).attr('href'), baseUrl);
            if (resolved) foundTarget = resolved;
          }
        });
        if (foundTarget) return foundTarget;
      }
    }

    return null;
  }

  /**
   * Discovers all numbered pagination page URLs from the pagination container.
   * @param {import('../parser/adaptor.js').Response|object} response 
   * @param {string} [currentUrl] 
   * @returns {string[]}
   */
  static findNumberedPageUrls(response, currentUrl) {
    const $ = response.$ || (typeof response.css === 'function' ? response.$ : null);
    const baseUrl = currentUrl || response.url;
    if (!$) return [];

    const discovered = new Set();

    for (const containerSel of PAGINATION_CONTAINER_SELECTORS) {
      const container = $(containerSel);
      if (container.length === 0) continue;

      container.find('a').each((_, a) => {
        const href = $(a).attr('href');
        const text = $(a).text().trim();
        const resolved = this.cleanUrl(href, baseUrl);
        if (resolved && resolved !== baseUrl) {
          // If anchor text is a number or URL has page signature
          if (/^\d+$/.test(text) || /[?&](page|p)=\d+|\/page\/\d+/i.test(resolved)) {
            discovered.add(resolved);
          }
        }
      });
    }

    return Array.from(discovered);
  }

  /**
   * Discovers topic-related or site-level historical archive listing URLs (e.g. /archive/2024/, /2024/01/).
   * @param {import('../parser/adaptor.js').Response|object} response 
   * @param {string} [currentUrl] 
   * @param {string} [topicSlug] 
   * @returns {string[]}
   */
  static findArchiveUrls(response, currentUrl, topicSlug = '') {
    const $ = response.$ || (typeof response.css === 'function' ? response.$ : null);
    const baseUrl = currentUrl || response.url;
    if (!$) return [];

    const archives = new Set();
    const currentYear = new Date().getFullYear();

    $('a').each((_, a) => {
      const href = $(a).attr('href');
      const text = $(a).text().trim().toLowerCase();
      const resolved = this.cleanUrl(href, baseUrl);
      if (!resolved) return;

      const lowerUrl = resolved.toLowerCase();

      // Matches /archive/, /archives/, or year paths /2020/ through /2026/
      const isArchiveStructure = 
        lowerUrl.includes('/archive') || 
        lowerUrl.includes('/archives') ||
        /\b(19\d\d|20\d\d)\/(\d{1,2}\/)?$/i.test(lowerUrl);

      // Matches archive text e.g. "January 2024", "2024", "All Archives"
      const isArchiveText = 
        /(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}/i.test(text) ||
        /\b(20[12]\d)\b/.test(text) && text.length < 15;

      if (isArchiveStructure || isArchiveText) {
        // If topicSlug is given, prioritize archives containing topicSlug or generic archive listings
        if (!topicSlug || lowerUrl.includes(topicSlug.toLowerCase()) || lowerUrl.includes('/archive')) {
          archives.add(resolved);
        }
      }
    });

    return Array.from(archives);
  }

  /**
   * Discovers child subcategories under the current topic.
   * @param {import('../parser/adaptor.js').Response|object} response 
   * @param {string} topicSlug 
   * @param {string} [currentUrl] 
   * @returns {Array<{ url: string, name: string }>}
   */
  static findSubcategoryUrls(response, topicSlug, currentUrl) {
    const $ = response.$ || (typeof response.css === 'function' ? response.$ : null);
    const baseUrl = currentUrl || response.url;
    if (!$ || !topicSlug) return [];

    const subcats = new Map();
    const cleanTopic = topicSlug.toLowerCase().replace(/^\/+|\/+$/g, '');

    $('nav a, .subcategories a, .sub-nav a, .category-menu a, .tags a, header a, footer a, .categories a').each((_, a) => {
      const href = $(a).attr('href');
      const name = $(a).text().trim();
      const resolved = this.cleanUrl(href, baseUrl);
      if (!resolved || !name || name.length < 2 || name.length > 50) return;

      const lowerUrl = resolved.toLowerCase();
      // Must be on same host
      try {
        if (new URL(resolved).origin !== new URL(baseUrl).origin) return;
      } catch { return; }

      // Check if URL represents a nested subcategory under the topic
      if (lowerUrl.includes(`/${cleanTopic}/`) && lowerUrl !== baseUrl.toLowerCase() && !lowerUrl.endsWith(`/${cleanTopic}`)) {
        // Ensure it's a category/index rather than a deep article
        const segments = new URL(resolved).pathname.split('/').filter(Boolean);
        const topicIndex = segments.findIndex(s => s.toLowerCase() === cleanTopic);
        if (topicIndex !== -1 && segments.length <= topicIndex + 2) {
          if (!subcats.has(resolved)) {
            subcats.set(resolved, { url: resolved, name });
          }
        }
      }
    });

    return Array.from(subcats.values());
  }

  /**
   * Generates a prospective next pagination URL given a base listing URL and page number.
   * @param {string} listingUrl 
   * @param {number} pageNum 
   * @returns {string}
   */
  static generatePageUrl(listingUrl, pageNum) {
    try {
      const u = new URL(listingUrl);
      if (pageNum <= 1) return listingUrl;

      // Check query param pattern
      if (u.searchParams.has('page') || u.searchParams.has('p')) {
        const param = u.searchParams.has('page') ? 'page' : 'p';
        u.searchParams.set(param, String(pageNum));
        return u.href;
      }

      // Check /page/N/ pattern
      if (/\/page\/\d+\/?/i.test(u.pathname)) {
        u.pathname = u.pathname.replace(/\/page\/\d+\/?/i, `/page/${pageNum}/`);
        return u.href;
      }

      // Default: append /page/N/
      let pathname = u.pathname.replace(/\/+$/, '');
      u.pathname = `${pathname}/page/${pageNum}/`;
      return u.href;
    } catch {
      return listingUrl;
    }
  }

  /**
   * Checks whether a listing page has reached its end (depleted).
   * @param {import('../parser/adaptor.js').Response|object} response 
   * @param {number} articleCountFound 
   * @returns {boolean}
   */
  static isListingDepleted(response, articleCountFound = 0) {
    if (!response || response.status === 404 || response.status === 410) {
      return true;
    }

    if (articleCountFound > 0) return false;

    const html = (response.rawHtml || '').toLowerCase();
    const depletionSignatures = [
      'no posts found',
      'no articles found',
      'nothing found',
      'no results found',
      'page not found',
      'there are no articles in this section',
      'no more content',
      'end of results'
    ];

    for (const sig of depletionSignatures) {
      if (html.includes(sig)) return true;
    }

    return false;
  }
}
