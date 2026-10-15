/**
 * Online Reinforcement Learning Subsystem: Bayesian Multi-Armed Bandit
 * ───────────────────────────────────────────────────────────────────
 * Implements Thompson Sampling over conjugate Beta-Bernoulli distributions
 * to autonomously learn per-domain bot defenses and optimal fetcher tiers.
 *
 * Eliminates redundant static HTTP probe latency on domains with high-probability
 * Cloudflare / WAF defenses, cutting round-trip time in half on protected targets.
 */

// ──────────────────────────────────────────
// Gamma & Beta Random Variable Generation
// ──────────────────────────────────────────

/**
 * Generates a standard normal random variable using Box-Muller transform.
 * @returns {number}
 */
function randomNormal() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Samples a Gamma(alpha, 1) random variate via Marsaglia & Tsang's method (2000).
 * @param {number} alpha - Shape parameter (alpha > 0)
 * @returns {number}
 */
export function sampleGamma(alpha) {
  if (alpha < 1) {
    // Boost via Weibull-like property: Gamma(a) = Gamma(a+1) * U^(1/a)
    return sampleGamma(alpha + 1) * Math.pow(Math.random(), 1.0 / alpha);
  }

  const d = alpha - 1.0 / 3.0;
  const c = 1.0 / Math.sqrt(9.0 * d);

  while (true) {
    let z = randomNormal();
    let v = 1.0 + c * z;
    if (v <= 0) continue;

    v = v * v * v;
    const u = Math.random();

    // Squeeze test
    if (u < 1.0 - 0.0331 * z * z * z * z) {
      return d * v;
    }

    if (Math.log(u) < 0.5 * z * z + d * (1.0 - v + Math.log(v))) {
      return d * v;
    }
  }
}

/**
 * Samples from a Beta(alpha, beta) distribution.
 * @param {number} alpha - Pseudo-success count (> 0)
 * @param {number} beta - Pseudo-failure count (> 0)
 * @returns {number} Sample in (0, 1)
 */
export function sampleBeta(alpha, beta) {
  const gA = sampleGamma(Math.max(0.01, alpha));
  const gB = sampleGamma(Math.max(0.01, beta));
  const sum = gA + gB;
  if (sum === 0) return 0.5;
  return gA / sum;
}

// ──────────────────────────────────────────
// Thompson Sampling Multi-Armed Bandit
// ──────────────────────────────────────────

export const TIERS = ['static', 'dynamic', 'stealth'];

export class ThompsonSamplingBandit {
  /**
   * @param {object} [options]
   * @param {number} [options.priorAlpha=2.0] - Default optimistic prior successes
   * @param {number} [options.priorBeta=1.0] - Default optimistic prior failures
   * @param {number} [options.bypassThreshold=0.85] - Confidence threshold to bypass static probe
   * @param {number} [options.minObservations=3] - Minimum trials before enabling probe bypass
   * @param {object} [options.storage] - Optional storage adapter for persistence
   */
  constructor(options = {}) {
    this.priorAlpha = options.priorAlpha !== undefined ? options.priorAlpha : 2.0;
    this.priorBeta = options.priorBeta !== undefined ? options.priorBeta : 1.0;
    this.bypassThreshold = options.bypassThreshold || 0.85;
    this.minObservations = options.minObservations || 3;
    this.storage = options.storage || null;

    // domain -> { static: { alpha, beta }, dynamic: { alpha, beta }, stealth: { alpha, beta }, totalTrials: number }
    this.domains = new Map();
  }

