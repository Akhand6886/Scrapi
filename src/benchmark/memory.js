import { Response } from '../parser/adaptor.js';
import { MarkdownEngine } from '../parser/markdown.js';

/**
 * Generates an HTML payload for memory stress testing.
 */
function createHtmlPayload(id) {
  return `
    <html>
      <head><title>Page ${id} Memory Test</title></head>
      <body>
        <main>
          <h1>Memory Stress Test Page ${id}</h1>
          <p>Analyzing resident set size and heap retention under concurrent workload.</p>
          <div class="content">
            ${Array.from({ length: 40 }, (_, idx) => `<p>Item ${idx} paragraph data payload for heap profile verification.</p>`).join('\n')}
          </div>
          <table>
            <thead><tr><th>Col A</th><th>Col B</th></tr></thead>
            <tbody>
              ${Array.from({ length: 20 }, (_, idx) => `<tr><td>Cell ${idx}-A</td><td>Cell ${idx}-B</td></tr>`).join('\n')}
            </tbody>
          </table>
        </main>
      </body>
    </html>
  `;
}

/**
 * Runs concurrency and memory footprint benchmarks.
 * @param {object} options 
 * @returns {Promise<object>}
 */
export async function runMemoryBenchmarks(options = {}) {
  const pageCount = options.pageCount || 60;
  const concurrency = options.concurrency || 6;

  // Baseline memory
  if (global.gc) global.gc();
  const baselineMem = process.memoryUsage();

  let peakRss = baselineMem.rss;
  let peakHeap = baselineMem.heapUsed;

  const queue = Array.from({ length: pageCount }, (_, i) => i);
  let processed = 0;

  const worker = async () => {
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined) break;

      const html = createHtmlPayload(id);
      const res = new Response({
        url: `https://benchmark.local/page/${id}`,
        html,
        fetcher: 'static'
      });

      // Perform standard extraction pipeline
      const title = res.css('h1').first()?.cleanText;
      const paragraphs = res.css('p').texts;
      const root = res.findBestContentRoot();
      const markdown = MarkdownEngine.convert(root);

      processed++;

      // Track peak memory
      const currentMem = process.memoryUsage();
      if (currentMem.rss > peakRss) peakRss = currentMem.rss;
      if (currentMem.heapUsed > peakHeap) peakHeap = currentMem.heapUsed;

      // Yield slightly to event loop
      if (processed % 10 === 0) {
        await new Promise(r => setImmediate(r));
      }
    }
  };

  const start = Date.now();
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  const durationMs = Date.now() - start;

  if (global.gc) global.gc();
  const finalMem = process.memoryUsage();

  const toMb = bytes => parseFloat((bytes / (1024 * 1024)).toFixed(2));

  return {
    pageCount,
    concurrency,
    durationMs,
    throughputPagesPerSec: parseFloat((pageCount / (durationMs / 1000)).toFixed(1)),
    baselineRssMb: toMb(baselineMem.rss),
    peakRssMb: toMb(peakRss),
    finalRssMb: toMb(finalMem.rss),
    baselineHeapMb: toMb(baselineMem.heapUsed),
    peakHeapMb: toMb(peakHeap),
    finalHeapMb: toMb(finalMem.heapUsed),
    avgMemoryPerPageKb: parseFloat(((peakHeap - baselineMem.heapUsed) / pageCount / 1024).toFixed(1))
  };
}
