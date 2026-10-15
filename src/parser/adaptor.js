import * as cheerio from 'cheerio';
import { AdaptorElement, SelectorList } from './selector.js';
import { AdaptiveEngine } from './adaptive.js';
import { MarkdownEngine } from './markdown.js';
import { extractEntities } from './cluster_extractor.js';


export const NOISE_SELECTORS = [
  'nav', 'header', 'footer',
  'script', 'style', 'noscript', 'iframe',
  '.cookie-banner', '.popup', '.ad', '.advertisement',
  '[aria-hidden="true"]', '#cookie-consent', '.social-share'
];

/**
 * Response / Adaptor represents a scraped web page response with unified parsing tools.
 */
export class Response {
  constructor({
    url = '',
    status = 200,
    headers = {},
    html = '',
    cookies = [],
    fetcher = 'static',
    timing = 0
  } = {}) {
    this.url = url;
    this.status = status;
    this.headers = headers;
    this.rawHtml = html;
    this.cookies = cookies;
    this.fetcher = fetcher;
    this.timing = timing;

    this._$ = null;
  }

  /**
   * Lazily initialized Cheerio instance with noise scripts stripped for fast parsing.
   */
  get $() {
    if (!this._$) {
      const stripped = (this.rawHtml || '')
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');
      this._$ = cheerio.load(stripped || '<html><body></body></html>');
    }
    return this._$;
  }

  /**
   * Full unstripped Cheerio instance if full DOM script tags need to be examined.
   */
  get fullDom() {
    return cheerio.load(this.rawHtml || '<html><body></body></html>');
  }

  /**
   * Remove boilerplate and noise elements (nav, footer, ads, popups).
   */
  cleanDom() {
    this.$(NOISE_SELECTORS.join(', ')).remove();
    return this;
  }

  /**
   * Resolves relative URLs in href and src attributes to absolute URLs.
   */
  resolveUrls() {
    if (!this.url) return this;
    const baseUrl = this.url;

    this.$('a').each((_, elem) => {
      const href = this.$(elem).attr('href');
      if (href) {
        try {
          if (!href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:')) {
            this.$(elem).attr('href', new URL(href, baseUrl).href);
          }
        } catch (e) {}
      }
    });

    this.$('img').each((_, elem) => {
      const src = this.$(elem).attr('src');
      if (src) {
        try {
          this.$(elem).attr('src', new URL(src, baseUrl).href);
        } catch (e) {}
      }
    });

    return this;
  }

  /**
   * Query elements using CSS selector.
   * @param {string} cssSelector 
   * @returns {SelectorList}
   */
  css(cssSelector) {
    const results = [];
    this.$(cssSelector).each((_, node) => {
      results.push(new AdaptorElement(node, this.$, this.url));
    });
    return new SelectorList(results, this.$, this.url);
  }

  /**
   * Query elements using XPath expression.
   * @param {string} xpathQuery 
   * @returns {SelectorList}
   */
  xpath(xpathQuery) {
    const root = new AdaptorElement(this.$('html')[0] || this.$('body')[0], this.$, this.url);
    return root.xpath(xpathQuery);
  }

  /**
   * Adaptive query: attempts CSS selector first, then falls back to multi-anchor self-healing.
   * @param {string|object} selectorOrSignature 
   * @returns {{ element: AdaptorElement|null, healed: boolean, confidence: number, selector: string }}
   */
  adaptive(selectorOrSignature) {
    let selectorStr = typeof selectorOrSignature === 'string' ? selectorOrSignature : (selectorOrSignature.content || 'auto');
    let signature = typeof selectorOrSignature === 'object' ? selectorOrSignature : null;

    if (selectorStr && selectorStr !== 'auto') {
      const match = this.css(selectorStr);
      if (match.length > 0) {
        return {
          element: match.first(),
          healed: false,
          confidence: 1.0,
          selector: selectorStr
        };
      }
    }

    if (signature) {
      const healed = AdaptiveEngine.relocate(this.$, signature, this.url);
      if (healed.element) {
        return {
          element: healed.element,
          healed: true,
          confidence: healed.confidence,
          selector: healed.healedSelector || selectorStr
        };
      }
    }

    // Fallback to best content root
    const best = this.findBestContentRoot();
    return {
      element: best,
      healed: false,
      confidence: 0.8,
      selector: 'auto'
    };
  }

