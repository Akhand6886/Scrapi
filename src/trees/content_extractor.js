import { DecisionTreeNode, DecisionTree } from './engine.js';

/**
 * Scrapi DOM Content Extractor v2.0
 * ───────────────────────────────────
 * Enhanced with:
 *  • Image Density Analysis (img-to-text ratio for galleries vs articles)
 *  • Heading Hierarchy Scoring (h1–h6 structure)
 *  • Semantic HTML5 Data Attribute Detection (data-*, role, aria-*)
 *  • Table vs Article Classification
 *  • List Density Analysis (ul/ol clusters)
 *  • Form Detection (interactive content areas)
 *  • Composite Scoring with Multi-Signal Fusion
 */

// ──────────────────────────────────────────
// Pattern Databases
// ──────────────────────────────────────────

const POSITIVE_PATTERNS = /(article|post|entry|content|main|body|story|text|blog|prose|editorial|detail|description|page-content|single-content)/i;
const NEGATIVE_PATTERNS = /(sidebar|comment|footer|nav|menu|widget|ad|advertisement|banner|cookie|popup|social|share|promo|sponsor|related|recommended|breadcrumb|pagination|newsletter|subscribe|modal|overlay|tooltip)/i;
const SEMANTIC_ROLES = ['main', 'article', 'contentinfo', 'region'];

// ──────────────────────────────────────────
// Feature Extraction
// ──────────────────────────────────────────

/**
 * Extracts comprehensive decision tree features from a Cheerio DOM element.
 * @param {object} $ - Cheerio instance
 * @param {object} elem - Cheerio element
 * @returns {object} Feature dictionary
 */
export function extractContentFeatures($, elem) {
  const $el = $(elem);
  const text = $el.text().trim();
  const textLength = text.length;

  // ─── Link Density ───
  let anchorTextLength = 0;
  $el.find('a').each((_, a) => {
    anchorTextLength += $(a).text().trim().length;
  });
  const linkDensity = textLength > 0 ? parseFloat((anchorTextLength / textLength).toFixed(3)) : 0;
  const anchorCount = $el.find('a').length;

  // ─── Paragraph & Heading Analysis ───
  const pTagCount = $el.find('p').length;
  const h1Count = $el.find('h1').length;
  const h2Count = $el.find('h2').length;
  const h3Count = $el.find('h3').length;
  const headingCount = h1Count + h2Count + h3Count + $el.find('h4, h5, h6').length;
  const hasStructuredHeadings = h1Count <= 1 && (h2Count > 0 || h3Count > 0);

  // ─── Image Density ───
  const imgCount = $el.find('img').length;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const imgToWordRatio = wordCount > 0 ? parseFloat((imgCount / wordCount * 100).toFixed(2)) : (imgCount > 0 ? 100 : 0);

  // ─── List Density ───
  const listItemCount = $el.find('li').length;
  const listCount = $el.find('ul, ol').length;
  const isListHeavy = listItemCount > 10 && listItemCount > pTagCount * 3;

  // ─── Table Detection ───
  const tableCount = $el.find('table').length;
  const tableRowCount = $el.find('tr').length;
  const isTableContent = tableCount > 0 && tableRowCount > 3;

  // ─── Form Detection ───
  const formCount = $el.find('form').length;
  const inputCount = $el.find('input, textarea, select').length;
  const isFormHeavy = inputCount > 3;

  // ─── Class & ID Token Analysis ───
  const classAndId = `${$el.attr('class') || ''} ${$el.attr('id') || ''}`.toLowerCase();
  const tokens = classAndId.split(/\s+/).filter(Boolean);
  let positiveTokenCount = 0;
  let negativeTokenCount = 0;

  for (const t of tokens) {
    if (POSITIVE_PATTERNS.test(t)) positiveTokenCount++;
    if (NEGATIVE_PATTERNS.test(t)) negativeTokenCount++;
  }

  // ─── Semantic HTML5 Signals ───
  const role = ($el.attr('role') || '').toLowerCase();
  const hasSemanticRole = SEMANTIC_ROLES.includes(role);
  const hasItemProp = !!$el.attr('itemprop');
  const hasDataContent = !!($el.attr('data-content') || $el.attr('data-article') || $el.attr('data-post'));

  // ─── Tag Depth ───
  let depth = 0;
  let cur = elem.parent;
  while (cur && cur.name && cur.name !== 'body' && cur.name !== 'html') {
    depth++;
    cur = cur.parent;
  }

  const tagName = elem.name ? elem.name.toLowerCase() : 'div';

  // ─── Sentence Estimation (period-terminated phrases) ───
  const sentenceCount = (text.match(/[.!?]+\s/g) || []).length;

  // ─── Inline Element Ratio (emphasis, strong, code) ───
  const inlineCount = $el.find('em, strong, b, i, code, mark, abbr').length;
  const hasRichFormatting = inlineCount >= 3;

  return {
    tagName,
    textLength,
    wordCount,
    sentenceCount,
    linkDensity,
    anchorCount,
    pTagCount,
    headingCount,
    h1Count,
    h2Count,
    hasStructuredHeadings,
    imgCount,
    imgToWordRatio,
    listItemCount,
    isListHeavy,
    tableCount,
    isTableContent,
    formCount,
    isFormHeavy,
    positiveTokenCount,
    negativeTokenCount,
    hasSemanticRole,
    hasItemProp,
    hasDataContent,
    hasRichFormatting,
    tagDepth: depth
  };
}

