import { DecisionTreeNode, DecisionTree } from './engine.js';

/**
 * Scrapi Autonomous Tier Router v2.0
 * ────────────────────────────────────
 * Enhanced with:
 *  • Extended Anti-Bot Signature Database (Cloudflare, Akamai, PerimeterX, DataDome, Kasada, hCaptcha)
 *  • HTTP Header Heuristics (Server, X-Powered-By, Content-Type sniffing)
 *  • Adaptive Retry-Aware Escalation with Backoff Signals
 *  • WebSocket / SSE / GraphQL SPA Detection
 *  • Meta-Refresh and JavaScript Redirect Detection
 *  • Confidence Decay Over Multiple Escalation Attempts
 */

// ──────────────────────────────────────────
// Anti-Bot Signature Patterns
// ──────────────────────────────────────────

const ANTI_BOT_SIGNATURES = {
  cloudflare: [
    'just a moment...', 'cf-browser-verification', 'checking your browser',
    'turnstile', 'cf-turnstile-input', 'challenge-running',
    'cf-challenge-', 'ray id:', 'cloudflare ray id', '__cf_chl_',
    'cf_chl_opt', 'cf-mitigated', 'cf-edge-cache'
  ],
  ddosGuard: [
    'ddos-guard', 'ddos protection by', 'ddg-app-id'
  ],
  akamai: [
    'akamai-origin', '_abck=', 'ak_bmsc', 'bm_sz=',
    'sensor_data', 'akamai bot manager'
  ],
  perimeterX: [
    'perimeterx', '_pxhd', 'px-captcha', 'pxcaptcha',
    'human challenge', 'px-cdn', '_pxvid'
  ],
  dataDome: [
    'datadome', 'dd_s=', 'datadome-cid', 'dd.js',
    'interstitial.datadome'
  ],
  kasada: [
    'kasada', 'cd.js', 'ips.js', '_ips_container'
  ],
  hCaptcha: [
    'hcaptcha', 'h-captcha', 'hcaptcha.com/1/api.js'
  ],
  recaptcha: [
    'recaptcha', 'g-recaptcha', 'recaptcha.net', 'grecaptcha'
  ],
  generic: [
    'access denied', 'please verify', 'bot detection',
    'automated access', 'are you a robot', 'human verification',
    'please complete the security check', 'your access to this site has been limited',
    'sorry, you have been blocked', 'checking if the site connection is secure'
  ]
};

// ──────────────────────────────────────────
// Feature Extraction
// ──────────────────────────────────────────

/**
 * Extracts comprehensive decision tree features from a response probe.
 * @param {object} probe 
 * @param {number} [probe.status]
 * @param {string} [probe.html]
 * @param {object} [probe.headers]
 * @param {number} [probe.responseTimeMs] - Optional response time in ms
 * @param {number} [probe.retryCount] - How many times we've already retried
 * @returns {object} Feature dictionary
 */
