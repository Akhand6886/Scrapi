import { DecisionTreeNode, DecisionTree } from './engine.js';

/**
 * Scrapi Crawl Frontier Prioritizer v2.0
 * ────────────────────────────────────────
 * Enhanced with:
 *  • Anchor Text Semantic Scoring (link text content relevance)
 *  • URL Freshness Signals (date patterns in URL slugs)
 *  • Domain-Depth Penalty (excessively deep URLs are lower priority)
 *  • Slug Quality Analysis (readable vs hash/UUID slugs)
 *  • Fragment and Anchor Handling (#hash links)
 *  • API / REST Endpoint Detection
 *  • Internationalization / Language Path Detection
 *  • Duplicate Parameter Detection (tracking / analytics noise)
 *  • Composite Priority Score with Multi-Signal Weighting
 */

// ──────────────────────────────────────────
// Pattern Databases
// ──────────────────────────────────────────

const CONTENT_PATH_REGEX = /\/(post|posts|article|articles|blog|news|story|stories|entry|entries|docs|documentation|wiki|guide|guides|tutorial|tutorials|item|items|review|reviews|recipe|recipes|paper|papers|case-study|whitepaper|report|analysis|opinion|editorial)\//i;
const NOISE_PATH_REGEX = /\/(login|logout|signin|signup|register|cart|checkout|auth|account|wp-admin|wp-login|xmlrpc|feed|cdn-cgi|wp-cron|wp-json\/wp|cgi-bin|_next\/static|_next\/data|__webpack|\.well-known)\b/i;
const PAGINATION_REGEX = /[?&](page|p|start|offset|cursor|after|before)=\d+|\/page\/\d+/i;
const FILTER_QUERY_REGEX = /[?&](sort|order|direction|filter|ref|utm_|source|medium|campaign|view=|lang=|locale=|format=|callback=)/i;
const MEDIA_EXT_REGEX = /\.(jpg|jpeg|png|gif|svg|webp|avif|pdf|zip|tar|gz|bz2|xz|mp4|webm|mp3|wav|ogg|exe|dmg|iso|rar|7z|css|woff|woff2|ttf|eot|ico|map)$/i;
const DATE_SLUG_REGEX = /\/\d{4}\/\d{1,2}(\/\d{1,2})?\//;
const HASH_UUID_REGEX = /[a-f0-9]{8,}[-_]?[a-f0-9]{4,}/i;
const API_PATH_REGEX = /\/(api|graphql|rest|v\d+|webhook|callback|rpc)\//i;
const LANG_PATH_REGEX = /^\/(en|es|fr|de|ja|ko|zh|pt|ru|it|ar|hi|nl|pl|sv|tr|cs|da|fi|el|he|hu|id|ms|no|ro|sk|th|uk|vi)(\/|$)/i;
const TRACKING_PARAMS_REGEX = /[?&](utm_|fbclid|gclid|mc_|_ga|_gid|ref_|source_|campaign_|affiliate|tracking|click_id|session_id)/i;

// ──────────────────────────────────────────
// Feature Extraction
// ──────────────────────────────────────────

/**
 * Extracts comprehensive decision tree features from a candidate URL string.
 * @param {string} urlStr 
 * @param {object} [context] - Optional context
 * @param {string} [context.anchorText] - Link text content
 * @param {string} [context.parentUrl] - URL of the page containing this link
 * @returns {object} Feature dictionary
 */
