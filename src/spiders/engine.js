import path from 'path';
import { globalFetcherPool } from '../fetchers/index.js';
import { 
  saveMarkdownFile, 
  insertScrape, 
  downloadMediaFiles, 
  saveSpiderCheckpoint, 
  getSpiderCheckpoint, 
  deleteSpiderCheckpoint,
  isUrlScraped 
} from '../storage.js';
import { prioritizeUrl } from '../trees/crawl_prioritizer.js';
import { PaginationEngine } from './pagination.js';
import { SitemapEngine } from './sitemap.js';
import { TopicMatcher } from './topic_matcher.js';

/**
 * CrawlEngine coordinates asynchronous crawling, multi-tier adaptive fetching,
 * dual-frontier queue management (discovery vs content), complete pagination,
 * dynamic date coverage, and state checkpoints.
 */
export class CrawlEngine {
  constructor(options = {}) {
    this.options = options;
    this.fetcherPool = options.fetcherPool || globalFetcherPool;
    this.exhaustive = !!options.exhaustive || options.maxPages === Infinity || options.depth === Infinity || options.maxPages === 'Infinity' || options.depth === 'Infinity';
    
    if (options.depth === Infinity || options.depth === 'Infinity' || options.depth === undefined) {
      this.maxDepth = Infinity;
    } else {
      const parsedDepth = parseInt(options.depth, 10);
      this.maxDepth = isNaN(parsedDepth) ? Infinity : parsedDepth;
    }

    if (options.maxPages === Infinity || options.maxPages === 'Infinity' || (this.exhaustive && options.maxPages === undefined)) {
      this.maxPages = Infinity;
    } else if (options.maxPages !== undefined) {
      const parsedMax = parseInt(options.maxPages, 10);
      this.maxPages = isNaN(parsedMax) ? (this.exhaustive ? Infinity : 100) : parsedMax;
    } else {
      this.maxPages = this.exhaustive ? Infinity : 100;
    }

    this.concurrency = Math.max(1, parseInt(options.concurrency, 10) || 2);
    this.delay = options.delay !== undefined ? parseInt(options.delay, 10) : 1500;
    this.outputDir = options.output || './output';
    this.jobId = options.jobId || null;
    this.fetcherType = options.fetcher || 'auto';

    // Topic Configuration
    this.topic = options.topic || null;
    this.topicProfile = TopicMatcher.createProfile(this.topic);

    // Dual-Frontier Crawl Queues
    this.discoveryQueue = []; // Category listings, pagination pages, archives, subcategories, sitemaps
    this.articleQueue = [];   // Article URLs to extract
    this.visitedListings = new Set();
    this.visitedArticles = new Set();
    this.visited = new Set(); // Union of all visited URLs for backward compatibility
    this.queue = [];          // Unified view / legacy queue

    // Statistics and Date Coverage
    this.mappedFilenames = new Set();
    this.succeeded = 0;
    this.failed = 0;
    this.skippedExisting = 0;
    this.failedUrls = [];
    this.activeWorkers = 0;
    this.aborted = false;
    this.origin = null;

    this.dateCoverage = {
      earliestDate: null,
      latestDate: null,
      byYear: {},
      totalWithDates: 0
    };
  }

