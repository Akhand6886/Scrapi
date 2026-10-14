import { BaseFetcher } from './base.js';
import { StaticFetcher } from './static.js';
import { DynamicFetcher } from './dynamic.js';
import { StealthyFetcher } from './stealth.js';

export { BaseFetcher, StaticFetcher, DynamicFetcher, StealthyFetcher };

/**
 * FetcherPool manages fetcher instances and supports auto-escalation (Static -> Dynamic -> Stealth).
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