  /**
   * Extracts hostname domain from a URL string.
   * @param {string} urlStr 
   * @returns {string} Clean hostname (e.g. "example.com")
   */
  normalizeDomain(urlStr) {
    try {
      if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
        urlStr = 'https://' + urlStr;
      }
      return new URL(urlStr).hostname.toLowerCase();
    } catch {
      return 'default';
    }
  }

  /**
   * Initializes or retrieves domain priors.
   * @param {string} domain 
   * @returns {Record<string, { alpha: number, beta: number }>}
   */
  getDomainPriors(domain) {
    const cleanDomain = this.normalizeDomain(domain);
    if (!this.domains.has(cleanDomain)) {
      // Check storage if available
      let stored = null;
      if (this.storage && typeof this.storage.getDomainBanditPrior === 'function') {
        try {
          stored = this.storage.getDomainBanditPrior(cleanDomain);
        } catch (e) {}
      }

      if (stored) {
        this.domains.set(cleanDomain, stored);
      } else {
        const priors = {
          totalTrials: 0,
          static: { alpha: this.priorAlpha, beta: this.priorBeta },
          dynamic: { alpha: this.priorAlpha, beta: this.priorBeta },
          stealth: { alpha: this.priorAlpha, beta: this.priorBeta }
        };
        this.domains.set(cleanDomain, priors);
      }
    }

    return this.domains.get(cleanDomain);
  }

  /**
   * Performs Thompson Sampling to select the optimal tier for a given domain.
   * @param {string} urlOrDomain 
   * @returns {{
   *   tier: 'static'|'dynamic'|'stealth',
   *   samples: Record<string, number>,
   *   shouldBypassProbe: boolean,
   *   reason: string
   * }}
   */
  selectTier(urlOrDomain) {
    const cleanDomain = this.normalizeDomain(urlOrDomain);
    const domainData = this.getDomainPriors(cleanDomain);

    const samples = {};
    for (const tier of TIERS) {
      const arm = domainData[tier];
      samples[tier] = parseFloat(sampleBeta(arm.alpha, arm.beta).toFixed(4));
    }

    // Arm with highest posterior sample
    let bestTier = 'static';
    let highestSample = -1;
    for (const tier of TIERS) {
      if (samples[tier] > highestSample) {
        highestSample = samples[tier];
        bestTier = tier;
      }
    }

    // Check if probe bypass is warranted
    const bypassCheck = this.shouldBypassProbe(cleanDomain);

    return {
      tier: bestTier,
      samples,
      shouldBypassProbe: bypassCheck.bypass,
      bypassTier: bypassCheck.tier,
      reason: bypassCheck.bypass
        ? `Bandit high-confidence defense detected: bypassing probe to directly launch ${bypassCheck.tier.toUpperCase()}`
        : `Thompson Sampling posterior winner: ${bestTier.toUpperCase()} (score: ${highestSample.toFixed(3)})`
    };
  }

  /**
   * Determines if a domain has enough historical evidence to skip the static probe roundtrip.
   * @param {string} domain 
   * @returns {{ bypass: boolean, tier: string|null, confidence: number }}
   */
  shouldBypassProbe(domain) {
    const cleanDomain = this.normalizeDomain(domain);
    const data = this.getDomainPriors(cleanDomain);

    if (data.totalTrials < this.minObservations) {
      return { bypass: false, tier: null, confidence: 0 };
    }

    // Calculate empirical success means: E[Beta(a, b)] = a / (a + b)
    const meanStealth = data.stealth.alpha / (data.stealth.alpha + data.stealth.beta);
    const meanStatic = data.static.alpha / (data.static.alpha + data.static.beta);
    const meanDynamic = data.dynamic.alpha / (data.dynamic.alpha + data.dynamic.beta);

    // If static consistently fails and stealth consistently succeeds -> Direct Stealth
    if (meanStealth >= this.bypassThreshold && meanStatic < 0.25) {
      return {
        bypass: true,
        tier: 'stealth',
        confidence: parseFloat(meanStealth.toFixed(3))
      };
    }

    // If dynamic consistently succeeds and static fails -> Direct Dynamic
    if (meanDynamic >= this.bypassThreshold && meanStatic < 0.25) {
      return {
        bypass: true,
        tier: 'dynamic',
        confidence: parseFloat(meanDynamic.toFixed(3))
      };
    }

    return { bypass: false, tier: null, confidence: 0 };
  }

  /**
   * Updates Bayesian posterior distributions based on scrape trial outcome.
   * @param {string} urlOrDomain 
   * @param {'static'|'dynamic'|'stealth'} tier - Arm executed
   * @param {boolean} success - True if request succeeded without bot challenge/unhydrated error
   * @param {object} [metadata] - Optional auxiliary details (status, latency)
   */
  recordReward(urlOrDomain, tier, success, metadata = {}) {
    if (!TIERS.includes(tier)) return;

    const cleanDomain = this.normalizeDomain(urlOrDomain);
    const domainData = this.getDomainPriors(cleanDomain);

    const arm = domainData[tier];
    if (success) {
      arm.alpha += 1.0;
    } else {
      arm.beta += 1.0;
    }
    domainData.totalTrials += 1;

    // Persist to storage if configured
    if (this.storage && typeof this.storage.saveDomainBanditPrior === 'function') {
      try {
        this.storage.saveDomainBanditPrior(cleanDomain, domainData);
      } catch (e) {}
    }
  }

  /**
   * Returns human-readable summary of domain bandit statistics.
   * @param {string} urlOrDomain 
   * @returns {object}
   */
  getDomainStats(urlOrDomain) {
    const cleanDomain = this.normalizeDomain(urlOrDomain);
    const data = this.getDomainPriors(cleanDomain);

    const formatArm = (arm) => ({
      alpha: parseFloat(arm.alpha.toFixed(2)),
      beta: parseFloat(arm.beta.toFixed(2)),
      expectedValue: parseFloat((arm.alpha / (arm.alpha + arm.beta)).toFixed(3))
    });

    return {
      domain: cleanDomain,
      totalTrials: data.totalTrials,
      arms: {
        static: formatArm(data.static),
        dynamic: formatArm(data.dynamic),
        stealth: formatArm(data.stealth)
      },
      bypass: this.shouldBypassProbe(cleanDomain)
    };
  }

  /**
   * Returns a table summary of all tracked domains.
   * @returns {Array<object>}
   */
  getAllStats() {
    const list = [];
    for (const [domain] of this.domains.entries()) {
      list.push(this.getDomainStats(domain));
    }
    return list;
  }

  /**
   * Serializes bandit state to JSON.
   */
  toJSON() {
    const out = {};
    for (const [domain, data] of this.domains.entries()) {
      out[domain] = data;
    }
    return out;
  }

  /**
   * Deserializes bandit state from JSON.
   */
  static fromJSON(json, options = {}) {
    const bandit = new ThompsonSamplingBandit(options);
    if (json && typeof json === 'object') {
      for (const [domain, data] of Object.entries(json)) {
        bandit.domains.set(domain, data);
      }
    }
    return bandit;
  }
}

// Global default singleton instance
export const globalBandit = new ThompsonSamplingBandit();
