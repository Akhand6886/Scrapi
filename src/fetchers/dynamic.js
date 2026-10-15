import { chromium } from 'playwright';
import { BaseFetcher } from './base.js';
import { Response } from '../parser/adaptor.js';

let sharedBrowser = null;
let idleTimer = null;
const BROWSER_IDLE_TIMEOUT = 3 * 60 * 1000; // 3 min idle

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (sharedBrowser) {
      try {
        await sharedBrowser.close();
      } catch (e) {}
      sharedBrowser = null;
    }
  }, BROWSER_IDLE_TIMEOUT);
  if (idleTimer && typeof idleTimer.unref === 'function') {
    idleTimer.unref();
  }
}

export async function closeSharedBrowser() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch (e) {}
    sharedBrowser = null;
  }
}

async function getBrowser(headless = true) {
  if (idleTimer) clearTimeout(idleTimer);
  if (!sharedBrowser) {
    sharedBrowser = await chromium.launch({
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });
    sharedBrowser.on('disconnected', () => {
      sharedBrowser = null;
    });
  }
  resetIdleTimer();
  return sharedBrowser;
}

/**
 * DynamicFetcher renders JavaScript-heavy websites using Playwright headless browser.
 */
export class DynamicFetcher extends BaseFetcher {
  constructor(options = {}) {
    super(options);
    this.headless = options.headless !== undefined ? options.headless : true;
  }

  /**
   * Fetch and render dynamic page.
   * @param {string} url 
   * @param {object} options 
   * @returns {Promise<Response>}
   */
  async fetch(url, options = {}) {
    const startTime = Date.now();
    const timeout = options.timeout || this.timeout;
    const userAgent = this.getUserAgent(options.userAgent);
    const browser = await getBrowser(this.headless);

    const proxy = this.getNextProxy();
    const contextOptions = {
      userAgent,
      viewport: options.viewport || { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: 'America/New_York',
    };

    if (proxy) {
      contextOptions.proxy = { server: proxy };
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);

    try {
      // Navigate to URL
      const waitUntil = options.waitUntil || 'domcontentloaded';
      const res = await page.goto(url, { waitUntil, timeout });

      // If user requested wait for specific selector
      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { timeout: Math.min(timeout, 10000) });
      } else if (options.waitForTimeout) {
        await page.waitForTimeout(options.waitForTimeout);
      }

      // Auto scroll if requested
      if (options.scrollToBottom) {
        await page.evaluate(async () => {
          await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 300;
            const timer = setInterval(() => {
              const scrollHeight = document.body.scrollHeight;
              window.scrollBy(0, distance);
              totalHeight += distance;
              if (totalHeight >= scrollHeight || totalHeight > 5000) {
                clearInterval(timer);
                resolve();
              }
            }, 100);
          });
        });
      }

      const html = await page.content();
      const cookies = await context.cookies();
      const status = res ? res.status() : 200;
      const headers = res ? res.headers() : {};

      return new Response({
        url,
        status,
        headers,
        html,
        cookies,
        fetcher: 'dynamic',
        timing: Date.now() - startTime
      });
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      resetIdleTimer();
    }
  }

  /**
   * Close the shared browser instance.
   */
  static async closeBrowser() {
    if (sharedBrowser) {
      try {
        await sharedBrowser.close();
      } catch (e) {}
      sharedBrowser = null;
    }
  }
}
