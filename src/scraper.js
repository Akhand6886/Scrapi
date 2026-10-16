import * as cheerio from 'cheerio';
import path from 'path';
import { globalFetcherPool } from './fetchers/index.js';
import { Response, NOISE_SELECTORS } from './parser/adaptor.js';
import { AdaptiveEngine } from './parser/adaptive.js';
import { MarkdownEngine } from './parser/markdown.js';
import { scoreContentElement } from './trees/content_extractor.js';

/**
 * Fetches HTML from a given URL with options. Supports HTTP Conditional Caching (ETag/Last-Modified).
 * @param {string} url 
 * @param {object} options 
 * @returns {Promise<string>}
 */
export async function fetchHtml(url, options = {}) {
  const response = await globalFetcherPool.fetch(url, options);
  return response.rawHtml;
}

/**
 * Strips noise elements from Cheerio DOM.
 * @param {object} $ 
 */
export function cleanDom($) {
  $(NOISE_SELECTORS.join(', ')).remove();
}

/**
 * Computes the text-to-tag ratio for a given element node.
 * @param {object} element - Cheerio element
 * @param {object} $ 
 * @returns {number}
 */
function getTextToTagRatio(element, $) {
  const text = $(element).text().trim();
  const textLength = text.length;
  if (textLength === 0) return 0;
  
  const tagsCount = $(element).find('*').length + 1;
  return textLength / tagsCount;
}

/**
 * Detects the best content root element.
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

    if (signature && (signature.tagName || signature.textSnippet)) {
      console.warn(`⚠️ Primary selector "${targetSelector}" failed to match elements. Initiating self-healing...`);
      const healed = AdaptiveEngine.relocate($, signature);
      if (healed.element) {
        console.warn(`✨ [Self-Healing] Successfully recovered target element (Similarity: ${Math.round(healed.confidence * 100)}%).`);
        console.warn(`   New dynamic anchor selector: "${healed.healedSelector}"`);
        return healed.element.$el;
      }
    }
  }

  // Primary: Decision Tree DOM Content Extractor Evaluation
  let bestCandidate = null;
  let highestScore = -1;

  $('article, main, [role="main"], section, div.content, div.post, div.article, div.entry, div').each((_, elem) => {
    const analysis = scoreContentElement($, elem);
    if (analysis.classification === 'MAIN_CONTENT' && analysis.score > highestScore) {
      highestScore = analysis.score;
      bestCandidate = elem;
    }
  });

  if (bestCandidate) return $(bestCandidate);

  // Fallback Priority 1: article
  const article = $('article');
  if (article.length > 0) return article.first();

  // Fallback Priority 2: main or [role="main"]
  const main = $('main, [role="main"]');
  if (main.length > 0) return main.first();

  // Fallback Priority 3: standard content classes/IDs
  const standardSelectors = ['.content', '.post-content', '.article-body', '#content', '#main'];
  for (const sel of standardSelectors) {
    const el = $(sel);
    if (el.length > 0) return el.first();
  }

  // Fallback Priority 4: div with highest text-to-tag ratio (heuristic)
  let bestDiv = null;
  let maxRatio = -1;

  $('div').each((_, elem) => {
    const text = $(elem).text().trim();
    if (text.length > 100) {
      const ratio = getTextToTagRatio(elem, $);
      if (ratio > maxRatio) {
        maxRatio = ratio;
        bestDiv = elem;
      }
    }
  });

  if (bestDiv) return $(bestDiv);

  // Fallback Priority 5: body
  return $('body').first();
}

/**
 * Extracts metadata from the page. Delegates to Response.extractMetadata() for unified, single-source parsing.
 * @param {object} $ 
 * @param {string} url 
 * @returns {object}
 */
export function extractMetadata($, url) {
  const html = typeof $.html === 'function' ? $.html() : '';
  const resp = new Response({ html, url });
  return resp.extractMetadata();
}

/**
 * Converts a Cheerio element to Markdown.
 * @param {object} rootElement 
 * @param {object} options 
 * @returns {string}
 */
export function convertToMarkdown(rootElement, options = {}) {
  return MarkdownEngine.convert(rootElement, options);
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
        if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
          return;
        }
        $(elem).attr('href', new URL(href, baseUrl).href);
      } catch (e) {}
    }
  });

  $('img').each((_, elem) => {
    const src = $(elem).attr('src');
    if (src) {
      try {
        $(elem).attr('src', new URL(src, baseUrl).href);
      } catch (e) {}
    }
  });
}

/**
 * Orchestrates the full scraping process using Scrapi's modular engine.
 * @param {string} url 
 * @param {object} options 
 * @returns {Promise<object>}
 */
