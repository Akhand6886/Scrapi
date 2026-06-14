import * as cheerio from 'cheerio';
import path from 'path';
import { fetchHtml, scrapePage } from './scraper.js';
import { saveMarkdownFile, insertScrape } from './storage.js';

/**
 * Runs a recursive site spider that crawls page links in parallel, mapping directory structures.
 * @param {string} seedUrl 
 * @param {object} options 
 * @param {function} onProgress 
 */
export async function runSpider(seedUrl, options = {}, onProgress = () => {}) {
  let origin;
  try {
    origin = new URL(seedUrl).origin;
  } catch (err) {
    throw new Error(`Invalid seed URL: "${seedUrl}"`);
  }

  const maxDepth = options.depth !== undefined ? parseInt(options.depth, 10) : Infinity;
  const maxPages = options.maxPages !== undefined ? parseInt(options.maxPages, 10) : 100;
  const concurrency = Math.max(1, parseInt(options.concurrency, 10) || 2);
  const delay = options.delay !== undefined ? parseInt(options.delay, 10) : 1500;
  const category = options.category || new URL(seedUrl).hostname;
  const outputDir = options.output || './output';

  const visited = new Set();
  const queue = [{ url: seedUrl, depth: 0 }];
  const mappedFilenames = new Set();

  let succeeded = 0;
  let failed = 0;
  let activeWorkers = 0;
  let aborted = false;

  const logMessage = (msg) => {
    onProgress({
      type: 'log',
      message: msg,
      stats: {
        visited: visited.size,
        queued: queue.length,
        succeeded,
        failed
      }
    });
  };

  const isSameOrigin = (targetUrl) => {
    try {
      const targetOrigin = new URL(targetUrl).origin;
      return targetOrigin === origin;
    } catch (e) {
      return false;
    }
  };

  const cleanUrl = (urlStr) => {
    try {
      const u = new URL(urlStr);
      u.hash = ''; // Remove anchor hash tags
      return u.href;
    } catch (e) {
      return null;
    }
  };

  const worker = async () => {
    activeWorkers++;
    while (queue.length > 0 && visited.size < maxPages && !aborted) {
      const item = queue.shift();
      if (!item) continue;

      const targetUrl = cleanUrl(item.url);
      if (!targetUrl || visited.has(targetUrl) || !isSameOrigin(targetUrl)) {
        continue;
      }

      visited.add(targetUrl);
      logMessage(`🕸️ Spidering: Fetching and scraping: ${targetUrl} (Depth: ${item.depth})`);

      let dbRecord = {
        url: targetUrl,
        scraped_at: new Date().toISOString(),
        status: 'failed',
        selector: 'auto',
        category
      };

      try {
        // Scrape target page content
        const result = await scrapePage(targetUrl, {
          images: !!options.images,
          noCache: !!options.noCache,
          timeout: options.timeout ? parseInt(options.timeout, 10) : 10000
        });

        // Map URL path structure to safe output subfolders
        const urlObj = new URL(targetUrl);
        const host = urlObj.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
        let pathname = urlObj.pathname;

        if (pathname.endsWith('/')) {
          pathname += 'index';
        } else if (!pathname || pathname === '/') {
          pathname = '/index';
        }

        const segments = pathname.split('/').map(seg => seg.replace(/[^a-zA-Z0-9_.-]/g, '_'));
        const rawBaseName = segments.pop() || 'index';
        const subdir = path.join(host, ...segments);

        let uniqueBaseName = rawBaseName;
        let collisionIndex = 1;
        while (mappedFilenames.has(path.join(subdir, `${uniqueBaseName}.md`))) {
          uniqueBaseName = `${rawBaseName}_${collisionIndex++}`;
        }
        mappedFilenames.add(path.join(subdir, `${uniqueBaseName}.md`));

        // Save markdown file
        const finalFilename = await saveMarkdownFile(result.markdown, result.metadata, {
          output: outputDir,
          subdir,
          filename: uniqueBaseName,
          noMeta: !!options.noMeta
        });

        dbRecord.title = result.metadata.title;
        dbRecord.description = result.metadata.description;
        dbRecord.word_count = result.metadata.word_count;
        dbRecord.filename = finalFilename;
        dbRecord.status = 'success';

        if (!options.noDb) {
          insertScrape(dbRecord);
        }

        succeeded++;
        logMessage(`✓ Success: Scraped and saved to ${finalFilename}`);

        // Discover and enqueue same-origin links
        if (item.depth < maxDepth) {
          const html = await fetchHtml(targetUrl, { noCache: !!options.noCache });
          const $ = cheerio.load(html);

          $('a').each((_, elem) => {
            let href = $(elem).attr('href');
            if (href) {
              try {
                if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
                  return;
                }
                const resolvedUrl = cleanUrl(new URL(href, targetUrl).href);
                if (resolvedUrl && isSameOrigin(resolvedUrl) && !visited.has(resolvedUrl) && !queue.some(q => q.url === resolvedUrl)) {
                  queue.push({ url: resolvedUrl, depth: item.depth + 1 });
                }
              } catch (e) {
                // Ignore link resolution errors
              }
            }
          });
        }
      } catch (err) {
        failed++;
        dbRecord.error = err.message;
        if (!options.noDb) {
          try {
            insertScrape(dbRecord);
          } catch (dbErr) {
            // Ignore DB insert errors
          }
        }
        logMessage(`✖ Failed to crawl ${targetUrl}: ${err.message}`);
      }

      onProgress({
        type: 'progress',
        stats: {
          visited: visited.size,
          queued: queue.length,
          succeeded,
          failed
        }
      });

      if (queue.length > 0 && !aborted && delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    activeWorkers--;
  };

  logMessage(`🕸️ Starting website spider on seed URL: ${seedUrl}`);

  const workerPromises = [];
  const workerCount = Math.min(concurrency, maxPages);
  for (let i = 0; i < workerCount; i++) {
    workerPromises.push(worker());
  }

  await Promise.all(workerPromises);

  logMessage(`🏁 Spider complete! ${succeeded} pages successfully scraped, ${failed} failed.`);
  return { visited: visited.size, succeeded, failed };
}
