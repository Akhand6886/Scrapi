import { DecisionTreeNode, DecisionTree } from './engine.js';

const CONTENT_PATH_REGEX = /\/(post|posts|article|articles|blog|news|story|entry|docs|documentation|wiki|guide|tutorial|item)\/|\/\d{4}\/\d{2}\//i;
const NOISE_PATH_REGEX = /\/(login|logout|signin|signup|register|cart|checkout|auth|account|wp-admin|wp-login|xmlrpc|feed|cdn-cgi)\b/i;
const PAGINATION_REGEX = /[?&](page|p|start)=\d+|\/page\/\d+/i;
const FILTER_QUERY_REGEX = /[?&](sort|order|direction|filter|ref|utm_|view=)/i;
const MEDIA_EXT_REGEX = /\.(jpg|jpeg|png|gif|svg|webp|avif|pdf|zip|tar|gz|mp4|webm|mp3|exe|dmg|iso)$/i;

/**
 * Extracts decision tree features from a candidate URL string.
 * @param {string} urlStr 
 * @returns {object} Feature dictionary
 */
export function extractUrlFeatures(urlStr) {
  try {
    const u = new URL(urlStr);
    const pathname = u.pathname.toLowerCase();
    const search = u.search.toLowerCase();
    const full = `${pathname}${search}`;

    const isNonHtmlExtension = MEDIA_EXT_REGEX.test(pathname);
    const isAuthOrSystemNoise = NOISE_PATH_REGEX.test(pathname);
    const isFilterOrSort = FILTER_QUERY_REGEX.test(search);
    const isPagination = PAGINATION_REGEX.test(full);
    const isContentPath = CONTENT_PATH_REGEX.test(pathname);

    const segments = pathname.split('/').filter(Boolean);
    const pathDepth = segments.length;
    const urlLength = urlStr.length;

    return {
      isNonHtmlExtension,
      isAuthOrSystemNoise,
      isFilterOrSort,
      isPagination,
      isContentPath,
      pathDepth,
      urlLength
    };
  } catch (e) {
    return {
      isNonHtmlExtension: true,
      isAuthOrSystemNoise: true,
      isFilterOrSort: true,
      isPagination: false,
      isContentPath: false,
      pathDepth: 0,
      urlLength: urlStr ? urlStr.length : 0
    };
  }
}

/**
 * Builds the Crawl Priority Decision Tree.
 * @returns {DecisionTree}
 */
export function buildCrawlPriorityTree() {
  // Leaf Nodes
  const leafDiscard = new DecisionTreeNode({
    value: 'DISCARD',
    confidence: 0.99,
    label: 'Discardable URL (Media, Binary, or Auth/Admin Endpoint)',
    metadata: { priorityRank: 0 }
  });

  const leafLowFilter = new DecisionTreeNode({
    value: 'LOW_PRIORITY',
    confidence: 0.88,
    label: 'Low Priority Query Parameter Duplicate / Sorting Variant',
    metadata: { priorityRank: 15 }
  });

  const leafHighContent = new DecisionTreeNode({
    value: 'HIGH_PRIORITY_CONTENT',
    confidence: 0.96,
    label: 'High Priority Content Document (Article / Post / Guide)',
    metadata: { priorityRank: 100 }
  });

  const leafMediumPagination = new DecisionTreeNode({
    value: 'MEDIUM_PRIORITY_INDEX',
    confidence: 0.90,
    label: 'Medium Priority Pagination / Listing Page',
    metadata: { priorityRank: 60 }
  });

  const leafStandardLink = new DecisionTreeNode({
    value: 'STANDARD_INTERNAL',
    confidence: 0.85,
    label: 'Standard Same-Origin Internal Link',
    metadata: { priorityRank: 40 }
  });

  // Branch Nodes (Bottom up)
  const nodeContentPath = new DecisionTreeNode({
    feature: 'isContentPath',
    operator: '==',
    threshold: true,
    left: leafHighContent,
    right: leafStandardLink
  });

  const nodePagination = new DecisionTreeNode({
    feature: 'isPagination',
    operator: '==',
    threshold: true,
    left: leafMediumPagination,
    right: nodeContentPath
  });

  const nodeFilter = new DecisionTreeNode({
    feature: 'isFilterOrSort',
    operator: '==',
    threshold: true,
    left: leafLowFilter,
    right: nodePagination
  });

  const nodeNoise = new DecisionTreeNode({
    feature: 'isAuthOrSystemNoise',
    operator: '==',
    threshold: true,
    left: leafDiscard,
    right: nodeFilter
  });

  const rootNode = new DecisionTreeNode({
    feature: 'isNonHtmlExtension',
    operator: '==',
    threshold: true,
    left: leafDiscard,
    right: nodeNoise
  });

  return new DecisionTree(rootNode, 'CrawlPriorityTree');
}

export const globalCrawlPriorityTree = buildCrawlPriorityTree();

/**
 * Classifies a candidate URL and computes priority rank.
 * @param {string} urlStr 
 * @returns {{ classification: string, priorityRank: number, explanation: object, features: object }}
 */
export function prioritizeUrl(urlStr) {
  const features = extractUrlFeatures(urlStr);
  const explanation = globalCrawlPriorityTree.explain(features);

  return {
    classification: explanation.value,
    priorityRank: explanation.leaf?.metadata?.priorityRank || 0,
    confidence: explanation.confidence,
    label: explanation.label,
    path: explanation.path,
    leaf: explanation.leaf,
    features
  };
}