export async function scrapePage(url, options = {}) {
  const response = await globalFetcherPool.fetch(url, options);
  
  const $ = response.$;
  const metadata = extractMetadata($, url);
  cleanDom($);
  resolveUrls($, url);
  
  const contentRoot = findBestContentRoot($, options.selector);
  
  const mediaToDownload = [];
  if (options.downloadMedia) {
    contentRoot.find('img').each((_, elem) => {
      let src = $(elem).attr('src');
      if (src && src.startsWith('http')) {
        try {
          const u = new URL(src);
          let ext = path.extname(u.pathname);
          if (!ext || ext.length > 5) ext = '.jpg';
          let basename = path.basename(u.pathname, ext).replace(/[^a-zA-Z0-9_-]/g, '') || 'image';
          if (basename.length > 50) basename = basename.substring(0, 50);
          
          const filename = `${basename}_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
          mediaToDownload.push({ url: src, filename });
          $(elem).attr('src', `media/${filename}`);
        } catch (e) {}
      }
    });
  }
  
  const markdown = convertToMarkdown(contentRoot, options);
  const words = contentRoot.text().trim().split(/\s+/).filter(w => w.length > 0);
  metadata.word_count = words.length;

  return {
    metadata,
    markdown,
    media: mediaToDownload,
    decisionTree: response.decisionTree || null
  };
}

/**
 * Discovers category navigation links on a given URL.
 * @param {string} url 
 * @returns {Promise<Array<{url: string, name: string}>>}
 */
export async function discoverCategories(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  
  let origin;
  try {
    origin = new URL(url).origin;
  } catch (e) {
    return [];
  }

  const categoryMap = new Map();

  $('nav a, .menu a, #menu a, header a, .categories a, footer a').each((_, elem) => {
    const el = $(elem);
    let href = el.attr('href');
    let name = el.text().trim();
    
    if (!href || !name || name.length < 2 || name.length > 30) return;

    try {
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
        return;
      }
      const absoluteUrl = new URL(href, url).href;
      if (new URL(absoluteUrl).origin !== origin) return;
      
      const cleanUrl = absoluteUrl.replace(/\/$/, '');
      const lowerUrl = cleanUrl.toLowerCase();
      if (
        lowerUrl.includes('/login') || 
        lowerUrl.includes('/about') || 
        lowerUrl.includes('/contact') || 
        lowerUrl.includes('/terms') || 
        lowerUrl.includes('/privacy') ||
        lowerUrl.includes('/author/')
      ) {
        return;
      }

      if (!categoryMap.has(cleanUrl)) {
        categoryMap.set(cleanUrl, name);
      }
    } catch (e) {}
  });

  if (categoryMap.size < 2) {
    $('a').each((_, elem) => {
      const el = $(elem);
      let href = el.attr('href');
      let name = el.text().trim();
      if (!href || !name) return;
      try {
        const absoluteUrl = new URL(href, url).href;
        if (new URL(absoluteUrl).origin !== origin) return;
        if (absoluteUrl.includes('/category/') || absoluteUrl.includes('/tag/')) {
          const cleanUrl = absoluteUrl.replace(/\/$/, '');
          if (!categoryMap.has(cleanUrl)) {
            categoryMap.set(cleanUrl, name);
          }
        }
      } catch (e) {}
    });
  }

  return Array.from(categoryMap.entries()).map(([href, name]) => ({
    url: href,
    name
  }));
}

/**
 * Heuristically auto-detects the CSS selector for the main article/post links on a page.
 * @param {string} url 
 * @returns {Promise<string|null>}
 */
export async function autoDetectLinkSelector(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  
  let origin;
  try {
    origin = new URL(url).origin;
  } catch (e) {
    return null;
  }

  $('nav, header, footer, aside, .sidebar, .widget, .comments').remove();

  const signatureCounts = new Map();

  $('a').each((_, elem) => {
    const el = $(elem);
    const href = el.attr('href');
    if (!href) return;

    try {
      if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
      const absoluteUrl = new URL(href, url).href;
      if (new URL(absoluteUrl).origin !== origin) return;
      if (absoluteUrl.includes('/category/') || absoluteUrl.includes('/page/') || absoluteUrl.includes('/tag/')) return;

      const aClasses = (el.attr('class') || '').trim().split(/\s+/).filter(c => c && /^[a-zA-Z0-9_-]+$/.test(c)).slice(0, 2).join('.');
      
      const parent = el.parent();
      const parentTag = parent.get(0) ? parent.get(0).tagName : '';
      if (!parentTag || parentTag === 'body' || parentTag === 'html') return;

      const parentClasses = (parent.attr('class') || '').trim().split(/\s+/).filter(c => c && /^[a-zA-Z0-9_-]+$/.test(c)).slice(0, 2).join('.');

      let selector = '';
      if (parentTag) {
        selector += parentTag.toLowerCase();
        if (parentClasses) selector += `.${parentClasses}`;
        selector += ' > ';
      }
      selector += 'a';
      if (aClasses) selector += `.${aClasses}`;

      if (!signatureCounts.has(selector)) {
        signatureCounts.set(selector, 0);
      }
      signatureCounts.set(selector, signatureCounts.get(selector) + 1);
    } catch (e) {}
  });

  if (signatureCounts.size === 0) return null;

  let bestSelector = null;
  let maxCount = 0;

  for (const [selector, count] of signatureCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      bestSelector = selector;
    }
  }

  if (maxCount < 2) return null;

  return bestSelector;
}