  /**
   * Normalizes URL, strips tracking parameters, and removes hash tags.
   */
  cleanUrl(urlStr) {
    if (!urlStr) return null;
    try {
      const u = new URL(urlStr);
      u.hash = '';
      
      // Strip common analytics and tracking parameters
      const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'source'];
      for (const p of trackingParams) {
        u.searchParams.delete(p);
      }
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
   * Updates dynamic date coverage tracker.
   */
  recordDate(dateStr) {
    if (!dateStr) return;
    try {
      const normalized = String(dateStr).split('T')[0];
      const match = normalized.match(/^(\d{4})-\d{2}-\d{2}$/);
      if (!match) return;

      const year = match[1];
      this.dateCoverage.byYear[year] = (this.dateCoverage.byYear[year] || 0) + 1;
      this.dateCoverage.totalWithDates++;

      if (!this.dateCoverage.earliestDate || normalized < this.dateCoverage.earliestDate) {
        this.dateCoverage.earliestDate = normalized;
      }
      if (!this.dateCoverage.latestDate || normalized > this.dateCoverage.latestDate) {
        this.dateCoverage.latestDate = normalized;
      }
    } catch (e) {}
  }

  /**
   * Resumes crawl state from a saved checkpoint if available.
   */
  resumeFromCheckpoint(jobId) {
    const cp = getSpiderCheckpoint(jobId);
    if (!cp || !cp.state) return false;

    const state = cp.state;
    this.visited = new Set(state.visited || []);
    this.visitedListings = new Set(state.visitedListings || []);
    this.visitedArticles = new Set(state.visitedArticles || []);
    this.discoveryQueue = state.discoveryQueue || [];
    this.articleQueue = state.articleQueue || [];
    this.queue = state.queue || [];
    this.succeeded = state.succeeded || 0;
    this.failed = state.failed || 0;
    this.skippedExisting = state.skippedExisting || 0;
    this.mappedFilenames = new Set(state.mappedFilenames || []);
    this.failedUrls = state.failedUrls || [];

    if (state.dateCoverage) {
      this.dateCoverage = state.dateCoverage;
    }

    return true;
  }

  /**
   * Saves current crawl state to SQLite checkpoint table.
   */
  saveCheckpoint(seedUrl) {
    if (!this.jobId) return;
    saveSpiderCheckpoint(this.jobId, seedUrl, {
      visited: Array.from(this.visited),
      visitedListings: Array.from(this.visitedListings),
      visitedArticles: Array.from(this.visitedArticles),
      discoveryQueue: this.discoveryQueue,
      articleQueue: this.articleQueue,
      queue: this.queue,
      succeeded: this.succeeded,
      failed: this.failed,
      skippedExisting: this.skippedExisting,
      mappedFilenames: Array.from(this.mappedFilenames),
      failedUrls: this.failedUrls,
      dateCoverage: this.dateCoverage,
      topic: this.topic,
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

    const category = this.options.category || this.topic || new URL(seedUrl).hostname;

    if (this.options.resume && this.jobId) {
      const resumed = this.resumeFromCheckpoint(this.jobId);
      if (resumed) {
        onProgress({ 
          type: 'log', 
          message: `🔄 Resumed crawl from checkpoint [${this.jobId}] with ${this.visited.size} visited pages.` 
        });
      }
    }

    // Optional sitemap discovery for historical articles
    if (this.options.sitemap && this.topicProfile.slug) {
      try {
        onProgress({ type: 'log', message: `🗺️ Probing XML sitemaps for historical [${this.topicProfile.slug}] articles...` });
        const sitemaps = await SitemapEngine.discoverSitemapCandidates(seedUrl, this.fetcherPool);
        for (const sm of sitemaps) {
          const sitemapUrls = await SitemapEngine.extractTopicUrlsFromSitemap(sm, this.fetcherPool, {
            topicSlug: this.topicProfile.slug
          });
          for (const item of sitemapUrls) {
            const clean = this.cleanUrl(item.url);
            if (clean && !this.visitedArticles.has(clean) && !this.articleQueue.some(q => q.url === clean)) {
              this.articleQueue.push({ url: clean, depth: 1, type: 'ARTICLE' });
              if (item.lastmod) {
                this.recordDate(item.lastmod);
              }
            }
          }
        }
        if (this.articleQueue.length > 0) {
          onProgress({ 
            type: 'log', 
            message: `🗺️ Sitemaps uncovered ${this.articleQueue.length} historical article candidates!` 
          });
        }
      } catch (smErr) {
        // Sitemap discovery is non-blocking
      }
    }

    // Initialize Frontier with seed URL
    const cleanSeed = this.cleanUrl(seedUrl);
    if (this.discoveryQueue.length === 0 && this.articleQueue.length === 0 && this.queue.length === 0 && !this.visited.has(cleanSeed)) {
      if (this.topicProfile && this.topicProfile.slug) {
        const initialRole = TopicMatcher.classifyPageRole(cleanSeed);
        if (initialRole === 'ARTICLE_PAGE') {
          this.articleQueue.push({ url: cleanSeed, depth: 0, type: 'ARTICLE' });
        } else {
          this.discoveryQueue.push({ url: cleanSeed, depth: 0, type: 'LISTING' });
        }
      } else {
        this.queue.push({ url: cleanSeed, depth: 0 });
      }
    }

    const logMessage = (msg) => {
      onProgress({
        type: 'log',
        message: msg,
        stats: {
          visited: this.visited.size,
          queued: this.discoveryQueue.length + this.articleQueue.length + this.queue.length,
          succeeded: this.succeeded,
          failed: this.failed,
          skippedExisting: this.skippedExisting,
          earliestDate: this.dateCoverage.earliestDate,
          latestDate: this.dateCoverage.latestDate
        }
      });
    };

    const worker = async () => {
      this.activeWorkers++;

      while (
        (this.discoveryQueue.length > 0 || this.articleQueue.length > 0 || this.queue.length > 0) &&
        this.visited.size < this.maxPages &&
        !this.aborted &&
        !this.options.aborted
      ) {
        // Priority: Alternate or drain discoveryQueue to populate articleQueue, then process articleQueue
        let item = null;
        let isListing = false;

        if (this.topicProfile && this.topicProfile.slug) {
          if (this.discoveryQueue.length > 0) {
            item = this.discoveryQueue.shift();
            isListing = true;
          } else if (this.articleQueue.length > 0) {
            item = this.articleQueue.shift();
            isListing = false;
          } else if (this.queue.length > 0) {
            item = this.queue.shift();
            isListing = item.type === 'LISTING';
          }
        } else {
          if (this.queue.length > 0) {
            item = this.queue.shift();
            isListing = false;
          } else if (this.discoveryQueue.length > 0) {
            item = this.discoveryQueue.shift();
            isListing = false;
          } else if (this.articleQueue.length > 0) {
            item = this.articleQueue.shift();
            isListing = false;
          }
        }

        if (!item) continue;

        const targetUrl = this.cleanUrl(item.url);
        if (!targetUrl || !this.isAllowedUrl(targetUrl)) {
          continue;
        }

        if (this.visited.has(targetUrl)) {
          continue;
        }

        // Deduplication: If this is an article and already successfully scraped in SQLite, skip downloading
        const isIncrementalEligible = !!this.options.incremental || (this.topicProfile && Boolean(this.topicProfile.slug));
        if (!isListing && isIncrementalEligible && !this.options.noCache && isUrlScraped(targetUrl)) {
          this.visited.add(targetUrl);
          this.visitedArticles.add(targetUrl);
          this.skippedExisting++;
          logMessage(`⏩ Skipped previously scraped article (Incremental): ${targetUrl}`);
          continue;
        }

        this.visited.add(targetUrl);
        if (isListing) {
          this.visitedListings.add(targetUrl);
        } else {
          this.visitedArticles.add(targetUrl);
        }

        const logType = isListing ? '📑 Listing/Pagination' : '📄 Article';
        logMessage(`🕸️ Spidering [${logType}]: ${targetUrl} (Depth: ${item.depth})`);

        let dbRecord = {
          url: targetUrl,
          scraped_at: new Date().toISOString(),
          status: 'failed',
          selector: this.options.selector || 'auto',
          category
        };

        try {
          // Fetch page using multi-tier FetcherPool (with auto-escalation)
          const response = await this.fetcherPool.fetch(targetUrl, {
            fetcher: this.fetcherType,
            autoEscalate: true,
            noCache: !!this.options.noCache,
            timeout: this.options.timeout ? parseInt(this.options.timeout, 10) : 15000
          });

          // ─── Case 1: Processing a Listing / Pagination Page ───
          if (isListing) {
            // 1. Extract and enqueue all article links matching topic
            const articleLinks = TopicMatcher.extractArticleLinksFromListing(response, this.topicProfile, targetUrl);
            let newArticlesCount = 0;

            for (const aUrl of articleLinks) {
              const cleanA = this.cleanUrl(aUrl);
              if (
                cleanA && 
                this.isAllowedUrl(cleanA) && 
                !this.visitedArticles.has(cleanA) && 
                !this.articleQueue.some(q => q.url === cleanA)
              ) {
                this.articleQueue.push({ url: cleanA, depth: item.depth + 1, type: 'ARTICLE' });
                newArticlesCount++;
              }
            }

            logMessage(`🔍 Listing Page (${targetUrl}): Discovered ${newArticlesCount} new articles.`);

            // 2. Discover and enqueue Next Page
            if (item.depth < this.maxDepth) {
              const nextPageUrl = PaginationEngine.findNextPageUrl(response, targetUrl);
              if (nextPageUrl) {
                const cleanNext = this.cleanUrl(nextPageUrl);
                if (
                  cleanNext &&
                  this.isAllowedUrl(cleanNext) &&
                  !this.visitedListings.has(cleanNext) &&
                  !this.discoveryQueue.some(q => q.url === cleanNext)
                ) {
                  this.discoveryQueue.push({ url: cleanNext, depth: item.depth + 1, type: 'LISTING' });
                  logMessage(`➡️ Pagination: Enqueued Next Page: ${cleanNext}`);
                }
              }

              // 3. Discover all numbered pagination pages
              const numberedPages = PaginationEngine.findNumberedPageUrls(response, targetUrl);
              for (const npUrl of numberedPages) {
                const cleanNp = this.cleanUrl(npUrl);
                if (
                  cleanNp &&
                  this.isAllowedUrl(cleanNp) &&
                  !this.visitedListings.has(cleanNp) &&
                  !this.discoveryQueue.some(q => q.url === cleanNp)
                ) {
                  this.discoveryQueue.push({ url: cleanNp, depth: item.depth + 1, type: 'LISTING' });
                }
              }

              // 4. Discover subcategories under topic
              if (this.topicProfile.slug) {
                const subcats = PaginationEngine.findSubcategoryUrls(response, this.topicProfile.slug, targetUrl);
                for (const sc of subcats) {
                  const cleanSc = this.cleanUrl(sc.url);
                  if (
                    cleanSc &&
                    this.isAllowedUrl(cleanSc) &&
                    !this.visitedListings.has(cleanSc) &&
                    !this.discoveryQueue.some(q => q.url === cleanSc)
                  ) {
                    this.discoveryQueue.push({ url: cleanSc, depth: item.depth + 1, type: 'LISTING' });
                    logMessage(`📁 Subcategory Discovered: [${sc.name}] ${cleanSc}`);
                  }
                }
              }

              // 5. Discover archives
              const archives = PaginationEngine.findArchiveUrls(response, targetUrl, this.topicProfile.slug);
              for (const arcUrl of archives) {
                const cleanArc = this.cleanUrl(arcUrl);
                if (
                  cleanArc &&
                  this.isAllowedUrl(cleanArc) &&
                  !this.visitedListings.has(cleanArc) &&
                  !this.discoveryQueue.some(q => q.url === cleanArc)
                ) {
                  this.discoveryQueue.push({ url: cleanArc, depth: item.depth + 1, type: 'LISTING' });
                }
              }
            }

            // Also support standard link crawling for non-topic spiders
            if (!this.topicProfile.slug && item.depth < this.maxDepth) {
              const links = response.css('a').attribs('href');
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
                  }
                }
              }
            }

          } else {
            // ─── Case 2: Processing an Article Page ───
            const result = response.toMarkdown({
              images: !!this.options.images,
              downloadMedia: !!this.options.downloadMedia,
              selector: this.options.selector
            });

            // Record published date to update dynamic date coverage
            if (result.metadata.date) {
              this.recordDate(result.metadata.date);
            }

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

            // Save markdown file and sidecar JSON
            const finalFilename = await saveMarkdownFile(result.markdown, result.metadata, {
              output: this.outputDir,
              subdir,
              filename: uniqueBaseName,
              noMeta: !!this.options.noMeta,
              category
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
            const dateBadge = result.metadata.date ? ` [${result.metadata.date}]` : '';
            logMessage(`✓ Success:${dateBadge} Scraped ${result.metadata.title || targetUrl} ➔ ${finalFilename}`);

            // If in general spider mode (no topic restriction), follow internal links from the scraped page
            if ((!this.topicProfile || !this.topicProfile.slug) && item.depth < this.maxDepth) {
              const links = response.css('a').attribs('href');
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
                  }
                }
              }
            }
          }

          // Checkpoint periodic save
          if (this.jobId && this.visited.size % 5 === 0) {
            this.saveCheckpoint(seedUrl);
          }

        } catch (err) {
          this.failed++;
          dbRecord.error = err.message;
          this.failedUrls.push({
            url: targetUrl,
            error: err.message,
            timestamp: new Date().toISOString()
          });

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
            queued: this.discoveryQueue.length + this.articleQueue.length + this.queue.length,
            succeeded: this.succeeded,
            failed: this.failed,
            skippedExisting: this.skippedExisting,
            earliestDate: this.dateCoverage.earliestDate,
            latestDate: this.dateCoverage.latestDate
          }
        });

