import { DecisionTreeNode, DecisionTree } from './engine.js';

const POSITIVE_PATTERNS = /(article|post|entry|content|main|body|story|text|blog)/i;
const NEGATIVE_PATTERNS = /(sidebar|comment|footer|nav|menu|widget|ad|advertisement|banner|cookie|popup|social|share|promo|sponsor)/i;

/**
 * Extracts decision tree features from a Cheerio DOM element.
 * @param {object} $ - Cheerio instance
 * @param {object} elem - Cheerio element
 * @returns {object} Feature dictionary
 */
export function extractContentFeatures($, elem) {
  const $el = $(elem);
  const text = $el.text().trim();
  const textLength = text.length;

  // Link density: length of text inside anchor tags divided by total text length
  let anchorTextLength = 0;
  $el.find('a').each((_, a) => {
    anchorTextLength += $(a).text().trim().length;
  });
  const linkDensity = textLength > 0 ? parseFloat((anchorTextLength / textLength).toFixed(3)) : 0;

  const pTagCount = $el.find('p').length;

  const classAndId = `${$el.attr('class') || ''} ${$el.attr('id') || ''}`.toLowerCase();
  
  // Count tokens
  const tokens = classAndId.split(/\s+/).filter(Boolean);
  let positiveTokenCount = 0;
  let negativeTokenCount = 0;

  for (const t of tokens) {
    if (POSITIVE_PATTERNS.test(t)) positiveTokenCount++;
    if (NEGATIVE_PATTERNS.test(t)) negativeTokenCount++;
  }

  // Tag depth from body
  let depth = 0;
  let cur = elem.parent;
  while (cur && cur.name && cur.name !== 'body' && cur.name !== 'html') {
    depth++;
    cur = cur.parent;
  }

  const tagName = elem.name ? elem.name.toLowerCase() : 'div';

  return {
    tagName,
    textLength,
    linkDensity,
    pTagCount,
    positiveTokenCount,
    negativeTokenCount,
    tagDepth: depth
  };
}

/**
 * Builds the DOM Content Extractor Decision Tree.
 * @returns {DecisionTree}
 */
export function buildContentExtractorTree() {
  // Leaf Nodes
  const leafHighContent = new DecisionTreeNode({
    value: 'MAIN_CONTENT',
    confidence: 0.98,
    label: 'High Confidence Main Content Body',
    metadata: { scoreWeight: 1.0 }
  });

  const leafArticleTag = new DecisionTreeNode({
    value: 'MAIN_CONTENT',
    confidence: 0.95,
    label: 'Semantic <article> / <main> Content Container',
    metadata: { scoreWeight: 0.95 }
  });

  const leafParagraphCluster = new DecisionTreeNode({
    value: 'MAIN_CONTENT',
    confidence: 0.88,
    label: 'Dense Paragraph Text Cluster',
    metadata: { scoreWeight: 0.88 }
  });

  const leafGenericDiv = new DecisionTreeNode({
    value: 'POSSIBLE_CONTENT',
    confidence: 0.60,
    label: 'Generic Block with Moderate Content',
    metadata: { scoreWeight: 0.60 }
  });

  const leafBoilerplateHighLinks = new DecisionTreeNode({
    value: 'BOILERPLATE',
    confidence: 0.92,
    label: 'High Link-Density Boilerplate (Navigation / Index)',
    metadata: { scoreWeight: 0.15 }
  });

  const leafBoilerplateNoiseTokens = new DecisionTreeNode({
    value: 'BOILERPLATE',
    confidence: 0.94,
    label: 'Negative Identifier Boilerplate (Sidebar / Comments / Ad)',
    metadata: { scoreWeight: 0.10 }
  });

  const leafEmptyNoise = new DecisionTreeNode({
    value: 'NOISE',
    confidence: 0.99,
    label: 'Short / Empty Non-Content Block',
    metadata: { scoreWeight: 0.02 }
  });

  // Branch Nodes (Bottom up)
  const nodeParagraphCluster = new DecisionTreeNode({
    feature: 'pTagCount',
    operator: '>=',
    threshold: 3,
    left: leafParagraphCluster,
    right: leafGenericDiv
  });

  const nodeArticleTag = new DecisionTreeNode({
    feature: 'tagName',
    operator: 'in',
    threshold: ['article', 'main'],
    left: leafArticleTag,
    right: nodeParagraphCluster
  });

  const nodePositiveTokens = new DecisionTreeNode({
    feature: 'positiveTokenCount',
    operator: '>=',
    threshold: 1,
    left: leafHighContent,
    right: nodeArticleTag
  });

  const nodeLinkDensity = new DecisionTreeNode({
    feature: 'linkDensity',
    operator: '>',
    threshold: 0.45,
    left: leafBoilerplateHighLinks,
    right: nodePositiveTokens
  });

  const nodeNegativeTokens = new DecisionTreeNode({
    feature: 'negativeTokenCount',
    operator: '>=',
    threshold: 2,
    left: leafBoilerplateNoiseTokens,
    right: nodeLinkDensity
  });

  const rootNode = new DecisionTreeNode({
    feature: 'textLength',
    operator: '<',
    threshold: 80,
    left: leafEmptyNoise,
    right: nodeNegativeTokens
  });

  return new DecisionTree(rootNode, 'DOMContentExtractorTree');
}

export const globalContentExtractorTree = buildContentExtractorTree();

/**
 * Evaluates candidate element and returns classification and content score.
 * @param {object} $ 
 * @param {object} elem 
 * @returns {{ classification: string, score: number, confidence: number, explanation: object, features: object }}
 */
export function scoreContentElement($, elem) {
  const features = extractContentFeatures($, elem);
  const explanation = globalContentExtractorTree.explain(features);

  // Compute composite score combining text length and leaf weight
  const baseWeight = explanation.leaf?.metadata?.scoreWeight || 0.5;
  const lengthBonus = Math.min(Math.log10(Math.max(features.textLength, 10)) / 4, 1.2);
  const compositeScore = parseFloat((baseWeight * lengthBonus).toFixed(3));

  return {
    classification: explanation.value,
    score: compositeScore,
    confidence: explanation.confidence,
    label: explanation.label,
    path: explanation.path,
    leaf: explanation.leaf,
    features
  };
}
