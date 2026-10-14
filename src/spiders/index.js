export { Spider } from './spider.js';
export { CrawlEngine } from './engine.js';

/**
 * High-level helper to run spider.
 */
export async function runSpider(seedUrl, options = {}, onProgress = () => {}) {
  const { CrawlEngine } = await import('./engine.js');
  const engine = new CrawlEngine(options);
  return engine.crawl(seedUrl, onProgress);
}
