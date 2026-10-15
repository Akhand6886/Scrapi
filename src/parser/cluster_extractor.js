/**
 * Unsupervised Structural Entity Induction & Pattern Clustering Engine
 * ────────────────────────────────────────────────────────────────────
 * Automatically detects and extracts repeating entity collections (products,
 * news cards, search results, directory listings, tabular records) from any
 * web page without requiring manual CSS selectors or expensive LLM tokens.
 */

// Common currency and pricing patterns
const PRICE_REGEX = /(?:[\$\€\£\¥\₹]|USD|EUR|GBP|INR|AUD|CAD)\s*[\d,]+(?:\.\d{1,2})?|\b[\d,]+(?:\.\d{1,2})?\s*(?:[\$\€\£\¥\₹]|USD|EUR|GBP|INR|CAD)\b/i;
// Common relative and absolute date patterns
const DATE_REGEX = /\b(?:\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d+\s+(?:min|minute|hour|day|week|month|year)s?\s+ago)\b/i;
// Rating patterns (e.g. "4.8 out of 5", "★ 4.5", "4.5 / 5")
const RATING_REGEX = /\b(?:[★☆]?\s*([0-5](?:\.\d)?)\s*(?:\/|\s+out\s+of\s+)\s*5|[0-5]\.\d\s*★)\b/i;
// Badges / Tags (short promotional or status text)
const BADGE_WORDS = new Set(['sale', 'new', 'featured', 'sponsored', 'bestseller', 'best seller', 'popular', 'trending', 'deal', 'discount', 'free shipping', 'verified']);

const INLINE_DECORATORS = new Set(['span', 'em', 'strong', 'b', 'small', 'i', 'mark', 'label', 'font']);

/**
 * Computes a structural tag skeleton signature of a DOM subtree.
 * Filters out cosmetic inline tags so entities with optional badges or status pills cluster cleanly.
 * @param {object} $ - Cheerio instance
 * @param {object} elem - Cheerio element
 * @param {number} [maxDepth=4]
 * @returns {string} Normalized tag structure string
 */
export function computeTreeSignature($, elem, maxDepth = 4) {
  function walk(node, depth) {
    if (!node || node.type !== 'tag' || depth > maxDepth) return '';
    const tag = node.name ? node.name.toLowerCase() : '';
    if (['script', 'style', 'noscript', 'svg', 'br', 'hr'].includes(tag)) return '';
    if (INLINE_DECORATORS.has(tag)) return ''; // Skip inline cosmetic wrappers

    const childSignatures = [];
    if (node.children) {
      for (const child of node.children) {
        if (child.type === 'tag') {
          const sig = walk(child, depth + 1);
          if (sig) childSignatures.push(sig);
        }
      }
    }

    if (childSignatures.length === 0) return tag;
    return `${tag}(${childSignatures.join(',')})`;
  }

  return walk(elem, 0);
}

/**
 * Finds all repeating sibling element clusters in a DOM document.
 * @param {object} $ - Cheerio instance
 * @param {object} [options]
 * @param {string} [options.rootSelector] - Optional root selector to restrict search
 * @param {number} [options.minItems=3] - Minimum cluster size
 * @param {number} [options.minAvgTextLen=15] - Minimum average text length
 * @returns {Array<{ parentSelector: string, signature: string, elements: object[], avgTextLen: number, score: number }>}
 */
export function findRepeatingClusters($, options = {}) {
  const minItems = options.minItems || 3;
  const minAvgTextLen = options.minAvgTextLen || 15;
  const rootSelector = options.rootSelector || 'body';

  const root = $(rootSelector).first();
  if (root.length === 0) return [];

  const candidateContainers = root.find('ul, ol, tbody, div, section, main, [role="feed"], [role="list"], [role="grid"]');
  const clusters = [];

  candidateContainers.each((_, container) => {
    const $container = $(container);
    // Ignore small containers
    const children = $container.children().filter((_, el) => el.type === 'tag' && !['script', 'style'].includes(el.name.toLowerCase()));
    if (children.length < minItems) return;

    // Group direct children by their structural tree signature
    const signatureGroups = new Map();

    children.each((idx, child) => {
      const sig = computeTreeSignature($, child, 3);
      if (!sig) return;

      if (!signatureGroups.has(sig)) {
        signatureGroups.set(sig, []);
      }
      signatureGroups.get(sig).push(child);
    });

    for (const [sig, elements] of signatureGroups.entries()) {
      if (elements.length < minItems) continue;

      // Calculate cluster text metrics
      let totalTextLen = 0;
      let totalLinks = 0;
      let totalImages = 0;

      for (const el of elements) {
        const text = $(el).text().trim();
        totalTextLen += text.length;
        totalLinks += $(el).find('a[href]').length;
        totalImages += $(el).find('img').length;
      }

      const avgTextLen = totalTextLen / elements.length;
      if (avgTextLen < minAvgTextLen) continue; // Filter out icon bars, pure pagination, or empty tags

      // Score the cluster: prefer clusters with substantial text, links, and photos
      const linkDensity = totalLinks / elements.length;
      const imageDensity = totalImages / elements.length;
      const regularityScore = Math.min(elements.length / 10, 2.0); // reward size up to 20 items
      
      const score = (avgTextLen * 0.4) + (linkDensity * 20) + (imageDensity * 30) + (regularityScore * 15);

      clusters.push({
        signature: sig,
        elements,
        count: elements.length,
        avgTextLen,
        score
      });
    }
  });

  // Sort by highest composite score
  return clusters.sort((a, b) => b.score - a.score);
}