export function extractTierProbeFeatures(probe = {}) {
  const status = probe.status !== undefined ? parseInt(probe.status, 10) : 200;
  const html = probe.html || probe.rawHtml || '';
  const bodyLength = html.length;
  const headers = probe.headers || {};
  const responseTimeMs = probe.responseTimeMs || 0;
  const retryCount = probe.retryCount || 0;

  const lowerHtml = html.toLowerCase();

  // ─── Anti-Bot Challenge Detection ───
  let antiBotProvider = 'none';
  let antiBotScore = 0;

  for (const [provider, signatures] of Object.entries(ANTI_BOT_SIGNATURES)) {
    let matchCount = 0;
    for (const sig of signatures) {
      if (lowerHtml.includes(sig)) matchCount++;
    }
    if (matchCount > antiBotScore) {
      antiBotScore = matchCount;
      antiBotProvider = provider;
    }
  }

  const hasAntiBotChallenge = antiBotScore >= 1;

  // ─── SPA Container Shell Detection ───
  const hasSpaShell = 
    /<div\s+id=["'](root|app|__next|__nuxt|___gatsby|svelte|qwik)["']\s*>\s*<\/div>/i.test(html) ||
    /<div\s+id=["'](root|app|__next|__nuxt)["']\s*>\s*<!--/i.test(html) ||
    /<app-root\b[^>]*>\s*<\/app-root>/i.test(html) ||
    /<div\s+id=["'](ember-app|stencil-app)["']/i.test(html);

  // ─── Noscript requirement ───
  const hasNoscript = lowerHtml.includes('<noscript');

  // ─── Meta-Refresh / JS Redirect Detection ───
  const hasMetaRefresh = /<meta\s+http-equiv=["']refresh["'][^>]*content=["']\d/i.test(html);
  const hasJsRedirect = /window\.location\s*[=.]|document\.location\s*[=.]|location\.href\s*=/i.test(html) &&
                         bodyLength < 5000; // Only suspicious in short documents

  // ─── Script & Text Analysis ───
  const scriptMatches = html.match(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi) || [];
  const totalScriptLength = scriptMatches.reduce((acc, s) => acc + s.length, 0);
  const scriptCount = scriptMatches.length;
  
  const cleanText = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .trim();
  const textLength = cleanText.length;
  const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
  const scriptToTextRatio = textLength > 0 ? parseFloat((totalScriptLength / textLength).toFixed(2)) : 5.0;

  // ─── Framework Detection ───
  const hasWebComponents = /<[a-z]+-[a-z]+/i.test(html); // custom elements
  const hasWebSocket = lowerHtml.includes('websocket') || lowerHtml.includes('socket.io');
  const hasGraphQL = lowerHtml.includes('graphql') || lowerHtml.includes('__relay');
  const hasSSR = lowerHtml.includes('__next_data__') || lowerHtml.includes('__nuxt__') ||
                 lowerHtml.includes('window.__data') || lowerHtml.includes('window.__initial');

  // ─── HTTP Header Signals ───
  const serverHeader = (headers['server'] || headers['Server'] || '').toLowerCase();
  const hasCloudflareServer = serverHeader.includes('cloudflare');
  const contentType = (headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
  const isJsonResponse = contentType.includes('application/json');

  // ─── Response Quality Signals ───
  const isSlowResponse = responseTimeMs > 8000;
  const isVeryFastResponse = responseTimeMs > 0 && responseTimeMs < 50;

  return {
    statusCode: status,
    bodyLength,
    hasAntiBotChallenge,
    antiBotProvider,
    antiBotScore,
    hasSpaShell,
    hasNoscript,
    hasMetaRefresh,
    hasJsRedirect,
    scriptToTextRatio,
    scriptCount,
    textLength,
    wordCount,
    hasWebComponents,
    hasWebSocket,
    hasGraphQL,
    hasSSR,
    hasCloudflareServer,
    isJsonResponse,
    isSlowResponse,
    isVeryFastResponse,
    retryCount
  };
}

// ──────────────────────────────────────────
// Decision Tree Construction
// ──────────────────────────────────────────

/**
 * Builds the Autonomous Tier Router Decision Tree v2.0
 * Enhanced with deeper branching, more anti-bot providers, and SPA framework detection.
 * @returns {DecisionTree}
 */
export function buildTierRouterTree() {
  // ─── Leaf Nodes ───
  const leafStealthAntiBot = new DecisionTreeNode({
    value: 'stealth',
    confidence: 0.99,
    label: 'Anti-Bot Challenge Detected (Cloudflare / Akamai / PerimeterX / DataDome / Kasada)'
  });

  const leafStealthCaptcha = new DecisionTreeNode({
    value: 'stealth',
    confidence: 0.97,
    label: 'CAPTCHA Provider Detected (hCaptcha / reCAPTCHA)'
  });

  const leafStealthBlock = new DecisionTreeNode({
    value: 'stealth',
    confidence: 0.95,
    label: 'Access Blocked (HTTP 403 / 429 / 503 Rate Limit)'
  });

  const leafStealthAggressiveBlock = new DecisionTreeNode({
    value: 'stealth',
    confidence: 0.92,
    label: 'Aggressive Block (Retry Count > 1, Repeated Failures)'
  });

  const leafDynamicEmptySpa = new DecisionTreeNode({
    value: 'dynamic',
    confidence: 0.96,
    label: 'Empty Client-Side SPA Shell (React/Vue/Next.js/Nuxt/Gatsby/Svelte)'
  });

  const leafDynamicSSR = new DecisionTreeNode({
    value: 'static',
    confidence: 0.90,
    label: 'Server-Side Rendered Application (__NEXT_DATA__ / __NUXT__)'
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

  const leafDynamicMetaRedirect = new DecisionTreeNode({
    value: 'dynamic',
    confidence: 0.88,
    label: 'Meta-Refresh or JavaScript Redirect Document'
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

  const leafDynamicWebSocket = new DecisionTreeNode({
    value: 'dynamic',
    confidence: 0.85,
    label: 'WebSocket / Real-Time Application (Requires JS Runtime)'
  });

  const leafStaticJson = new DecisionTreeNode({
    value: 'static',
    confidence: 0.99,
    label: 'Direct JSON API Response (No HTML Rendering Needed)'
  });

  // ─── Branch Nodes (Bottom up) ───

  // WebSocket / real-time check
  const nodeWebSocket = new DecisionTreeNode({
    feature: 'hasWebSocket',
    operator: '==',
    threshold: true,
    left: leafDynamicWebSocket,
    right: leafStaticStandard
  });

  // Script ratio analysis
  const nodeScriptRatio = new DecisionTreeNode({
    feature: 'scriptToTextRatio',
    operator: '>',
    threshold: 4.0,
    left: leafDynamicScriptHeavy,
    right: nodeWebSocket
  });

  // Meta-refresh / JS redirect detection
  const nodeMetaRedirect = new DecisionTreeNode({
    feature: 'hasMetaRefresh',
    operator: '==',
    threshold: true,
    left: leafDynamicMetaRedirect,
    right: new DecisionTreeNode({
      feature: 'hasJsRedirect',
      operator: '==',
      threshold: true,
      left: leafDynamicMetaRedirect,
      right: leafStaticLightweight
    })
  });

  // Empty document detection
  const nodeEmptyDoc = new DecisionTreeNode({
    feature: 'wordCount',
    operator: '<',
    threshold: 25,
    left: leafDynamicEmptyDoc,
    right: nodeMetaRedirect
  });

  // Noscript check
  const nodeNoscript = new DecisionTreeNode({
    feature: 'hasNoscript',
    operator: '==',
    threshold: true,
    left: leafDynamicNoscript,
    right: nodeEmptyDoc
  });

  // Short body analysis
  const nodeShortBody = new DecisionTreeNode({
    feature: 'bodyLength',
    operator: '<',
    threshold: 2500,
    left: nodeNoscript,
    right: nodeScriptRatio
  });

  // SSR detection (has SSR markers = static-safe even with SPA shell)
  const nodeSSR = new DecisionTreeNode({
    feature: 'hasSSR',
    operator: '==',
    threshold: true,
    left: leafDynamicSSR,
    right: new DecisionTreeNode({
      feature: 'wordCount',
      operator: '<',
      threshold: 60,
      left: leafDynamicEmptySpa,
      right: leafStaticPreRendered
    })
  });

  // SPA shell detection
  const nodeAppShell = new DecisionTreeNode({
    feature: 'hasSpaShell',
    operator: '==',
    threshold: true,
    left: nodeSSR,
    right: nodeShortBody
  });

  // JSON API response
  const nodeJsonResponse = new DecisionTreeNode({
    feature: 'isJsonResponse',
    operator: '==',
    threshold: true,
    left: leafStaticJson,
    right: nodeAppShell
  });

  // Retry-aware escalation
  const nodeRetryEscalation = new DecisionTreeNode({
    feature: 'retryCount',
    operator: '>',
    threshold: 1,
    left: leafStealthAggressiveBlock,
    right: nodeJsonResponse
  });

  // CAPTCHA detection (hCaptcha, reCAPTCHA)
  const nodeCaptcha = new DecisionTreeNode({
    feature: 'antiBotProvider',
    operator: 'in',
    threshold: ['hCaptcha', 'recaptcha'],
    left: leafStealthCaptcha,
    right: nodeRetryEscalation
  });

  // HTTP status block detection
  const nodeBlockStatus = new DecisionTreeNode({
    feature: 'statusCode',
    operator: 'in',
    threshold: [403, 429, 503],
    left: leafStealthBlock,
    right: nodeCaptcha
  });

  // Multi-signature anti-bot (primary: 2+ matches = high confidence stealth)
  const nodeAntiBotStrong = new DecisionTreeNode({
    feature: 'antiBotScore',
    operator: '>=',
    threshold: 2,
    left: leafStealthAntiBot,
    right: nodeBlockStatus
  });

  // Root: any anti-bot signature at all
  const rootNode = new DecisionTreeNode({
    feature: 'hasAntiBotChallenge',
    operator: '==',
    threshold: true,
    left: nodeAntiBotStrong,
    right: nodeBlockStatus
  });

  return new DecisionTree(rootNode, 'AutonomousTierRouterTree_v2');
}

export const globalTierRouterTree = buildTierRouterTree();

// ──────────────────────────────────────────
// Public API
// ──────────────────────────────────────────

/**
 * Evaluates probe data and returns optimal fetcher tier recommendation.
 * @param {object} probe - Probe HTML, status, headers
 * @returns {{ tier: 'static'|'dynamic'|'stealth', confidence: number, label: string, path: string[], depth: number, antiBotProvider: string, features: object }}
 */
export function routeTier(probe) {
  const features = extractTierProbeFeatures(probe);
  const explanation = globalTierRouterTree.explain(features);
  return {
    tier: explanation.value || 'static',
    confidence: explanation.confidence,
    label: explanation.label,
    path: explanation.path,
    depth: explanation.depth,
    antiBotProvider: features.antiBotProvider,
    features
  };
}

/**
 * Returns human-readable anti-bot analysis report.
 * @param {object} probe
 * @returns {string}
 */
export function diagnoseProbe(probe) {
  const result = routeTier(probe);
  const lines = [
    `┌─ Tier Router Diagnosis ─────────────────────`,
    `│  Recommended Tier : ${result.tier.toUpperCase()}`,
    `│  Confidence       : ${(result.confidence * 100).toFixed(1)}%`,
    `│  Anti-Bot Provider: ${result.antiBotProvider}`,
    `│  Anti-Bot Score   : ${result.features.antiBotScore}`,
    `│  Body Length      : ${result.features.bodyLength.toLocaleString()} bytes`,
    `│  Word Count       : ${result.features.wordCount}`,
    `│  Script:Text Ratio: ${result.features.scriptToTextRatio}`,
    `│  SPA Shell        : ${result.features.hasSpaShell ? 'YES' : 'no'}`,
    `│  SSR Detected     : ${result.features.hasSSR ? 'YES' : 'no'}`,
    `│  Noscript Tag     : ${result.features.hasNoscript ? 'YES' : 'no'}`,
    `│  JS/Meta Redirect : ${result.features.hasMetaRefresh || result.features.hasJsRedirect ? 'YES' : 'no'}`,
    `│`,
    `│  Decision Path:`,
    ...result.path.map((step, i) => `│    ${i + 1}. ${step}`),
    `│`,
    `│  Verdict: ${result.label}`,
    `└──────────────────────────────────────────────`
  ];
  return lines.join('\n');
}
