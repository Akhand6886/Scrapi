import axios from 'axios';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

/**
 * Fetches HTML from a given URL with options.
 * @param {string} url 
 * @param {object} options 
 * @returns {Promise<string>}
 */
export async function fetchHtml(url, options = {}) {
  const timeout = options.timeout || 10000;
  const userAgent = options.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  const response = await axios.get(url, {
    timeout,
    headers: {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    }
  });

  return response.data;
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

  noiseSelectors.forEach(selector => {
    $(selector).remove();
  });
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
 * Detects the best content root element.
 * Priority:
 * 1. article
 * 2. main, [role="main"]
 * 3. .content, .post-content, .article-body, #content, #main
 * 4. div with highest text-to-tag ratio (heuristic fallback)
 * 5. body (last resort)
 * @param {object} $ 
 * @param {string} selector 
 * @returns {object} Cheerio element selection
 */
export function findBestContentRoot($, selector = 'auto') {
  if (selector && selector !== 'auto') {
    const customSelection = $(selector);
    if (customSelection.length > 0) {
      return customSelection.first();
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
