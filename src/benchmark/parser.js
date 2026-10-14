import * as cheerio from 'cheerio';
import { Response } from '../parser/adaptor.js';
import { AdaptiveEngine } from '../parser/adaptive.js';
import { MarkdownEngine } from '../parser/markdown.js';

// Sample HTML fixture simulating a modern content-rich webpage
const FIXTURE_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Benchmark Test Article - Performance Analysis</title>
  <meta name="description" content="A comprehensive analysis of web scraping performance and architecture.">
</head>
<body>
  <header class="site-header">
    <nav class="nav-menu">
      <ul>
        ${Array.from({ length: 20 }, (_, i) => `<li><a href="/nav-${i}">Navigation Link ${i}</a></li>`).join('\n')}
      </ul>
    </nav>
  </header>
  
  <main id="content" class="main-container">
    <article class="post-item" id="main-post">
      <h1 class="entry-title">High-Performance Web Scraping in Node.js</h1>
      <p class="lead">Web scraping throughput depends on parsing speed and memory efficiency.</p>
      
      <div class="entry-content">
        ${Array.from({ length: 50 }, (_, i) => `
          <div class="paragraph-block block-${i}">
            <p>Paragraph ${i}: Scrapi provides fluent query selectors and adaptive recovery.</p>
            <a href="https://example.com/link-${i}" class="content-link link-item">Reference Link ${i}</a>
          </div>
        `).join('\n')}
        
        <table class="data-table">
          <thead>
            <tr><th>Framework</th><th>Language</th><th>Throughput</th></tr>
          </thead>
          <tbody>
            <tr><td>Scrapi v2</td><td>JavaScript (Node)</td><td>~45,000 ops/sec</td></tr>
            <tr><td>BeautifulSoup</td><td>Python</td><td>~5,000 ops/sec</td></tr>
            <tr><td>Cheerio</td><td>JavaScript</td><td>~38,000 ops/sec</td></tr>
          </tbody>
        </table>
      </div>
    </article>
  </main>
  
  <footer class="site-footer">
    <p>&copy; 2026 Scrapi Benchmark Suite</p>
  </footer>
</body>
</html>
`;

/**
 * Runs parser benchmarks measuring ops/sec and latency across selector types and markdown conversion.
 * @param {object} options 
 * @returns {Promise<object>}
 */
export async function runParserBenchmarks(options = {}) {
  const iterations = options.iterations || 500;
  const results = {};

  const response = new Response({
    url: 'https://benchmark.local/article',
    status: 200,
    html: FIXTURE_HTML,
    fetcher: 'static'
  });

  const $ = cheerio.load(FIXTURE_HTML);

  // 1. Raw Cheerio query
  {
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      $('div.paragraph-block a.content-link').length;
    }
    const end = process.hrtime.bigint();
    const durationNs = Number(end - start);
    const durationMs = durationNs / 1e6;
    const opsPerSec = Math.round((iterations / (durationMs / 1000)));
    results.cheerioCss = {
      name: 'Cheerio Raw CSS Selector',
      iterations,
      durationMs: parseFloat(durationMs.toFixed(2)),
      opsPerSec,
      avgLatencyUs: parseFloat(((durationNs / iterations) / 1000).toFixed(2))
    };
  }

  // 2. Scrapi Fluent CSS query (AdaptorElement & SelectorList)
  {
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      const list = response.css('div.paragraph-block a.content-link');
      const count = list.length;
    }
    const end = process.hrtime.bigint();
    const durationNs = Number(end - start);
    const durationMs = durationNs / 1e6;
    const opsPerSec = Math.round((iterations / (durationMs / 1000)));
    results.scrapiCss = {
      name: 'Scrapi Fluent CSS (SelectorList)',
      iterations,
      durationMs: parseFloat(durationMs.toFixed(2)),
      opsPerSec,
      avgLatencyUs: parseFloat(((durationNs / iterations) / 1000).toFixed(2))
    };
  }

  // 3. Scrapi XPath query
  {
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      const list = response.xpath('//div[@class="paragraph-block"]//a');
      const count = list.length;
    }
    const end = process.hrtime.bigint();
    const durationNs = Number(end - start);
    const durationMs = durationNs / 1e6;
    const opsPerSec = Math.round((iterations / (durationMs / 1000)));
    results.scrapiXpath = {
      name: 'Scrapi XPath Evaluator',
      iterations,
      durationMs: parseFloat(durationMs.toFixed(2)),
      opsPerSec,
      avgLatencyUs: parseFloat(((durationNs / iterations) / 1000).toFixed(2))
    };
  }

  // 4. Adaptive Self-Healing Engine match
  {
    const fingerprint = {
      tagName: 'article',
      id: 'main-post',
      classes: ['post-item'],
      textSnippet: 'High-Performance Web Scraping in Node.js',
      parentTagName: 'main',
      path: 'main#content > article#main-post'
    };

    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      AdaptiveEngine.relocate($, fingerprint);
    }
    const end = process.hrtime.bigint();
    const durationNs = Number(end - start);
    const durationMs = durationNs / 1e6;
    const opsPerSec = Math.round((iterations / (durationMs / 1000)));
    results.adaptiveEngine = {
      name: 'Scrapi Adaptive Heuristic Engine',
      iterations,
      durationMs: parseFloat(durationMs.toFixed(2)),
      opsPerSec,
      avgLatencyUs: parseFloat(((durationNs / iterations) / 1000).toFixed(2))
    };
  }

  // 5. High-Fidelity Markdown Conversion (Turndown + GFM)
  {
    const mdIterations = Math.max(50, Math.floor(iterations / 5));
    const contentRoot = response.findBestContentRoot();
    const start = process.hrtime.bigint();
    for (let i = 0; i < mdIterations; i++) {
      MarkdownEngine.convert(contentRoot, { images: true });
    }
    const end = process.hrtime.bigint();
    const durationNs = Number(end - start);
    const durationMs = durationNs / 1e6;
    const opsPerSec = Math.round((mdIterations / (durationMs / 1000)));
    results.markdownEngine = {
      name: 'Scrapi MarkdownEngine (GFM Tables)',
      iterations: mdIterations,
      durationMs: parseFloat(durationMs.toFixed(2)),
      opsPerSec,
      avgLatencyUs: parseFloat(((durationNs / mdIterations) / 1000).toFixed(2))
    };
  }

  return results;
}
