import axios from 'axios';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import http from 'http';
import https from 'https';
import { getCachedPage, saveCachedPage } from './storage.js';

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

/**
 * Fetches HTML from a given URL with options. Supports HTTP Conditional Caching (ETag/Last-Modified).
 * @param {string} url 
 * @param {object} options 
 * @returns {Promise<string>}
 */
export async function fetchHtml(url, options = {}) {
  const timeout = options.timeout || 10000;
  const userAgent = options.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  let cached = null;
  if (!options.noCache) {
    try {
      cached = getCachedPage(url);
    } catch (e) {
      // Storage might not be initialized yet in test scripts
    }
  }

  const headers = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
    'Accept-Language': 'en-US,en;q=0.5',
  };

  // Add conditional headers if cache exists
  if (cached) {
    if (cached.etag) {
      headers['If-None-Match'] = cached.etag;
    }
    if (cached.last_modified) {
      headers['If-Modified-Since'] = cached.last_modified;
    }
  }

  try {
    const response = await axios.get(url, {
      timeout,
      maxContentLength: 5 * 1024 * 1024, // Protect system: max download limit 5MB
      responseType: 'text',
      headers,
      httpAgent,
      httpsAgent,
      validateStatus: (status) => (status >= 200 && status < 300) || status === 304
    });

    // If 304 Not Modified, return the cached body immediately (saves network & CPU)
    if (response.status === 304 && cached) {
      console.log(`⚡ [Cache] Page content unchanged (status 304). Serving from cache.`);
      return cached.html;
    }

    // Verify that the response content type looks like HTML
    const contentType = response.headers['content-type'] || '';
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new Error(`Invalid content type: "${contentType}". Only HTML documents can be scraped.`);
    }

    const html = response.data;

    // Cache the successful response
    if (!options.noCache) {
      try {
        saveCachedPage(url, html, response.headers['etag'], response.headers['last-modified']);
      } catch (e) {
        // Ignore cache saving failures
      }
    }

    return html;
  } catch (err) {
    // If request fails but we have a cached copy, fallback to cached copy
    if (cached) {
      console.warn(`⚠️ [Cache Fallback] Request failed: ${err.message}. Serving stale cached content.`);
      return cached.html;
    }
    throw err;
  }
}

/**
 * Strips noise elements from Cheerio DOM.
 * @param {object} $ 
 */
export function cleanDom($) {
  const noiseSelectors = [
    'nav', 'header', 'footer',
    'script', 'style', 'noscript', 'iframe',
    '.cookie-banner', '.popup', '.ad', '.advertisement',
    '[aria-hidden="true"]', '#cookie-consent', '.social-share'
  ];
  $(noiseSelectors.join(', ')).remove();
}

/**
 * Computes the text-to-tag ratio for a given element node.
 * Heuristic: count text characters / number of HTML elements inside.
 * @param {object} element - Cheerio element
 * @returns {number}
 */
function getTextToTagRatio(element, $) {
  const text = $(element).text().trim();
  const textLength = text.length;
  if (textLength === 0) return 0;
  
  const tagsCount = $(element).find('*').length + 1; // +1 to avoid division by zero and include current tag
  return textLength / tagsCount;
}

/**
 * Generates a simple, robust CSS selector for a resolved candidate element.
 * @param {object} $ 
 * @param {object} elem 
 * @returns {string}
 */
function generateHealedSelector($, elem) {
  let path = [];
  let current = elem;
  while (current && current.type === 'tag') {
    let tag = current.name;
    const id = $(current).attr('id');
    if (id) {
      path.unshift(`#${id}`);
      break;
    }
    const classAttr = $(current).attr('class');
    if (classAttr) {
      const classes = classAttr.trim().split(/\s+/).filter(c => c && !c.startsWith('scrapi-') && /^[a-zA-Z0-9_-]+$/.test(c));
      if (classes.length > 0) {
        tag += '.' + classes[0]; // use first class for minimal selector
      }
    }
    path.unshift(tag);
    current = current.parent;
  }
  return path.join(' > ');
}

