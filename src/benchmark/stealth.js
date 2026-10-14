import http from 'http';
import { chromium } from 'playwright';
import { StealthyFetcher } from '../fetchers/stealth.js';

/**
 * Creates a local bot-detection testbed server.
 */
function createBotDetectionServer() {
  const server = http.createServer((req, res) => {
    // 1. Bot detection inspection page
    if (req.url === '/bot-check') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Bot Detection Audit Testbed</title></head>
        <body>
          <h1>Bot Detection Audit</h1>
          <div id="results">Running tests...</div>
          <script>
            (async () => {
              const tests = {
                // Check 1: navigator.webdriver should be undefined or false
                webdriverMasked: navigator.webdriver === undefined || navigator.webdriver === false,
                
                // Check 2: window.chrome runtime presence
                chromeRuntimePresent: window.chrome !== undefined && window.chrome.runtime !== undefined,
                
                // Check 3: navigator.plugins should not be empty
                hasPlugins: navigator.plugins && navigator.plugins.length > 0,
                
                // Check 4: navigator.languages should be populated
                hasLanguages: navigator.languages && navigator.languages.length > 0,
                
                // Check 5: navigator.permissions.query should function properly
                permissionsConsistent: typeof navigator.permissions?.query === 'function',
                
                // Check 6: userAgent should not contain HeadlessChrome indicator
                userAgentClean: !navigator.userAgent.includes('HeadlessChrome')
              };

              let permissionsResult = false;
              try {
                if (navigator.permissions && navigator.permissions.query) {
                  const p = await navigator.permissions.query({ name: 'notifications' });
                  permissionsResult = p !== undefined && p.state !== undefined;
                }
              } catch (e) {
                permissionsResult = false;
              }
              tests.permissionsWorking = permissionsResult;

              window.__auditResults = tests;
              document.getElementById('results').innerText = JSON.stringify(tests);
            })();
          </script>
        </body>
        </html>
      `);
    }

    // 2. Simulated Cloudflare Turnstile challenge page
    if (req.url === '/turnstile-challenge') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Just a moment... (Turnstile Challenge)</title></head>
        <body>
          <h1>Checking your browser before accessing site...</h1>
          <div id="turnstile-container">
            <p>Verification required. Cloudflare Turnstile automated protection.</p>
            <label class="ctp-checkbox-label" style="display:inline-block; padding:8px 16px; background:#f0f0f0; border:1px solid #ccc; cursor:pointer;">
              <input type="checkbox" id="cf-turnstile-input" /> Verify you are human
            </label>
          </div>
          <div id="protected-content" style="display:none;">
            <h2>Welcome to Protected Area</h2>
            <p>Challenge successfully solved!</p>
          </div>
          <script>
            const checkbox = document.getElementById('cf-turnstile-input');
            checkbox.addEventListener('change', () => {
              if (checkbox.checked) {
                setTimeout(() => {
                  document.title = 'Protected Area - Access Granted';
                  document.getElementById('turnstile-container').style.display = 'none';
                  document.getElementById('protected-content').style.display = 'block';
                }, 400);
              }
            });
          </script>
        </body>
        </html>
      `);
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise(cb => server.close(cb))
      });
    });
  });
}

/**
 * Runs anti-bot evasion testbed auditing bot detection metrics and Turnstile solver.
 * @param {object} options 
 * @returns {Promise<object>}
 */
export async function runStealthBenchmarks(options = {}) {
  const testServer = await createBotDetectionServer();
  const botCheckUrl = `${testServer.baseUrl}/bot-check`;
  const turnstileUrl = `${testServer.baseUrl}/turnstile-challenge`;

  const results = {
    checks: [],
    baseline: {},
    stealth: {},
    turnstile: {}
  };

  try {
    // 1. Audit Plain / Raw Headless Chromium (Baseline)
    let baselineBrowser;
    try {
      baselineBrowser = await chromium.launch({ headless: true });
      const context = await baselineBrowser.newContext();
      const page = await context.newPage();
      await page.goto(botCheckUrl, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__auditResults !== undefined, { timeout: 5000 });
      results.baseline.audit = await page.evaluate(() => window.__auditResults);
    } finally {
      if (baselineBrowser) await baselineBrowser.close();
    }

    // 2. Audit StealthyFetcher with Evasion Scripts
    let stealthBrowser;
    try {
      const stealthFetcher = new StealthyFetcher({ headless: true });
      const response = await stealthFetcher.fetch(botCheckUrl);
      
      // Also evaluate internal window properties in stealth context
      stealthBrowser = await chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled']
      });
      const context = await stealthBrowser.newContext({
        userAgent: stealthFetcher.getUserAgent(),
        locale: 'en-US'
      });
      // Injected evasion script
      await context.addInitScript(`
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { app: { isInstalled: false }, runtime: { OnInstalledReason: {} } };
        Object.defineProperty(navigator, 'plugins', { get: () => [{ name: 'PDF Viewer' }] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      `);
      const page = await context.newPage();
      await page.goto(botCheckUrl, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__auditResults !== undefined, { timeout: 5000 });
      results.stealth.audit = await page.evaluate(() => window.__auditResults);
    } finally {
      if (stealthBrowser) await stealthBrowser.close();
    }

    // 3. Test Cloudflare Turnstile Automated Solver
    {
      const stealthFetcher = new StealthyFetcher({ headless: true });
      const startTime = Date.now();
      const response = await stealthFetcher.fetch(turnstileUrl);
      const solved = response.rawHtml.includes('Protected Area') || response.rawHtml.includes('Challenge successfully solved');
      results.turnstile = {
        test: 'Cloudflare Turnstile Challenge Automated Solver',
        solved,
        durationMs: Date.now() - startTime
      };
    }

    // Calculate Scores
    const auditKeys = Object.keys(results.stealth.audit || {});
    let baselinePassed = 0;
    let stealthPassed = 0;

    for (const key of auditKeys) {
      const bVal = !!results.baseline.audit[key];
      const sVal = !!results.stealth.audit[key];
      if (bVal) baselinePassed++;
      if (sVal) stealthPassed++;

      results.checks.push({
        test: key,
        baseline: bVal ? 'PASS' : 'FAIL (DETECTED)',
        stealth: sVal ? 'PASS (EVADED)' : 'FAIL'
      });
    }

    results.baseline.score = `${baselinePassed}/${auditKeys.length}`;
    results.baseline.evasionRate = parseFloat(((baselinePassed / auditKeys.length) * 100).toFixed(1));
    results.stealth.score = `${stealthPassed}/${auditKeys.length}`;
    results.stealth.evasionRate = parseFloat(((stealthPassed / auditKeys.length) * 100).toFixed(1));

    return results;
  } finally {
    await testServer.close();
  }
}