/**
 * Induces structured semantic fields from an individual cluster item.
 * @param {object} $ - Cheerio instance
 * @param {object} itemElem - DOM node of single item
 * @param {string} [baseUrl='']
 * @returns {Record<string, *>} Extracted fields (title, url, price, image, etc.)
 */
export function induceItemFields($, itemElem, baseUrl = '') {
  const $el = $(itemElem);
  const fields = {};

  // 1. Title Extraction
  // Priority: h1-h6 -> a with high text -> strong/b -> first substantial text element
  let title = '';
  const headings = $el.find('h1, h2, h3, h4, h5, h6');
  if (headings.length > 0) {
    title = headings.first().text().trim();
  }

  if (!title) {
    const prominentLinks = $el.find('a');
    for (let i = 0; i < prominentLinks.length; i++) {
      const linkText = $(prominentLinks[i]).text().trim();
      if (linkText.length > 5 && !PRICE_REGEX.test(linkText)) {
        title = linkText;
        break;
      }
    }
  }

  if (!title) {
    const bold = $el.find('strong, b, [class*="title"], [class*="heading"], [class*="name"]');
    if (bold.length > 0) {
      title = bold.first().text().trim();
    }
  }

  if (title) {
    fields.title = title.replace(/\s+/g, ' ').slice(0, 200);
  }

  // 2. URL / Link Extraction
  const primaryLink = $el.find('a[href]').first();
  if (primaryLink.length > 0) {
    let href = primaryLink.attr('href') || '';
    if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
      if (baseUrl && !href.startsWith('http')) {
        try {
          href = new URL(href, baseUrl).href;
        } catch {}
      }
      fields.url = href;
    }
  }

  // 3. Image Extraction
  const img = $el.find('img').first();
  if (img.length > 0) {
    let src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || img.attr('srcset') || '';
    if (src) {
      if (src.includes(',')) src = src.split(',')[0].trim().split(' ')[0];
      if (baseUrl && !src.startsWith('http') && !src.startsWith('data:')) {
        try {
          src = new URL(src, baseUrl).href;
        } catch {}
      }
      fields.image = src;
    }
  }

  // 4. Raw Text & Price Extraction
  const fullText = $el.text().replace(/\s+/g, ' ').trim();
  const priceMatch = fullText.match(PRICE_REGEX);
  if (priceMatch) {
    fields.price = priceMatch[0].trim();
  }

  // 5. Rating Extraction
  const ratingMatch = fullText.match(RATING_REGEX);
  if (ratingMatch) {
    fields.rating = ratingMatch[1] || ratingMatch[0].trim();
  }

  // 6. Date Extraction
  const dateMatch = fullText.match(DATE_REGEX);
  if (dateMatch) {
    fields.date = dateMatch[0].trim();
  }

  // 7. Badge / Tag Extraction
  $el.find('span, div, em, small').each((_, span) => {
    if (fields.badge) return;
    const sText = $(span).text().trim().toLowerCase();
    if (sText.length > 1 && sText.length < 25 && BADGE_WORDS.has(sText)) {
      fields.badge = $(span).text().trim();
    }
  });

  // 8. Description / Prose Snippet
  // Find longest paragraph or span not matching title
  let bestDesc = '';
  $el.find('p, [class*="desc"], [class*="snippet"], [class*="summary"]').each((_, p) => {
    const pText = $(p).text().trim();
    if (pText.length > bestDesc.length && (!title || !pText.includes(title))) {
      bestDesc = pText;
    }
  });
  if (bestDesc && bestDesc.length > 10) {
    fields.description = bestDesc.replace(/\s+/g, ' ').slice(0, 300);
  }

  return fields;
}

/**
 * Top-level unsupervised entity extraction function.
 * @param {object} $ - Cheerio instance
 * @param {object} [options]
 * @param {string} [options.rootSelector] - Optional root selector
 * @param {number} [options.limit=100] - Max entities to return
 * @param {string} [options.baseUrl=''] - Base URL for relative link resolution
 * @returns {{
 *   entities: Array<Record<string, *>>,
 *   detectedType: 'catalog'|'news'|'table'|'list'|'generic',
 *   clusterCount: number,
 *   confidence: number
 * }}
 */
export function extractEntities($, options = {}) {
  const clusters = findRepeatingClusters($, options);
  if (clusters.length === 0) {
    return {
      entities: [],
      detectedType: 'generic',
      clusterCount: 0,
      confidence: 0
    };
  }

  // Use highest-scoring cluster
  const topCluster = clusters[0];
  const baseUrl = options.baseUrl || '';
  const limit = options.limit || 100;

  const rawEntities = topCluster.elements
    .slice(0, limit)
    .map(el => induceItemFields($, el, baseUrl))
    .filter(item => Object.keys(item).length >= 1 && (item.title || item.url || item.price));

  // Determine collection archetype
  let hasPrice = 0;
  let hasDate = 0;
  let hasImage = 0;

  for (const ent of rawEntities) {
    if (ent.price) hasPrice++;
    if (ent.date) hasDate++;
    if (ent.image) hasImage++;
  }

  const n = Math.max(1, rawEntities.length);
  let detectedType = 'list';
  if (hasPrice / n >= 0.4) {
    detectedType = 'catalog'; // e-commerce products
  } else if (hasDate / n >= 0.4) {
    detectedType = 'news'; // blog or news feed
  } else if (hasImage / n >= 0.6) {
    detectedType = 'gallery';
  }

  const confidence = Math.min(1.0, parseFloat(((rawEntities.length / topCluster.elements.length) * 0.95).toFixed(2)));

  return {
    entities: rawEntities,
    detectedType,
    clusterCount: clusters.length,
    totalItemsFound: rawEntities.length,
    confidence
  };
}
