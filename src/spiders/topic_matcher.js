/**
 * Scrapi Topic Matcher & Relevance Engine
 * ─────────────────────────────────────────
 * Accurately determines topic relevance, subcategory boundaries,
 * and classifies Listing Pages vs Article Pages.
 */

const NOISE_PATH_REGEX = /\/(login|logout|signin|signup|register|cart|checkout|basket|account|wp-admin|wp-login|xmlrpc|feed|rss|cdn-cgi|wp-cron|wp-json|_next\/static|_next\/data|__webpack|\.well-known|privacy|terms|contact|about|disclaimer|copyright|faq|help)\b/i;

const MEDIA_EXT_REGEX = /\.(jpg|jpeg|png|gif|svg|webp|avif|pdf|zip|tar|gz|bz2|xz|mp4|webm|mp3|wav|ogg|exe|dmg|iso|rar|7z|css|woff|woff2|ttf|eot|ico|map)$/i;

export class TopicMatcher {
  /**
   * Builds a normalized topic profile from a topic name or slug.
   * @param {string} topicInput 
   * @returns {{ raw: string, slug: string, tokens: string[], patterns: RegExp[] }}
   */
  static createProfile(topicInput) {
    if (!topicInput) {
      return { raw: '', slug: '', tokens: [], patterns: [] };
    }

    const raw = String(topicInput).trim();
    // Normalize slug (e.g. "Data Analysis" -> "data-analysis")
    const slug = raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const tokens = raw.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (!tokens.includes(slug) && slug.length > 2) {
      tokens.push(slug);
    }

    // Common synonyms / stem variations
    const tokenSet = new Set(tokens);
    if (slug === 'analysis') {
      tokenSet.add('analyses');
      tokenSet.add('analytics');
      tokenSet.add('analytical');
    } else if (slug === 'news') {
      tokenSet.add('articles');
      tokenSet.add('reports');
    } else if (slug === 'blog') {
      tokenSet.add('posts');
      tokenSet.add('stories');
    }

    const finalTokens = Array.from(tokenSet);
    const patterns = [
      new RegExp(`/(category|topic|tag|section|archive)/[^/]*${slug}`, 'i'),
      new RegExp(`/${slug}(/|$|\\?)`, 'i'),
      new RegExp(`[?&](category|topic|tag|section)=[^&]*${slug}`, 'i')
    ];

    return {
      raw,
      slug,
      tokens: finalTokens,
      patterns
    };
  }