  /**
   * Automatically locates the best main content element on the page.
   * @returns {AdaptorElement}
   */
  findBestContentRoot(selector = 'auto') {
    if (selector && selector !== 'auto') {
      if (typeof selector === 'object') {
        const ad = this.adaptive(selector);
        if (ad.element) return ad.element;
      } else {
        const custom = this.css(selector);
        if (custom.length > 0) return custom.first();
      }
    }

    // 1. article
    const article = this.css('article');
    if (article.length > 0) return article.first();

    // 2. main or [role="main"]
    const main = this.css('main, [role="main"]');
    if (main.length > 0) return main.first();

    // 3. standard content classes/IDs
    const standard = this.css('.content, .post-content, .article-body, #content, #main');
    if (standard.length > 0) return standard.first();

    // 4. Heuristic text-to-tag ratio div
    let bestDiv = null;
    let maxRatio = -1;
    this.$('div').each((_, elem) => {
      const text = this.$(elem).text().trim();
      if (text.length > 100) {
        const tagsCount = this.$(elem).find('*').length + 1;
        const ratio = text.length / tagsCount;
        if (ratio > maxRatio) {
          maxRatio = ratio;
          bestDiv = elem;
        }
      }
    });

    if (bestDiv) {
      return new AdaptorElement(bestDiv, this.$, this.url);
    }

    // 5. body fallback
    const body = this.$('body')[0];
    return new AdaptorElement(body, this.$, this.url);
  }

  /**
   * Extracts metadata (title, description, pubDate, og tags, json-ld).
   */
  extractMetadata() {
    const $ = this.$;
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

    const author = $('meta[name="author"]').attr('content') ||
      $('[rel="author"]').first().text().trim() ||
      null;

    return {
      title,
      url: this.url,
      scraped_at: new Date().toISOString(),
      description,
      date: date ? date.split('T')[0] : null,
      author,
      fetcher: this.fetcher
    };
  }

  /**
   * Converts the page or selected element to clean Markdown.
   * @param {object} options 
   */
  toMarkdown(options = {}) {
    this.cleanDom();
    this.resolveUrls();

    const rootEl = options.selector ? this.findBestContentRoot(options.selector) : this.findBestContentRoot();
    const markdown = MarkdownEngine.convert(rootEl, options);
    const metadata = this.extractMetadata();

    const words = rootEl.text.split(/\s+/).filter(w => w.length > 0);
    metadata.word_count = words.length;

    let mediaToDownload = [];
    if (options.downloadMedia) {
      rootEl.$el.find('img').each((_, elem) => {
        const src = this.$(elem).attr('src');
        if (src && src.startsWith('http')) {
          try {
            const u = new URL(src);
            let ext = (u.pathname.match(/\.[a-zA-Z0-9]+$/) || ['.jpg'])[0];
            if (ext.length > 5) ext = '.jpg';
            let basename = u.pathname.split('/').pop().replace(/[^a-zA-Z0-9_-]/g, '') || 'image';
            if (basename.length > 40) basename = basename.slice(0, 40);
            const filename = `${basename}_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
            mediaToDownload.push({ url: src, filename });
          } catch (e) {}
        }
      });
    }

    return {
      markdown,
      metadata,
      media: mediaToDownload,
      frontmatter: MarkdownEngine.generateFrontmatter(metadata)
    };
  }

  /**
   * Attempts to parse raw JSON or JSON-LD structured schemas from the page.
   */
  json() {
    try {
      return JSON.parse(this.rawHtml);
    } catch (e) {
      // Extract JSON-LD scripts
      const scripts = [];
      this.fullDom('script[type="application/ld+json"]').each((_, el) => {
        try {
          const data = JSON.parse(this.fullDom(el).html());
          scripts.push(data);
        } catch (err) {}
      });
      return scripts.length === 1 ? scripts[0] : scripts;
    }
  }

  /**
   * Unsupervised extraction of repeating entity collections (products, cards, listings).
   * @param {object} [options]
   * @param {string} [options.rootSelector]
   * @param {number} [options.limit=100]
   * @returns {{ entities: Array<Record<string, *>>, detectedType: string, clusterCount: number, confidence: number }}
   */
  extractEntities(options = {}) {
    return extractEntities(this.$, { baseUrl: this.url, ...options });
  }
}

/**
 * Adaptor factory function for convenience.
 */
export function createAdaptor(options) {
  return new Response(options);
}
