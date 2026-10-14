import axios from 'axios';
import { BaseFetcher, globalHttpAgent, globalHttpsAgent } from './base.js';
import { Response } from '../parser/adaptor.js';
import { getCachedPage, saveCachedPage } from '../storage.js';

/**
 * StaticFetcher handles ultra-fast HTTP requests with TLS-like headers, keep-alive pooling, and HTTP caching.
 */
export class StaticFetcher extends BaseFetcher {
  constructor(options = {}) {
    super(options);
  }

  /**
   * Fetch page using high-performance HTTP client.
   * @param {string} url 
   * @param {object} options 
   * @returns {Promise<Response>}
   */
  async fetch(url, options = {}) {
    const startTime = Date.now();
    const timeout = options.timeout || this.timeout;
    const userAgent = this.getUserAgent(options.userAgent);

    let cached = null;
    if (!options.noCache) {
      try {
        cached = getCachedPage(url);
      } catch (e) {}
    }

    const headers = {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      ...(options.headers || {})
    };

    if (cached) {
      if (cached.etag) headers['If-None-Match'] = cached.etag;
      if (cached.last_modified) headers['If-Modified-Since'] = cached.last_modified;
    }

    let attempt = 0;
    const maxRetries = options.maxRetries !== undefined ? options.maxRetries : this.maxRetries;

    while (attempt <= maxRetries) {
      try {
        const proxy = this.getNextProxy();
        const axiosConfig = {
          timeout,
          maxContentLength: 10 * 1024 * 1024,
          responseType: 'text',
          headers,
          httpAgent: globalHttpAgent,
          httpsAgent: globalHttpsAgent,
          validateStatus: status => (status >= 200 && status < 300) || status === 304 || status === 429 || (status >= 500 && status < 600)
        };

        if (proxy) {
          try {
            const parsed = new URL(proxy);
            axiosConfig.proxy = {
              host: parsed.hostname,
              port: parseInt(parsed.port, 10) || 80,
              protocol: parsed.protocol.replace(':', '')
            };
          } catch (e) {}
        }

        const res = await axios.get(url, axiosConfig);

        // Rate limit backoff
        if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
          if (attempt === maxRetries) {
            throw new Error(`StaticFetcher: Failed after ${maxRetries} retries. Status: ${res.status}`);
          }
          const backoffDelay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
          await this.delay(backoffDelay, false);
          attempt++;
          continue;
        }

        if (res.status === 304 && cached) {
          return new Response({
            url,
            status: 200,
            headers: res.headers,
            html: cached.html,
            fetcher: 'static',
            timing: Date.now() - startTime
          });
        }

        const contentType = res.headers['content-type'] || '';
        if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml') && !contentType.includes('application/json')) {
          throw new Error(`Invalid content type: "${contentType}".`);
        }

        const html = res.data;
        if (!options.noCache) {
          try {
            saveCachedPage(url, html, res.headers['etag'], res.headers['last-modified']);
          } catch (e) {}
        }

        return new Response({
          url,
          status: res.status,
          headers: res.headers,
          html,
          fetcher: 'static',
          timing: Date.now() - startTime
        });
      } catch (err) {
        if (attempt === maxRetries || (err.message && err.message.includes('Invalid content type'))) {
          if (cached) {
            return new Response({
              url,
              status: 200,
              headers: {},
              html: cached.html,
              fetcher: 'static (cache-fallback)',
              timing: Date.now() - startTime
            });
          }
          throw err;
        }

        const backoffDelay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        await this.delay(backoffDelay, false);
        attempt++;
      }
    }
  }
}