/**
 * Resolves a failed selector using multi-anchor structural signatures.
 * @param {object} $ 
 * @param {object} signature 
 * @returns {object|null} Cheerio element selection or null
 */
function attemptSelfHealing($, signature) {
  const tagName = signature.tagName || '*';
  const candidates = $(tagName);
  if (candidates.length === 0) return null;

  let bestCandidate = null;
  let maxScore = -1;

  candidates.each((_, elem) => {
    let score = 0;

    // Anchor 1: Text Content similarity (partial matches)
    const text = $(elem).text().trim();
    if (signature.textSnippet && text) {
      if (text.includes(signature.textSnippet) || signature.textSnippet.includes(text)) {
        score += 0.5;
      } else {
        // Compute word intersection
        const signatureWords = new Set(signature.textSnippet.toLowerCase().split(/\s+/).filter(Boolean));
        const candidateWords = new Set(text.toLowerCase().split(/\s+/).filter(Boolean));
        const intersection = [...signatureWords].filter(w => candidateWords.has(w));
        if (signatureWords.size > 0) {
          score += (intersection.length / signatureWords.size) * 0.4;
        }
      }
    }

    // Anchor 2: Class overlap
    if (signature.classes && signature.classes.length > 0) {
      const classAttr = $(elem).attr('class') || '';
      const candidateClasses = classAttr.split(/\s+/).filter(Boolean);
      const matchedClasses = signature.classes.filter(c => candidateClasses.includes(c));
      score += (matchedClasses.length / signature.classes.length) * 0.3;
    }

    // Anchor 3: Parent hierarchy alignment
    if (signature.parentTagName) {
      const parent = $(elem).parent();
      if (parent.length > 0 && parent[0].name.toLowerCase() === signature.parentTagName.toLowerCase()) {
        score += 0.2;
      }
    }

    if (score > maxScore) {
      maxScore = score;
      bestCandidate = elem;
    }
  });

  // Threshold check to prevent matching random garbage elements
  if (bestCandidate && maxScore >= 0.35) {
    const healedSelector = generateHealedSelector($, bestCandidate);
    console.warn(`✨ [Self-Healing] Successfully recovered target element (Similarity: ${Math.round(maxScore * 100)}%).`);
    console.warn(`   New dynamic anchor selector: "${healedSelector}"`);
    return $(bestCandidate);
  }

  return null;
}

/**
 * Detects the best content root element.
 * Priority:
 * 1. article
 * 2. main, [role="main"]
 * 3. .content, .post-content, .article-body, #content, #main
 * 4. div with highest text-to-tag ratio (heuristic fallback)
 * 5. body (last resort)
 * @param {object} $ 
 * @param {string|object} selector 
 * @returns {object} Cheerio element selection
 */
export function findBestContentRoot($, selector = 'auto') {
  let signature = null;
  let targetSelector = 'auto';

  if (typeof selector === 'object' && selector !== null) {
    signature = selector;
    targetSelector = signature.content || 'auto';
  } else {
    targetSelector = selector;
  }

  if (targetSelector && targetSelector !== 'auto') {
    const customSelection = $(targetSelector);
    if (customSelection.length > 0) {
      return customSelection.first();
    }

    // Target selector failed. Trigger self-healing if we have signature metadata.
    if (signature && (signature.tagName || signature.textSnippet)) {
      console.warn(`⚠️ Primary selector "${targetSelector}" failed to match elements. Initiating self-healing...`);
      const healedElement = attemptSelfHealing($, signature);
      if (healedElement) {
        return healedElement;
      }
    }
  }

  // Priority 1: article
  const article = $('article');
  if (article.length > 0) {
    return article.first();
  }

  // Priority 2: main or [role="main"]
  const main = $('main, [role="main"]');
  if (main.length > 0) {
    return main.first();
  }

  // Priority 3: standard content classes/IDs
  const standardSelectors = ['.content', '.post-content', '.article-body', '#content', '#main'];
  for (const sel of standardSelectors) {
    const el = $(sel);
    if (el.length > 0) {
      return el.first();
    }
  }

  // Priority 4: div with highest text-to-tag ratio (heuristic)
  let bestDiv = null;
  let maxRatio = -1;

  $('div').each((_, elem) => {
    // Only evaluate divs that have some substantial content
    const text = $(elem).text().trim();
    if (text.length > 100) {
      const ratio = getTextToTagRatio(elem, $);
      if (ratio > maxRatio) {
        maxRatio = ratio;
        bestDiv = elem;
      }
    }
  });

  if (bestDiv) {
    return $(bestDiv);
  }

  // Priority 5: body
  return $('body').first();
}