  /**
   * Checks if a URL represents system noise, auth, cart, or binary assets.
   * @param {string} urlStr 
   * @returns {boolean}
   */
  static isIgnoredNoise(urlStr) {
    if (!urlStr) return true;
    try {
      const u = new URL(urlStr);
      const pathname = u.pathname.toLowerCase();
      if (MEDIA_EXT_REGEX.test(pathname)) return true;
      if (NOISE_PATH_REGEX.test(pathname)) return true;
      if (u.hash && u.hash.length > 1 && !u.search) {
        // Same-page fragment links
        if (pathname === '/' || pathname === '') return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  /**
   * Evaluates whether a URL or link context belongs to the topic.
   * @param {string} urlStr 
   * @param {object} profile 
   * @param {object} [context] 
   * @returns {boolean}
   */
  static isTopicMatch(urlStr, profile, context = {}) {
    if (!profile || !profile.slug) return true; // Unrestricted crawl
    if (this.isIgnoredNoise(urlStr)) return false;

    try {
      const u = new URL(urlStr);
      const pathname = u.pathname.toLowerCase();
      const search = u.search.toLowerCase();
      const full = `${pathname}${search}`;

      // 1. Direct slug pattern match
      for (const pat of profile.patterns) {
        if (pat.test(full)) return true;
      }

      // 2. Token match in URL segments
      const segments = pathname.split('/').filter(Boolean);
      for (const seg of segments) {
        if (profile.tokens.some(t => seg === t || seg.includes(t))) {
          return true;
        }
      }

      // 3. Contextual anchor text match (e.g. link text explicitly mentions topic)
      if (context.anchorText) {
        const lowerAnchor = context.anchorText.toLowerCase();
        if (profile.tokens.some(t => lowerAnchor.includes(t))) {
          return true;
        }
      }

      // 4. Inherited from listing page: If the link was discovered inside an article card on a topic listing page
      if (context.fromTopicListing) {
        // Discard external links or explicit noise
        if (context.isSameOrigin !== false && !this.isIgnoredNoise(urlStr)) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Classifies a target URL into its structural role.
   * @param {string} urlStr 
   * @param {object} [response] 
   * @returns {'LISTING_PAGE'|'ARTICLE_PAGE'|'SUBCATEGORY_PAGE'|'ARCHIVE_PAGE'|'DISCARD'}
   */
  static classifyPageRole(urlStr, response = null) {
    if (this.isIgnoredNoise(urlStr)) return 'DISCARD';

    try {
      const u = new URL(urlStr);
      const pathname = u.pathname.toLowerCase();
      const search = u.search.toLowerCase();

      // Pagination signature
      if (/[?&](page|p|offset|cursor)=\d+|\/page\/\d+/i.test(`${pathname}${search}`)) {
        return 'LISTING_PAGE';
      }

      // Archive signature
      if (/\/(archive|archives)\/|\b(19\d\d|20\d\d)\/(\d{1,2}\/)?$/i.test(pathname)) {
        return 'ARCHIVE_PAGE';
      }

      // Category / Section signature
      if (/\/(category|topics|sections|tags)\//i.test(pathname)) {
        return 'LISTING_PAGE';
      }

      // If we have a response DOM, inspect page composition
      if (response && response.$) {
        const $ = response.$;
        const hasPagination = $('.pagination, .nav-links, .page-numbers, link[rel="next"]').length > 0;
        const articleCards = $('article, .post-item, .article-card, .entry-header, .post').length;

        if (hasPagination || articleCards >= 3) {
          return 'LISTING_PAGE';
        }
      }

      // Default for deep paths: Article page
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length >= 2 || /\b(19\d\d|20\d\d)\b/.test(pathname)) {
        return 'ARTICLE_PAGE';
      }

      return 'LISTING_PAGE';
    } catch {
      return 'DISCARD';
    }
  }

  /**
   * Extracts clean article links from the main content collection on a listing page.
   * Filters out header, footer, navigation, and sidebar links.
   * @param {import('../parser/adaptor.js').Response|object} response 
   * @param {object} profile 
   * @param {string} baseUrl 
   * @returns {string[]}
   */
  static extractArticleLinksFromListing(response, profile, baseUrl) {
    const $ = response.$ || (typeof response.css === 'function' ? response.$ : null);
    if (!$) return [];

    let origin;
    try {
      origin = new URL(baseUrl).origin;
    } catch {
      return [];
    }

    const discoveredUrls = new Set();

    // Selectors targeting article cards/items
    const articleContainers = $(
      'article, .post, .entry, .card, .post-item, .article-card, .item'
    );

    const candidateAnchors = [];
    if (articleContainers.length > 0) {
      articleContainers.each((_, elem) => {
        // Collect heading links first (highest probability of being the article canonical link)
        const headingAnchors = $(elem).find('h1 a, h2 a, h3 a, h4 a, .title a, .entry-title a, .post-title a, a.entry-title-link');
        if (headingAnchors.length > 0) {
          headingAnchors.each((_, a) => candidateAnchors.push($(a)));
        }
        // Also collect all other anchors within the card/container
        $(elem).find('a').each((_, a) => {
          candidateAnchors.push($(a));
        });
      });
    }

    // Include main content area links
    $('main a, [role="main"] a, .content a, #content a, .posts a, .articles a').each((_, a) => {
      candidateAnchors.push($(a));
    });

    // Fallback: If no candidate anchors collected from structural containers, inspect all page anchors
    if (candidateAnchors.length === 0) {
      $('a').each((_, a) => candidateAnchors.push($(a)));
    }

    const processAnchor = (anchor) => {
      let rawHref = anchor.attr('href');
      if (!rawHref) return;

      const trimmedHref = rawHref.trim();
      if (
        !trimmedHref || 
        trimmedHref.startsWith('#') || 
        trimmedHref.startsWith('javascript:') || 
        trimmedHref.startsWith('mailto:') || 
        trimmedHref.startsWith('tel:') ||
        trimmedHref.startsWith('data:')
      ) {
        return;
      }

      try {
        const resolved = new URL(trimmedHref, baseUrl).href;
        const resolvedUrlObj = new URL(resolved);
        if (resolvedUrlObj.origin !== origin) return;

        // Skip same-page links
        const cleanBase = baseUrl.split('#')[0].replace(/\/$/, '');
        const cleanResolved = resolved.split('#')[0].replace(/\/$/, '');
        if (cleanResolved === cleanBase) return;

        if (this.isIgnoredNoise(resolved)) return;

        // Skip pagination, archive indices, and tag/category root index links as article candidates
        if (/[?&](page|p|offset|cursor)=\d+|\/page\/\d+/i.test(resolved)) return;
        if (/\/(category|tag|author|topics|sections|archive|archives)\/[^/]+\/?$/i.test(resolvedUrlObj.pathname)) return;

        // Verify with topic matcher
        const isMatch = this.isTopicMatch(resolved, profile, {
          anchorText: anchor.text().trim(),
          fromTopicListing: true,
          isSameOrigin: true
        });

        if (isMatch) {
          discoveredUrls.add(resolved);
        }
      } catch {}
    };

    for (const anchor of candidateAnchors) {
      processAnchor(anchor);
    }

    // If candidate containers yielded zero matches, run fallback over all anchors on the page
    if (discoveredUrls.size === 0 && candidateAnchors.length > 0) {
      $('a').each((_, elem) => {
        processAnchor($(elem));
      });
    }

    return Array.from(discoveredUrls);
  }
}
