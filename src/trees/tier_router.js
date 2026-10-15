import { DecisionTreeNode, DecisionTree } from './engine.js';

/**
 * Extracts decision tree features from a response probe or initial HTML.
 * @param {object} probe 
 * @param {number} [probe.status]
 * @param {string} [probe.html]
 * @param {object} [probe.headers]
 * @returns {object} Feature dictionary
 */
export function extractTierProbeFeatures(probe = {}) {
  const status = probe.status !== undefined ? parseInt(probe.status, 10) : 200;
  const html = probe.html || probe.rawHtml || '';
  const bodyLength = html.length;

  const lowerHtml = html.toLowerCase();

  // Cloudflare & Bot Challenge Detection
  const hasCloudflareChallenge = 
    lowerHtml.includes('just a moment...') ||
    lowerHtml.includes('cf-browser-verification') ||
    lowerHtml.includes('checking your browser') ||
    lowerHtml.includes('turnstile') ||
    lowerHtml.includes('ddos-guard') ||
    lowerHtml.includes('challenge-running') ||
    lowerHtml.includes('cf-turnstile-input');

  // SPA Container Shell Detection (React, Next.js, Vue, Angular)
  const hasAppShell = 
    /<div\s+id=["'](root|app|__next)["']\s*>\s*<\/div>/i.test(html) ||
    /<div\s+id=["'](root|app|__next)["']\s*>\s*<!--/i.test(html) ||
    /<app-root\b[^>]*>\s*<\/app-root>/i.test(html);

  // Noscript requirement indicator
  const hasNoscript = lowerHtml.includes('<noscript');

  // Script tags vs Text length
  const scriptMatches = html.match(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi) || [];
  const totalScriptLength = scriptMatches.reduce((acc, s) => acc + s.length, 0);
  
  // Approximate inner text
  const cleanText = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .trim();
  const textLength = cleanText.length;
  const wordCount = cleanText.split(/\s+/).filter(Boolean).length;

  const scriptToTextRatio = textLength > 0 ? parseFloat((totalScriptLength / textLength).toFixed(2)) : 5.0;

  return {
    statusCode: status,
    bodyLength,
    hasCloudflareChallenge,
    hasAppShell,
    hasNoscript,
    scriptToTextRatio,
    textLength,
    wordCount
  };
}

/**
 * Builds the Autonomous Tier Router Decision Tree.
 * @returns {DecisionTree}
 */
export function buildTierRouterTree() {
  // Leaf Nodes
  const leafStealthCloudflare = new DecisionTreeNode({
    value: 'stealth',
    confidence: 0.99,
    label: 'Cloudflare / Turnstile Anti-Bot Challenge Detected'
  });

  const leafStealthBlock = new DecisionTreeNode({
    value: 'stealth',
    confidence: 0.95,
    label: 'Access Blocked (HTTP 403 / 429 / 503 Anti-Bot Rate Limit)'
  });

  const leafDynamicEmptySpa = new DecisionTreeNode({
    value: 'dynamic',
    confidence: 0.96,
    label: 'Empty Client-Side SPA Shell (React/Vue/Next.js Requires JavaScript)'
  });

  const leafStaticPreRendered = new DecisionTreeNode({
    value: 'static',
    confidence: 0.88,
    label: 'Server-Side Pre-Rendered Application Container'
  });

  const leafDynamicNoscript = new DecisionTreeNode({
    value: 'dynamic',
    confidence: 0.92,
    label: 'Short Document with <noscript> Requirement'
  });

  const leafDynamicEmptyDoc = new DecisionTreeNode({
    value: 'dynamic',
    confidence: 0.85,
    label: 'Suspiciously Low Content Document (Probable Async Loader)'
  });

  const leafStaticLightweight = new DecisionTreeNode({
    value: 'static',
    confidence: 0.92,
    label: 'Lightweight Static Document'
  });

  const leafDynamicScriptHeavy = new DecisionTreeNode({
    value: 'dynamic',
    confidence: 0.82,
    label: 'Script-Heavy Single Page App'
  });

  const leafStaticStandard = new DecisionTreeNode({
    value: 'static',
    confidence: 0.98,
    label: 'Standard Static Content Document'
  });

  // Branch Nodes (Bottom up)
  const nodeScriptRatio = new DecisionTreeNode({
    feature: 'scriptToTextRatio',
    operator: '>',
    threshold: 4.0,
    left: leafDynamicScriptHeavy,
    right: leafStaticStandard
  });

  const nodeEmptyDoc = new DecisionTreeNode({
    feature: 'wordCount',
    operator: '<',
    threshold: 25,
    left: leafDynamicEmptyDoc,
    right: leafStaticLightweight
  });

  const nodeNoscript = new DecisionTreeNode({
    feature: 'hasNoscript',
    operator: '==',
    threshold: true,
    left: leafDynamicNoscript,
    right: nodeEmptyDoc
  });

  const nodeShortBody = new DecisionTreeNode({
    feature: 'bodyLength',
    operator: '<',
    threshold: 2500,
    left: nodeNoscript,
    right: nodeScriptRatio
  });

  const nodeAppShell = new DecisionTreeNode({
    feature: 'hasAppShell',
    operator: '==',
    threshold: true,
    left: new DecisionTreeNode({
      feature: 'wordCount',
      operator: '<',
      threshold: 60,
      left: leafDynamicEmptySpa,
      right: leafStaticPreRendered
    }),
    right: nodeShortBody
  });

  const nodeBlockStatus = new DecisionTreeNode({
    feature: 'statusCode',
    operator: 'in',
    threshold: [403, 429, 503],
    left: leafStealthBlock,
    right: nodeAppShell
  });

  const rootNode = new DecisionTreeNode({
    feature: 'hasCloudflareChallenge',
    operator: '==',
    threshold: true,
    left: leafStealthCloudflare,
    right: nodeBlockStatus
  });

  return new DecisionTree(rootNode, 'AutonomousTierRouterTree');
}

export const globalTierRouterTree = buildTierRouterTree();

/**
 * Evaluates probe data and returns optimal fetcher tier recommendation.
 * @param {object} probe - Probe HTML, status, headers
 * @returns {{ tier: 'static'|'dynamic'|'stealth', confidence: number, label: string, path: string[], features: object }}
 */
export function routeTier(probe) {
  const features = extractTierProbeFeatures(probe);
  const explanation = globalTierRouterTree.explain(features);
  return {
    tier: explanation.value || 'static',
    confidence: explanation.confidence,
    label: explanation.label,
    path: explanation.path,
    features
  };
}
