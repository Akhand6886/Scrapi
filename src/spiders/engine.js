import path from 'path';
import { globalFetcherPool } from '../fetchers/index.js';
import { 
  saveMarkdownFile, 
  insertScrape, 
  downloadMediaFiles, 
  saveSpiderCheckpoint, 
  getSpiderCheckpoint, 
  deleteSpiderCheckpoint 
} from '../storage.js';
import { prioritizeUrl } from '../trees/crawl_prioritizer.js';

/**
 * CrawlEngine coordinates asynchronous crawling, rate limiting, and state checkpoints.
 */
export class CrawlEngine {
  constructor(options = {}) {
    this.options = options;
    this.fetcherPool = options.fetcherPool || globalFetcherPool;
    this.maxDepth = options.depth !== undefined ? parseInt(options.depth, 10) : Infinity;
    this.maxPages = options.maxPages !== undefined ? parseInt(options.maxPages, 10) : 100;
    this.concurrency = Math.max(1, parseInt(options.concurrency, 10) || 2);
    this.delay = options.delay !== undefined ? parseInt(options.delay, 10) : 1500;
    this.outputDir = options.output || './output';
    this.jobId = options.jobId || null;
    this.fetcherType = options.fetcher || 'static';

    this.visited = new Set();
    this.queue = [];
    this.mappedFilenames = new Set();
    this.succeeded = 0;
    this.failed = 0;
    this.activeWorkers = 0;
    this.aborted = false;
    this.origin = null;
  }

  /**
   * Normalizes URL and removes hash tags.
   */
  cleanUrl(urlStr) {
    try {
      const u = new URL(urlStr);
      u.hash = '';
      return u.href;
    } catch (e) {
      return null;
    }
  }

