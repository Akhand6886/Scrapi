import { BaseFetcher } from './base.js';
import { StaticFetcher } from './static.js';
import { DynamicFetcher, closeSharedBrowser } from './dynamic.js';
import { StealthyFetcher } from './stealth.js';
import { routeTier } from '../trees/tier_router.js';

export { BaseFetcher, StaticFetcher, DynamicFetcher, StealthyFetcher };

/**
 * FetcherPool manages fetcher instances and supports auto-escalation (Static -> Dynamic -> Stealth)
 * powered by the Autonomous Decision Tree Router.
 */
export class FetcherPool {
  constructor(options = {}) {
    this.options = options;
    this.staticFetcher = new StaticFetcher(options);
    this.dynamicFetcher = null;
    this.stealthFetcher = null;
  }

  getDynamicFetcher() {
    if (!this.dynamicFetcher) {
      this.dynamicFetcher = new DynamicFetcher(this.options);
    }
    return this.dynamicFetcher;
  }

  getStealthFetcher() {
    if (!this.stealthFetcher) {
      this.stealthFetcher = new StealthyFetcher(this.options);
    }
    return this.stealthFetcher;
  }

  async close() {
    await closeSharedBrowser();
  }

  /**
   * Fetches using specified type or auto-escalates if blocked.
   * @param {string} url 
   * @param {object} options 
   * @returns {Promise<import('../parser/adaptor.js').Response>}
   */
  async fetch(url, options = {}) {
    const fetcherType = (options.fetcher || this.options.fetcher || 'static').toLowerCase();

    if (fetcherType === 'dynamic') {
      return this.getDynamicFetcher().fetch(url, options);
    }

    if (fetcherType === 'stealth') {
      return this.getStealthFetcher().fetch(url, options);
    }

    if (fetcherType === 'auto') {
      let probe;
      try {
        probe = await this.staticFetcher.fetch(url, options);
      } catch (err) {
        probe = { status: 500, rawHtml: err.message || '' };
      }

      const decision = routeTier(probe);

      if (decision.tier === 'stealth') {
        if (!options.silent) {
          console.log(`🌳 [Decision Tree] Route: STEALTH (${Math.round(decision.confidence * 100)}% Conf) ➔ ${decision.label}`);
        }
        const resp = await this.getStealthFetcher().fetch(url, options);
        resp.decisionTree = decision;
        return resp;
      }

      if (decision.tier === 'dynamic') {
        if (!options.silent) {
          console.log(`🌳 [Decision Tree] Route: DYNAMIC (${Math.round(decision.confidence * 100)}% Conf) ➔ ${decision.label}`);
        }
        const resp = await this.getDynamicFetcher().fetch(url, options);
        resp.decisionTree = decision;
        return resp;
      }

      // Static tier selected
      if (probe && probe.status >= 200 && probe.status < 400 && probe.rawHtml) {
        probe.decisionTree = decision;
        return probe;
      } else {
        const resp = await this.getDynamicFetcher().fetch(url, options);
        resp.decisionTree = decision;
        return resp;
      }
    }

    // Default static
    try {
      const res = await this.staticFetcher.fetch(url, options);

      // Auto-escalation check: If Cloudflare block or empty JS SPA container is detected and autoEscalate is on
      if (options.autoEscalate && (res.status === 403 || res.status === 503 || res.rawHtml.includes('cf-browser-verification') || res.rawHtml.includes('Just a moment...'))) {
        console.warn(`⚡ Auto-escalating to StealthyFetcher for ${url}...`);
        return this.getStealthFetcher().fetch(url, options);
      }

      return res;
    } catch (err) {
      if (options.autoEscalate) {
        console.warn(`⚠️ Static fetch failed (${err.message}). Escalating to DynamicFetcher for ${url}...`);
        return this.getDynamicFetcher().fetch(url, options);
      }
      throw err;
    }
  }
}

// Global default pool
export const globalFetcherPool = new FetcherPool();

/**
 * Convenience helper to fetch a URL using Scrapi's fetcher subsystem.
 */
export async function fetch(url, options = {}) {
  return globalFetcherPool.fetch(url, options);
}

/**
 * Fetch using DynamicFetcher (Playwright).
 */
export async function fetchDynamic(url, options = {}) {
  return globalFetcherPool.getDynamicFetcher().fetch(url, options);
}

/**
 * Fetch using StealthyFetcher (Anti-bot).
 */
export async function fetchStealth(url, options = {}) {
  return globalFetcherPool.getStealthFetcher().fetch(url, options);
}

/**
 * Cleanly close all shared browser instances.
 */
export async function closeAllFetchers() {
  await globalFetcherPool.close();
}
