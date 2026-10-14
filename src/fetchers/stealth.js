import { chromium } from 'playwright';
import { BaseFetcher } from './base.js';
import { Response } from '../parser/adaptor.js';

const STEALTH_EVASION_SCRIPT = `
(() => {
  // 1. Mask navigator.webdriver
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
  });

  // 2. Mock Chrome runtime
  window.chrome = {
    app: { isInstalled: false, InstallState: { DISABLED: 'DISABLED', INSTALLED: 'INSTALLED', NOT_INSTALLED: 'NOT_INSTALLED' }, RunningState: { CANNOT_RUN: 'CANNOT_RUN', READY_TO_RUN: 'READY_TO_RUN', RUNNING: 'RUNNING' } },
    runtime: {
      OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
      RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' }
    }
  };

  // 3. Mock navigator.plugins & mimeTypes
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }
    ]
  });

  // 4. Mock languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
  });

  // 5. Fix permissions API
  const originalQuery = window.navigator.permissions ? window.navigator.permissions.query : null;
  if (originalQuery) {
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
  }
})();
`;

/**
 * StealthyFetcher handles anti-bot evasion and Cloudflare Turnstile bypass.
 */
export class StealthyFetcher extends BaseFetcher {
  constructor(options = {}) {
    super(options);
    this.headless = options.headless !== undefined ? options.headless : true;
  }

  /**
   * Fetch page using stealth browser instance.
   * @param {string} url 
   * @param {object} options 
   * @returns {Promise<Response>}
   */
  async fetch(url, options = {}) {
    const startTime = Date.now();
    const timeout = options.timeout || this.timeout;
    const userAgent = this.getUserAgent(options.userAgent);

    const browser = await chromium.launch({
      headless: this.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080'
      ]
    });

    const proxy = this.getNextProxy();
    const contextOptions = {
      userAgent,
      viewport: options.viewport || { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      ignoreHTTPSErrors: true
    };

    if (proxy) {
      contextOptions.proxy = { server: proxy };
    }

    const context = await browser.newContext(contextOptions);

    // Inject stealth evasion script into every new page
    await context.addInitScript(STEALTH_EVASION_SCRIPT);

    const page = await context.newPage();
    page.setDefaultTimeout(timeout);

    try {
      const res = await page.goto(url, { waitUntil: options.waitUntil || 'domcontentloaded', timeout });

      // Check if Cloudflare / Turnstile challenge is present
      const isCloudflare = await page.evaluate(() => {
        const title = document.title.toLowerCase();
        const bodyText = document.body ? document.body.innerText.toLowerCase() : '';
        return title.includes('just a moment') ||
          title.includes('ddos-guard') ||
          bodyText.includes('checking your browser') ||
          bodyText.includes('turnstile');
      });

      if (isCloudflare) {
        // Attempt human-like mouse movement and wait for Turnstile resolution
        await page.mouse.move(100 + Math.random() * 200, 200 + Math.random() * 200);
        await page.waitForTimeout(1000 + Math.random() * 1500);

        // Check if iframe challenge checkbox exists
        const cfFrame = page.frames().find(f => f.url().includes('cloudflare') || f.url().includes('turnstile'));
        if (cfFrame) {
          const checkbox = await cfFrame.$('input[type="checkbox"], .ctp-checkbox-label');
          if (checkbox) {
            await checkbox.click({ delay: 100 });
            await page.waitForTimeout(2000);
          }
        }
      }

      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { timeout: Math.min(timeout, 10000) });
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
        fetcher: 'stealth',
        timing: Date.now() - startTime
      });
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }
}
