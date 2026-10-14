import http from 'http';
import { StaticFetcher } from '../fetchers/static.js';
import { DynamicFetcher } from '../fetchers/dynamic.js';
import { StealthyFetcher } from '../fetchers/stealth.js';
import { initStorage } from '../storage.js';

/**
 * Creates an in-memory HTTP benchmark server.
 */
function createBenchmarkServer() {
  const server = http.createServer((req, res) => {
    const etag = '"scrapi-bench-etag-12345"';

    if (req.url === '/static') {
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { 'ETag': etag });
        return res.end();
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'ETag': etag,
        'Cache-Control': 'public, max-age=3600'
      });
      return res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Static Benchmark Target</title></head>
        <body>
          <h1>High-Performance Static Page</h1>
          <p>This payload tests connection pooling and keep-alive throughput.</p>
          ${Array.from({ length: 30 }, (_, i) => `<div>Item ${i} content payload data</div>`).join('\n')}
        </body>
        </html>
      `);
    }

    if (req.url === '/spa') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Dynamic SPA Shell</title></head>
        <body>
          <div id="root">Loading application...</div>
          <script>
            setTimeout(() => {
              document.getElementById('root').innerHTML = '<h1>SPA Content Hydrated Successfully</h1><p>Client-side rendered content loaded dynamically.</p>';
            }, 50);
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
 * Runs multi-tier fetcher latency benchmarks.
 * @param {object} options 
 * @returns {Promise<object>}
 */
export async function runFetcherBenchmarks(options = {}) {
  await initStorage();
  const testServer = await createBenchmarkServer();
  const staticUrl = `${testServer.baseUrl}/static`;
  const spaUrl = `${testServer.baseUrl}/spa`;

  const results = {};

  try {
    const staticFetcher = new StaticFetcher({ maxRetries: 0 });
    const dynamicFetcher = new DynamicFetcher({ headless: true });
    const stealthFetcher = new StealthyFetcher({ headless: true });

    // 1. StaticFetcher: Cold Request
    {
      const latencies = [];
      const runs = options.runs || 5;
      for (let i = 0; i < runs; i++) {
        const start = Date.now();
        const res = await staticFetcher.fetch(staticUrl, { noCache: true });
        latencies.push(Date.now() - start);
      }
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      results.staticCold = {
        name: 'StaticFetcher (Cold Request)',
        tier: 'Static',
        runs,
        avgMs: parseFloat(avg.toFixed(1)),
        minMs: Math.min(...latencies),
        maxMs: Math.max(...latencies)
      };
    }

    // 2. StaticFetcher: 304 Not Modified Cache Hit
    {
      // Warm the cache first
      await staticFetcher.fetch(staticUrl);

      const latencies = [];
      const runs = options.runs || 10;
      for (let i = 0; i < runs; i++) {
        const start = Date.now();
        const res = await staticFetcher.fetch(staticUrl);
        latencies.push(Date.now() - start);
      }
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      results.staticCached = {
        name: 'StaticFetcher (HTTP 304 Cache Hit)',
        tier: 'Static (304 Cache)',
        runs,
        avgMs: parseFloat(avg.toFixed(2)),
        minMs: Math.min(...latencies),
        maxMs: Math.max(...latencies)
      };
    }

    // 3. DynamicFetcher: Playwright Headless Chromium SPA
    {
      const latencies = [];
      const runs = Math.min(options.runs || 3, 3);
      for (let i = 0; i < runs; i++) {
        const start = Date.now();
        const res = await dynamicFetcher.fetch(spaUrl, { waitForSelector: '#root h1' });
        latencies.push(Date.now() - start);
      }
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      results.dynamic = {
        name: 'DynamicFetcher (Playwright Chromium)',
        tier: 'Dynamic',
        runs,
        avgMs: parseFloat(avg.toFixed(1)),
        minMs: Math.min(...latencies),
        maxMs: Math.max(...latencies)
      };
    }

    // 4. StealthyFetcher: Anti-Bot Chromium with Evasion Injection
    {
      const latencies = [];
      const runs = Math.min(options.runs || 3, 3);
      for (let i = 0; i < runs; i++) {
        const start = Date.now();
        const res = await stealthFetcher.fetch(staticUrl);
        latencies.push(Date.now() - start);
      }
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      results.stealth = {
        name: 'StealthyFetcher (Anti-Bot Evasion)',
        tier: 'Stealth',
        runs,
        avgMs: parseFloat(avg.toFixed(1)),
        minMs: Math.min(...latencies),
        maxMs: Math.max(...latencies)
      };
    }

    // Compute Speedup comparisons
    if (results.staticCold && results.dynamic) {
      results.staticVsDynamicMultiplier = parseFloat((results.dynamic.avgMs / Math.max(results.staticCold.avgMs, 1)).toFixed(1));
    }
    if (results.staticCached && results.staticCold) {
      results.cacheSpeedupMultiplier = parseFloat((results.staticCold.avgMs / Math.max(results.staticCached.avgMs, 0.1)).toFixed(1));
    }

    return results;
  } finally {
    await testServer.close();
  }
}