export function extractUrlFeatures(urlStr, context = {}) {
  try {
    const u = new URL(urlStr);
    const pathname = u.pathname.toLowerCase();
    const search = u.search.toLowerCase();
    const hash = u.hash;
    const full = `${pathname}${search}`;

    // ─── Binary / Non-Content Detection ───
    const isNonHtmlExtension = MEDIA_EXT_REGEX.test(pathname);
    const isAuthOrSystemNoise = NOISE_PATH_REGEX.test(pathname);
    const isFilterOrSort = FILTER_QUERY_REGEX.test(search);
    const isPagination = PAGINATION_REGEX.test(full);
    const isContentPath = CONTENT_PATH_REGEX.test(pathname) || DATE_SLUG_REGEX.test(pathname);
    const isApiEndpoint = API_PATH_REGEX.test(pathname);
    const hasTrackingParams = TRACKING_PARAMS_REGEX.test(search);

    // ─── URL Structure Analysis ───
    const segments = pathname.split('/').filter(Boolean);
    const pathDepth = segments.length;
    const urlLength = urlStr.length;
    const hasFragment = hash.length > 1;
    const queryParamCount = search ? (search.match(/[?&]/g) || []).length : 0;

    // ─── Slug Quality Analysis ───
    const lastSegment = segments[segments.length - 1] || '';
    const isReadableSlug = lastSegment.includes('-') && lastSegment.length > 5 && lastSegment.length < 120;
    const isHashSlug = HASH_UUID_REGEX.test(lastSegment);

    // ─── Date / Freshness Signals ───
    const hasDateInPath = DATE_SLUG_REGEX.test(pathname);
    let yearInPath = 0;
    const yearMatch = pathname.match(/\/(\d{4})\//);
    if (yearMatch) {
      yearInPath = parseInt(yearMatch[1], 10);
    }
    const currentYear = new Date().getFullYear();
    const isRecentDate = yearInPath >= currentYear - 1;
    const isOldDate = yearInPath > 0 && yearInPath < currentYear - 3;

    // ─── Language / i18n Detection ───
    const isLanguagePath = LANG_PATH_REGEX.test(pathname);

    // ─── Anchor Text Analysis ───
    const anchorText = (context.anchorText || '').trim();
    const anchorWordCount = anchorText.split(/\s+/).filter(Boolean).length;
    const hasDescriptiveAnchor = anchorWordCount >= 3 && anchorWordCount <= 20;
    const isGenericAnchor = /^(click here|read more|learn more|more|link|here|see more|view|details|»|›|→)$/i.test(anchorText);

    // ─── Same-Domain Detection ───
    const isSameOrigin = context.parentUrl ? (() => {
      try {
        return new URL(context.parentUrl).origin === u.origin;
      } catch { return true; }
    })() : true;

    return {
      isNonHtmlExtension,
      isAuthOrSystemNoise,
      isFilterOrSort,
      isPagination,
      isContentPath,
      isApiEndpoint,
      hasTrackingParams,
      pathDepth,
      urlLength,
      hasFragment,
      queryParamCount,
      isReadableSlug,
      isHashSlug,
      hasDateInPath,
      isRecentDate,
      isOldDate,
      isLanguagePath,
      hasDescriptiveAnchor,
      isGenericAnchor,
      anchorWordCount,
      isSameOrigin
    };
  } catch (e) {
    return {
      isNonHtmlExtension: true,
      isAuthOrSystemNoise: true,
      isFilterOrSort: true,
      isPagination: false,
      isContentPath: false,
      isApiEndpoint: false,
      hasTrackingParams: false,
      pathDepth: 0,
      urlLength: urlStr ? urlStr.length : 0,
      hasFragment: false,
      queryParamCount: 0,
      isReadableSlug: false,
      isHashSlug: false,
      hasDateInPath: false,
      isRecentDate: false,
      isOldDate: false,
      isLanguagePath: false,
      hasDescriptiveAnchor: false,
      isGenericAnchor: false,
      anchorWordCount: 0,
      isSameOrigin: false
    };
  }
}

// ──────────────────────────────────────────
// Decision Tree Construction
// ──────────────────────────────────────────

/**
 * Builds the Crawl Priority Decision Tree v2.0.
 * @returns {DecisionTree}
 */
export function buildCrawlPriorityTree() {
  // ─── Leaf Nodes ───
  const leafDiscard = new DecisionTreeNode({
    value: 'DISCARD',
    confidence: 0.99,
    label: 'Discardable URL (Media, Binary, or Auth/Admin Endpoint)',
    metadata: { priorityRank: 0 }
  });

  const leafDiscardApi = new DecisionTreeNode({
    value: 'DISCARD_API',
    confidence: 0.95,
    label: 'API / REST Endpoint (Not Crawlable Content)',
    metadata: { priorityRank: 5 }
  });

  const leafDiscardFragment = new DecisionTreeNode({
    value: 'DISCARD_FRAGMENT',
    confidence: 0.90,
    label: 'Same-Page Anchor Fragment Link',
    metadata: { priorityRank: 0 }
  });

  const leafLowFilter = new DecisionTreeNode({
    value: 'LOW_PRIORITY',
    confidence: 0.88,
    label: 'Low Priority Query Parameter Duplicate / Sorting Variant',
    metadata: { priorityRank: 15 }
  });

  const leafLowTracking = new DecisionTreeNode({
    value: 'LOW_PRIORITY',
    confidence: 0.85,
    label: 'Low Priority Tracking / Analytics Parameter URL',
    metadata: { priorityRank: 10 }
  });

  const leafLowDeep = new DecisionTreeNode({
    value: 'LOW_PRIORITY',
    confidence: 0.80,
    label: 'Excessively Deep URL (Depth > 6)',
    metadata: { priorityRank: 12 }
  });

  const leafLowHashSlug = new DecisionTreeNode({
    value: 'LOW_PRIORITY',
    confidence: 0.78,
    label: 'Hash/UUID Slug (Likely Generated / Non-Content)',
    metadata: { priorityRank: 18 }
  });

  const leafHighContentRecent = new DecisionTreeNode({
    value: 'HIGH_PRIORITY_CONTENT',
    confidence: 0.98,
    label: 'High Priority Recent Content (Current Year)',
    metadata: { priorityRank: 100 }
  });

  const leafHighContent = new DecisionTreeNode({
    value: 'HIGH_PRIORITY_CONTENT',
    confidence: 0.96,
    label: 'High Priority Content Document (Article / Post / Guide)',
    metadata: { priorityRank: 90 }
  });

  const leafHighDescriptive = new DecisionTreeNode({
    value: 'HIGH_PRIORITY_CONTENT',
    confidence: 0.90,
    label: 'High Priority — Descriptive Anchor Text + Readable Slug',
    metadata: { priorityRank: 85 }
  });

  const leafMediumPagination = new DecisionTreeNode({
    value: 'MEDIUM_PRIORITY_INDEX',
    confidence: 0.90,
    label: 'Medium Priority Pagination / Listing Page',
    metadata: { priorityRank: 60 }
  });

  const leafMediumOldContent = new DecisionTreeNode({
    value: 'MEDIUM_PRIORITY_CONTENT',
    confidence: 0.85,
    label: 'Medium Priority Older Content (>3 Years Ago)',
    metadata: { priorityRank: 50 }
  });

  const leafStandardLink = new DecisionTreeNode({
    value: 'STANDARD_INTERNAL',
    confidence: 0.85,
    label: 'Standard Same-Origin Internal Link',
    metadata: { priorityRank: 40 }
  });

  const leafExternalLink = new DecisionTreeNode({
    value: 'EXTERNAL_LINK',
    confidence: 0.80,
    label: 'Cross-Origin External Link',
    metadata: { priorityRank: 25 }
  });

  // ─── Branch Nodes (Bottom up) ───

  // Same-origin vs external
  const nodeExternal = new DecisionTreeNode({
    feature: 'isSameOrigin',
    operator: '==',
    threshold: true,
    left: leafStandardLink,
    right: leafExternalLink
  });

  // Readable slug + descriptive anchor = high quality link
  const nodeSlugQuality = new DecisionTreeNode({
    feature: 'isReadableSlug',
    operator: '==',
    threshold: true,
    left: new DecisionTreeNode({
      feature: 'hasDescriptiveAnchor',
      operator: '==',
      threshold: true,
      left: leafHighDescriptive,
      right: nodeExternal
    }),
    right: new DecisionTreeNode({
      feature: 'isHashSlug',
      operator: '==',
      threshold: true,
      left: leafLowHashSlug,
      right: nodeExternal
    })
  });

  // Freshness routing for content paths
  const nodeFreshness = new DecisionTreeNode({
    feature: 'hasDateInPath',
    operator: '==',
    threshold: true,
    left: new DecisionTreeNode({
      feature: 'isRecentDate',
      operator: '==',
      threshold: true,
      left: leafHighContentRecent,
      right: new DecisionTreeNode({
        feature: 'isOldDate',
        operator: '==',
        threshold: true,
        left: leafMediumOldContent,
        right: leafHighContent
      })
    }),
    right: leafHighContent
  });

  // Content path detection
  const nodeContentPath = new DecisionTreeNode({
    feature: 'isContentPath',
    operator: '==',
    threshold: true,
    left: nodeFreshness,
    right: nodeSlugQuality
  });

  // Pagination detection
  const nodePagination = new DecisionTreeNode({
    feature: 'isPagination',
    operator: '==',
    threshold: true,
    left: leafMediumPagination,
    right: nodeContentPath
  });

  // Deep URL penalty
  const nodeDeepUrl = new DecisionTreeNode({
    feature: 'pathDepth',
    operator: '>',
    threshold: 6,
    left: leafLowDeep,
    right: nodePagination
  });

  // Tracking parameter detection
  const nodeTracking = new DecisionTreeNode({
    feature: 'hasTrackingParams',
    operator: '==',
    threshold: true,
    left: leafLowTracking,
    right: nodeDeepUrl
  });

  // Filter / sort parameter detection
  const nodeFilter = new DecisionTreeNode({
    feature: 'isFilterOrSort',
    operator: '==',
    threshold: true,
    left: leafLowFilter,
    right: nodeTracking
  });

  // Same-page fragment links
  const nodeFragment = new DecisionTreeNode({
    feature: 'hasFragment',
    operator: '==',
    threshold: true,
    left: leafDiscardFragment,
    right: nodeFilter
  });

  // API endpoint detection
  const nodeApi = new DecisionTreeNode({
    feature: 'isApiEndpoint',
    operator: '==',
    threshold: true,
    left: leafDiscardApi,
    right: nodeFragment
  });

  // Auth / system noise
  const nodeNoise = new DecisionTreeNode({
    feature: 'isAuthOrSystemNoise',
    operator: '==',
    threshold: true,
    left: leafDiscard,
    right: nodeApi
  });

  // Root: binary file extension
  const rootNode = new DecisionTreeNode({
    feature: 'isNonHtmlExtension',
    operator: '==',
    threshold: true,
    left: leafDiscard,
    right: nodeNoise
  });

  return new DecisionTree(rootNode, 'CrawlPriorityTree_v2');
}

export const globalCrawlPriorityTree = buildCrawlPriorityTree();

// ──────────────────────────────────────────
// Public API
// ──────────────────────────────────────────

/**
 * Classifies a candidate URL and computes priority rank.
 * @param {string} urlStr 
 * @param {object} [context] - Optional anchor text and parent URL
 * @returns {{ classification: string, priorityRank: number, confidence: number, label: string, path: string[], depth: number, features: object }}
 */
export function prioritizeUrl(urlStr, context = {}) {
  const features = extractUrlFeatures(urlStr, context);
  const explanation = globalCrawlPriorityTree.explain(features);

  return {
    classification: explanation.value,
    priorityRank: explanation.leaf?.metadata?.priorityRank || 0,
    confidence: explanation.confidence,
    label: explanation.label,
    path: explanation.path,
    depth: explanation.depth,
    leaf: explanation.leaf,
    features
  };
}

/**
 * Batch-prioritize an array of URLs and return them sorted by priority (descending).
 * @param {Array<string|{url: string, anchorText?: string}>} urls 
 * @param {object} [options]
 * @param {string} [options.parentUrl] - Source page URL
 * @param {number} [options.topK] - Max results
 * @param {boolean} [options.includeDiscarded=false] - Include DISCARD results
 * @returns {Array<{ url: string, classification: string, priorityRank: number, confidence: number, label: string }>}
 */
export function batchPrioritize(urls, options = {}) {
  const parentUrl = options.parentUrl || '';
  const topK = options.topK || urls.length;
  const includeDiscarded = options.includeDiscarded || false;

  const results = urls.map(entry => {
    const url = typeof entry === 'string' ? entry : entry.url;
    const anchorText = typeof entry === 'string' ? '' : (entry.anchorText || '');
    const result = prioritizeUrl(url, { anchorText, parentUrl });
    return {
      url,
      anchorText,
      classification: result.classification,
      priorityRank: result.priorityRank,
      confidence: result.confidence,
      label: result.label
    };
  });

  // Filter discarded if requested
  const filtered = includeDiscarded ? results : results.filter(r => !r.classification.startsWith('DISCARD'));

  // Sort by priority descending
  filtered.sort((a, b) => b.priorityRank - a.priorityRank);

  return filtered.slice(0, topK);
}