/**
 * Extracts metadata from the page.
 * @param {object} $ 
 * @param {string} url 
 * @returns {object}
 */
export function extractMetadata($, url) {
  const title = $('title').text().trim() || 
                $('meta[property="og:title"]').attr('content') || 
                $('meta[name="twitter:title"]').attr('content') || 
                '';

  const description = $('meta[name="description"]').attr('content') || 
                      $('meta[property="og:description"]').attr('content') || 
                      $('meta[name="twitter:description"]').attr('content') || 
                      '';

  const date = $('meta[property="article:published_time"]').attr('content') || 
               $('meta[name="date"]').attr('content') || 
               $('meta[name="pubdate"]').attr('content') || 
               $('meta[property="og:article:published_time"]').attr('content') || 
               null;

  return {
    title,
    url,
    scraped_at: new Date().toISOString(),
    description,
    date: date ? date.split('T')[0] : null // Keep YYYY-MM-DD if ISO
  };
}

/**
 * Converts a Cheerio element to Markdown.
 * @param {object} rootElement 
 * @param {object} options 
 * @returns {string}
 */
export function convertToMarkdown(rootElement, options = {}) {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
  });

  // Handle images option
  if (!options.images) {
    turndownService.addRule('stripImages', {
      filter: 'img',
      replacement: () => ''
    });
  }

  const html = rootElement.html() || '';
  return turndownService.turndown(html);
}

/**
 * Resolves relative URLs for <a> and <img> tags in the DOM.
 * @param {object} $ 
 * @param {string} baseUrl 
 */
export function resolveUrls($, baseUrl) {
  $('a').each((_, elem) => {
    const href = $(elem).attr('href');
    if (href) {
      try {
        // Skip links that are anchor jumps, mailto, tel, or javascript
        if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
          return;
        }
        $(elem).attr('href', new URL(href, baseUrl).href);
      } catch (e) {
        // Keep original if resolution fails
      }
    }
  });

  $('img').each((_, elem) => {
    const src = $(elem).attr('src');
    if (src) {
      try {
        $(elem).attr('src', new URL(src, baseUrl).href);
      } catch (e) {
        // Keep original if resolution fails
      }
    }
  });
}

/**
 * Orchestrates the full scraping process.
 * @param {string} url 
 * @param {object} options 
 * @returns {Promise<object>}
 */
export async function scrapePage(url, options = {}) {
  const html = await fetchHtml(url, options);
  const $ = cheerio.load(html);
  
  const metadata = extractMetadata($, url);
  
  // Clean elements from the page
  cleanDom($);

  // Resolve relative URLs to absolute
  resolveUrls($, url);
  
  // Find the content we care about
  const contentRoot = findBestContentRoot($, options.selector);
  
  // Convert content to Markdown
  const markdown = convertToMarkdown(contentRoot, options);

  // Compute Word Count
  const words = contentRoot.text().trim().split(/\s+/).filter(w => w.length > 0);
  metadata.word_count = words.length;

  return {
    metadata,
    markdown
  };
}
