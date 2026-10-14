import http from 'http';
import https from 'https';

export const DEFAULT_USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
];

export const globalHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 100, maxFreeSockets: 10 });
export const globalHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100, maxFreeSockets: 10 });

/**
 * Base Fetcher class defining the contract for all Scrapi fetchers.
 */
export class BaseFetcher {
  constructor(options = {}) {
    this.options = options;
    this.timeout = options.timeout || 15000;
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : 3;
    this.proxies = options.proxies || (options.proxy ? [options.proxy] : []);
    this.proxyIndex = 0;
  }

  /**
   * Returns a randomized or configured User-Agent string.
   */
  getUserAgent(override) {
    if (override) return override;
    if (this.options.userAgent) return this.options.userAgent;
    return DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)];
  }

  /**
   * Gets the next proxy from the rotation pool if configured.
   */
  getNextProxy() {
    if (this.proxies.length === 0) return null;
    const proxy = this.proxies[this.proxyIndex % this.proxies.length];
    this.proxyIndex++;
    return proxy;
  }

  /**
   * Helper to sleep with optional jitter.
   */
  async delay(ms, withJitter = true) {
    const jitter = withJitter ? Math.random() * 500 : 0;
    return new Promise(resolve => setTimeout(resolve, ms + jitter));
  }

  /**
   * Abstract fetch method to be overridden by subclasses.
   * @param {string} url 
   * @param {object} options 
   */
  async fetch(url, options = {}) {
    throw new Error('fetch() must be implemented by subclass');
  }
}