        const hasMoreWork = (this.discoveryQueue.length > 0 || this.articleQueue.length > 0 || this.queue.length > 0);
        if (hasMoreWork && !this.aborted && !this.options.aborted && this.delay > 0) {
          await new Promise(resolve => setTimeout(resolve, this.delay));
        }
      }

      this.activeWorkers--;
    };

    logMessage(`🕸️ Starting website crawl on seed URL: ${seedUrl}${this.topic ? ` [Topic: ${this.topic}]` : ''}`);

    const workerPromises = [];
    const workerCount = Math.min(this.concurrency, Math.max(1, this.maxPages === Infinity ? this.concurrency : this.maxPages));
    for (let i = 0; i < workerCount; i++) {
      workerPromises.push(worker());
    }

    await Promise.all(workerPromises);

    if (this.aborted || this.options.aborted) {
      if (this.jobId) {
        this.saveCheckpoint(seedUrl);
      }
      logMessage(`⏸️ Crawl paused / stopped. Checkpoint preserved for resume (Job ID: ${this.jobId || 'default'}).`);
    } else {
      if (this.jobId) {
        deleteSpiderCheckpoint(this.jobId);
      }
      logMessage(
        `🏁 Crawl complete! ${this.succeeded} pages successfully scraped, ` +
        `${this.skippedExisting} skipped existing, ${this.failed} failed.` +
        (this.dateCoverage.earliestDate ? ` (Coverage: ${this.dateCoverage.earliestDate} ➔ ${this.dateCoverage.latestDate})` : '')
      );
    }

    return { 
      visited: this.visited.size, 
      succeeded: this.succeeded, 
      failed: this.failed,
      skippedExisting: this.skippedExisting,
      dateCoverage: this.dateCoverage,
      failedUrls: this.failedUrls
    };
  }
}
