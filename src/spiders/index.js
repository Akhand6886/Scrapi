export { Spider } from './spider.js';
export { CrawlEngine } from './engine.js';
export { TopicCrawler, runTopicCrawl } from './topic_crawler.js';
export { PaginationEngine } from './pagination.js';
export { SitemapEngine } from './sitemap.js';
export { TopicMatcher } from './topic_matcher.js';

/**
 * High-level helper to run spider.
 */
export async function runSpider(seedUrl, options = {}, onProgress = () => {}) {
  const { CrawlEngine } = await import('./engine.js');
  const engine = new CrawlEngine(options);
  return engine.crawl(seedUrl, onProgress);
}