  /**
   * Checks if URL belongs to the allowed origin or domain list.
   */
  isAllowedUrl(targetUrl) {
    try {
      const targetOrigin = new URL(targetUrl).origin;
      if (this.origin && targetOrigin === this.origin) return true;
      if (this.options.allowedDomains && this.options.allowedDomains.length > 0) {
        const host = new URL(targetUrl).hostname;
        return this.options.allowedDomains.some(d => host === d || host.endsWith(`.${d}`));
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Resumes crawl state from a saved checkpoint if available.
   */
  resumeFromCheckpoint(jobId) {
    const cp = getSpiderCheckpoint(jobId);
    if (!cp || !cp.state) return false;

    this.visited = new Set(cp.state.visited || []);
    this.queue = cp.state.queue || [];
    this.succeeded = cp.state.succeeded || 0;
    this.failed = cp.state.failed || 0;
    this.mappedFilenames = new Set(cp.state.mappedFilenames || []);
    return true;
  }

  /**
   * Saves current crawl state to SQLite checkpoint table.
   */
  saveCheckpoint(seedUrl) {
    if (!this.jobId) return;
    saveSpiderCheckpoint(this.jobId, seedUrl, {
      visited: Array.from(this.visited),
      queue: this.queue,
      succeeded: this.succeeded,
      failed: this.failed,
      mappedFilenames: Array.from(this.mappedFilenames),
      options: this.options
    });
  }

  /**
   * Runs the crawl engine on a seed URL or Spider instance.
   * @param {string|import('./spider.js').Spider} seedOrSpider 
   * @param {function} onProgress 
   */
  async crawl(seedOrSpider, onProgress = () => {}) {
    let seedUrl = '';
    let spider = null;

    if (typeof seedOrSpider === 'string') {
      seedUrl = seedOrSpider;
    } else if (seedOrSpider && seedOrSpider.startUrls) {
      spider = seedOrSpider;
      seedUrl = spider.startUrls[0] || '';
    }

    try {
      this.origin = new URL(seedUrl).origin;
    } catch (err) {
      throw new Error(`Invalid seed URL: "${seedUrl}"`);
    }

    const category = this.options.category || new URL(seedUrl).hostname;

    if (this.options.resume && this.jobId) {
      const resumed = this.resumeFromCheckpoint(this.jobId);
      if (resumed) {
        onProgress({ type: 'log', message: `🔄 Resumed crawl from checkpoint [${this.jobId}] with ${this.visited.size} visited pages.` });
      }
    }

    if (this.queue.length === 0 && !this.visited.has(seedUrl)) {
      this.queue.push({ url: seedUrl, depth: 0 });
    }

    const logMessage = (msg) => {
      onProgress({
        type: 'log',
        message: msg,
        stats: {
          visited: this.visited.size,
          queued: this.queue.length,
          succeeded: this.succeeded,
          failed: this.failed
        }
      });
    };

    const worker = async () => {
      this.activeWorkers++;

      while (this.queue.length > 0 && this.visited.size < this.maxPages && !this.aborted && !this.options.aborted) {
        const item = this.queue.shift();
        if (!item) continue;

        const targetUrl = this.cleanUrl(item.url);
        if (!targetUrl || this.visited.has(targetUrl) || !this.isAllowedUrl(targetUrl)) {
          continue;
        }

        this.visited.add(targetUrl);
        logMessage(`🕸️ Spidering: Fetching and scraping: ${targetUrl} (Depth: ${item.depth})`);

        let dbRecord = {
          url: targetUrl,
          scraped_at: new Date().toISOString(),
          status: 'failed',
          selector: this.options.selector || 'auto',
          category
        };

        try {
          // Fetch page using FetcherPool
          const response = await this.fetcherPool.fetch(targetUrl, {
            fetcher: this.fetcherType,
            noCache: !!this.options.noCache,
            timeout: this.options.timeout ? parseInt(this.options.timeout, 10) : 15000
          });

          // Convert to markdown and extract metadata
          const result = response.toMarkdown({
            images: !!this.options.images,
            downloadMedia: !!this.options.downloadMedia,
            selector: this.options.selector
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
          while (this.mappedFilenames.has(path.join(subdir, `${uniqueBaseName}.md`))) {
            uniqueBaseName = `${rawBaseName}_${collisionIndex++}`;
          }
          this.mappedFilenames.add(path.join(subdir, `${uniqueBaseName}.md`));

          // Save markdown file
          const finalFilename = await saveMarkdownFile(result.markdown, result.metadata, {
            output: this.outputDir,
            subdir,
            filename: uniqueBaseName,
            noMeta: !!this.options.noMeta
          });

          if (this.options.downloadMedia && result.media && result.media.length > 0) {
            logMessage(`Downloading ${result.media.length} media files...`);
            await downloadMediaFiles(result.media, finalFilename, this.outputDir);
          }

          dbRecord.title = result.metadata.title;
          dbRecord.description = result.metadata.description;
          dbRecord.word_count = result.metadata.word_count;
          dbRecord.filename = finalFilename;
          dbRecord.status = 'success';

          if (!this.options.noDb) {
            insertScrape(dbRecord);
          }

          this.succeeded++;
          logMessage(`✓ Success: Scraped and saved to ${finalFilename}`);

          // Discover and enqueue same-origin links using CrawlPriorityTree
          if (item.depth < this.maxDepth) {
            const links = response.css('a').attribs('href');
            let addedAny = false;
            for (const href of links) {
              const resolvedUrl = this.cleanUrl(href);
              if (resolvedUrl && this.isAllowedUrl(resolvedUrl) && !this.visited.has(resolvedUrl) && !this.queue.some(q => q.url === resolvedUrl)) {
                const priorityInfo = prioritizeUrl(resolvedUrl);
                if (priorityInfo.classification !== 'DISCARD') {
                  this.queue.push({ 
                    url: resolvedUrl, 
                    depth: item.depth + 1,
                    priority: priorityInfo.priorityRank 
                  });
                  addedAny = true;
                }
              }
            }
            if (addedAny && this.queue.length > 1) {
              this.queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));
            }
          }

          // Checkpoint periodic save
          if (this.jobId && this.visited.size % 5 === 0) {
            this.saveCheckpoint(seedUrl);
          }
        } catch (err) {
          this.failed++;
          dbRecord.error = err.message;
          if (!this.options.noDb) {
            try {
              insertScrape(dbRecord);
            } catch (dbErr) {}
          }
          logMessage(`✖ Failed to crawl ${targetUrl}: ${err.message}`);
        }

        onProgress({
          type: 'progress',
          stats: {
            visited: this.visited.size,
            queued: this.queue.length,
            succeeded: this.succeeded,
            failed: this.failed
          }
        });

        if (this.queue.length > 0 && !this.aborted && !this.options.aborted && this.delay > 0) {
          await new Promise(resolve => setTimeout(resolve, this.delay));
        }
      }

      this.activeWorkers--;
    };

    logMessage(`🕸️ Starting website spider on seed URL: ${seedUrl}`);

    const workerPromises = [];
    const workerCount = Math.min(this.concurrency, this.maxPages);
    for (let i = 0; i < workerCount; i++) {
      workerPromises.push(worker());
    }

    await Promise.all(workerPromises);

    if (this.aborted || this.options.aborted) {
      if (this.jobId) {
        this.saveCheckpoint(seedUrl);
      }
      logMessage(`⏸️ Spider paused / stopped. Checkpoint preserved for resume (Job ID: ${this.jobId || 'default'}).`);
    } else {
      if (this.jobId) {
        deleteSpiderCheckpoint(this.jobId);
      }
      logMessage(`🏁 Spider complete! ${this.succeeded} pages successfully scraped, ${this.failed} failed.`);
    }

    return { visited: this.visited.size, succeeded: this.succeeded, failed: this.failed };
  }
}