// ──────────────────────────────────────────
// Decision Tree Construction
// ──────────────────────────────────────────

/**
 * Builds the DOM Content Extractor Decision Tree v2.0.
 * @returns {DecisionTree}
 */
export function buildContentExtractorTree() {
  // ─── Leaf Nodes ───
  const leafHighContent = new DecisionTreeNode({
    value: 'MAIN_CONTENT',
    confidence: 0.98,
    label: 'High Confidence Main Content Body',
    metadata: { scoreWeight: 1.0 }
  });

  const leafSemanticContent = new DecisionTreeNode({
    value: 'MAIN_CONTENT',
    confidence: 0.96,
    label: 'Semantic Role / Schema.org Annotated Content',
    metadata: { scoreWeight: 0.97 }
  });

  const leafArticleTag = new DecisionTreeNode({
    value: 'MAIN_CONTENT',
    confidence: 0.95,
    label: 'Semantic <article> / <main> Content Container',
    metadata: { scoreWeight: 0.95 }
  });

  const leafStructuredArticle = new DecisionTreeNode({
    value: 'MAIN_CONTENT',
    confidence: 0.93,
    label: 'Well-Structured Article (Headings + Paragraphs)',
    metadata: { scoreWeight: 0.93 }
  });

  const leafParagraphCluster = new DecisionTreeNode({
    value: 'MAIN_CONTENT',
    confidence: 0.88,
    label: 'Dense Paragraph Text Cluster',
    metadata: { scoreWeight: 0.88 }
  });

  const leafRichFormatted = new DecisionTreeNode({
    value: 'MAIN_CONTENT',
    confidence: 0.86,
    label: 'Rich Formatted Content (em/strong/code emphasis)',
    metadata: { scoreWeight: 0.86 }
  });

  const leafTableContent = new DecisionTreeNode({
    value: 'DATA_CONTENT',
    confidence: 0.85,
    label: 'Structured Data Table Content',
    metadata: { scoreWeight: 0.80 }
  });

  const leafImageGallery = new DecisionTreeNode({
    value: 'MEDIA_CONTENT',
    confidence: 0.80,
    label: 'Image Gallery / Media-Heavy Block',
    metadata: { scoreWeight: 0.70 }
  });

  const leafGenericDiv = new DecisionTreeNode({
    value: 'POSSIBLE_CONTENT',
    confidence: 0.60,
    label: 'Generic Block with Moderate Content',
    metadata: { scoreWeight: 0.60 }
  });

  const leafListIndex = new DecisionTreeNode({
    value: 'INDEX_CONTENT',
    confidence: 0.70,
    label: 'List-Heavy Index / Directory Block',
    metadata: { scoreWeight: 0.50 }
  });

  const leafFormBlock = new DecisionTreeNode({
    value: 'INTERACTIVE',
    confidence: 0.75,
    label: 'Interactive Form / Input Block',
    metadata: { scoreWeight: 0.25 }
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

  // ─── Branch Nodes (Bottom up) ───

  // Rich formatting check (deep)
  const nodeRichFormatting = new DecisionTreeNode({
    feature: 'hasRichFormatting',
    operator: '==',
    threshold: true,
    left: leafRichFormatted,
    right: leafGenericDiv
  });

  // Paragraph density check
  const nodeParagraphCluster = new DecisionTreeNode({
    feature: 'pTagCount',
    operator: '>=',
    threshold: 3,
    left: leafParagraphCluster,
    right: nodeRichFormatting
  });

  // Structured headings + paragraphs = article-quality content
  const nodeStructuredArticle = new DecisionTreeNode({
    feature: 'hasStructuredHeadings',
    operator: '==',
    threshold: true,
    left: leafStructuredArticle,
    right: nodeParagraphCluster
  });

  // Table content detection
  const nodeTableContent = new DecisionTreeNode({
    feature: 'isTableContent',
    operator: '==',
    threshold: true,
    left: leafTableContent,
    right: nodeStructuredArticle
  });

  // Image gallery detection (high img:word ratio)
  const nodeImageGallery = new DecisionTreeNode({
    feature: 'imgToWordRatio',
    operator: '>',
    threshold: 15,
    left: leafImageGallery,
    right: nodeTableContent
  });

  // Article / main tag check
  const nodeArticleTag = new DecisionTreeNode({
    feature: 'tagName',
    operator: 'in',
    threshold: ['article', 'main'],
    left: leafArticleTag,
    right: nodeImageGallery
  });

  // Semantic role / schema.org check
  const nodeSemanticRole = new DecisionTreeNode({
    feature: 'hasSemanticRole',
    operator: '==',
    threshold: true,
    left: leafSemanticContent,
    right: new DecisionTreeNode({
      feature: 'hasItemProp',
      operator: '==',
      threshold: true,
      left: leafSemanticContent,
      right: nodeArticleTag
    })
  });

  // Positive class/id tokens check
  const nodePositiveTokens = new DecisionTreeNode({
    feature: 'positiveTokenCount',
    operator: '>=',
    threshold: 1,
    left: leafHighContent,
    right: nodeSemanticRole
  });

  // Form-heavy block detection
  const nodeFormBlock = new DecisionTreeNode({
    feature: 'isFormHeavy',
    operator: '==',
    threshold: true,
    left: leafFormBlock,
    right: nodePositiveTokens
  });

  // List-heavy index detection
  const nodeListHeavy = new DecisionTreeNode({
    feature: 'isListHeavy',
    operator: '==',
    threshold: true,
    left: leafListIndex,
    right: nodeFormBlock
  });

  // Link density check
  const nodeLinkDensity = new DecisionTreeNode({
    feature: 'linkDensity',
    operator: '>',
    threshold: 0.45,
    left: leafBoilerplateHighLinks,
    right: nodeListHeavy
  });

  // Negative class/id tokens check
  const nodeNegativeTokens = new DecisionTreeNode({
    feature: 'negativeTokenCount',
    operator: '>=',
    threshold: 2,
    left: leafBoilerplateNoiseTokens,
    right: nodeLinkDensity
  });

  // Root: filter out tiny/empty elements first
  const rootNode = new DecisionTreeNode({
    feature: 'textLength',
    operator: '<',
    threshold: 80,
    left: leafEmptyNoise,
    right: nodeNegativeTokens
  });

  return new DecisionTree(rootNode, 'DOMContentExtractorTree_v2');
}

export const globalContentExtractorTree = buildContentExtractorTree();

// ──────────────────────────────────────────
// Composite Scoring
// ──────────────────────────────────────────

/**
 * Evaluates candidate element and returns classification and content score.
 * Enhanced with multi-signal fusion scoring.
 * @param {object} $ 
 * @param {object} elem 
 * @returns {{ classification: string, score: number, confidence: number, explanation: object, features: object }}
 */
export function scoreContentElement($, elem) {
  const features = extractContentFeatures($, elem);
  const explanation = globalContentExtractorTree.explain(features);

  // ─── Multi-Signal Composite Score ───
  const baseWeight = explanation.leaf?.metadata?.scoreWeight || 0.5;
  
  // Length contribution (logarithmic scale, caps at 1.2)
  const lengthBonus = Math.min(Math.log10(Math.max(features.textLength, 10)) / 4, 1.2);
  
  // Paragraph density bonus
  const paragraphBonus = features.pTagCount >= 3 ? 0.08 : 0;
  
  // Heading structure bonus
  const headingBonus = features.hasStructuredHeadings ? 0.06 : 0;
  
  // Sentence depth bonus (longer, more complex content)
  const sentenceBonus = features.sentenceCount >= 5 ? 0.05 : 0;
  
  // Rich formatting bonus
  const formattingBonus = features.hasRichFormatting ? 0.04 : 0;
  
  // Semantic markup bonus
  const semanticBonus = (features.hasSemanticRole || features.hasItemProp || features.hasDataContent) ? 0.07 : 0;
  
  // Link density penalty (high link density = navigation, not content)
  const linkPenalty = features.linkDensity > 0.3 ? -0.15 * features.linkDensity : 0;
  
  // Negative token penalty
  const negativePenalty = features.negativeTokenCount > 0 ? -0.05 * features.negativeTokenCount : 0;

  const compositeScore = parseFloat(
    Math.max(0, Math.min(1.5,
      baseWeight * lengthBonus + paragraphBonus + headingBonus + sentenceBonus +
      formattingBonus + semanticBonus + linkPenalty + negativePenalty
    )).toFixed(3)
  );

  return {
    classification: explanation.value,
    score: compositeScore,
    confidence: explanation.confidence,
    label: explanation.label,
    path: explanation.path,
    depth: explanation.depth,
    leaf: explanation.leaf,
    features
  };
}

/**
 * Scores all candidate elements and returns them sorted by score (descending).
 * @param {object} $ - Cheerio instance
 * @param {string} [selector='article, main, section, div, [role="main"]'] - CSS selector
 * @param {number} [topK=5] - Maximum results to return
 * @returns {Array<{ element: object, classification: string, score: number, confidence: number, label: string }>}
 */
export function rankContentCandidates($, selector = 'article, main, section, div, [role="main"]', topK = 5) {
  const candidates = [];

  $(selector).each((_, elem) => {
    const result = scoreContentElement($, elem);
    if (result.classification !== 'NOISE' && result.score > 0.1) {
      candidates.push({
        element: elem,
        tagName: result.features.tagName,
        classAndId: `${$(elem).attr('class') || ''} ${$(elem).attr('id') || ''}`.trim(),
        classification: result.classification,
        score: result.score,
        confidence: result.confidence,
        label: result.label,
        textLength: result.features.textLength,
        wordCount: result.features.wordCount
      });
    }
  });

  // Sort by score descending, then by text length as tiebreaker
  candidates.sort((a, b) => b.score - a.score || b.textLength - a.textLength);

  return candidates.slice(0, topK);
}
