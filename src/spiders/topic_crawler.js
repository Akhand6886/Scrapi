import { CrawlEngine } from './engine.js';
import { discoverCategories } from '../scraper.js';
import { TopicMatcher } from './topic_matcher.js';

/**
 * TopicCrawler coordinates exhaustive topic-based scraping from earliest available content to current date.
 */
export class TopicCrawler {
  constructor(options = {}) {
    this.options = {
      exhaustive: true,
      maxPages: options.maxPages || Infinity,
      depth: options.depth || Infinity,
      concurrency: options.concurrency || 2,
      delay: options.delay !== undefined ? options.delay : 1000,
      sitemap: options.sitemap !== false,
      ...options
    };
  }

  /**
   * Resolves the primary category/topic entrypoint URL on the target website.
   * @param {string} websiteUrl 
   * @param {string} topicName 
   * @returns {Promise<string>}
   */
  async resolveTopicEntrypoint(websiteUrl, topicName) {
    if (!topicName) return websiteUrl;

    const profile = TopicMatcher.createProfile(topicName);

    // If websiteUrl already points directly to the topic page, use it directly
    if (TopicMatcher.isTopicMatch(websiteUrl, profile)) {
      return websiteUrl;
    }

    try {
      const categories = await discoverCategories(websiteUrl);
      // 1. Direct match on category name
      for (const cat of categories) {
        const catName = (cat.name || '').toLowerCase();
        if (catName === profile.raw.toLowerCase() || catName === profile.slug) {
          return cat.url;
        }
      }

      // 2. Token match on category url or name
      for (const cat of categories) {
        const catName = (cat.name || '').toLowerCase();
        if (TopicMatcher.isTopicMatch(cat.url, profile) || profile.tokens.some(t => catName.includes(t))) {
          return cat.url;
        }
      }
    } catch {}

    // 3. Fallback conventional URL candidates
    const origin = new URL(websiteUrl).origin;
    const candidates = [
      `${origin}/${profile.slug}/`,
      `${origin}/category/${profile.slug}/`,
      `${origin}/topics/${profile.slug}/`,
      `${origin}/section/${profile.slug}/`
    ];

    // Return the first candidate or fall back to websiteUrl
    return candidates[0] || websiteUrl;
  }

  /**
   * Runs the exhaustive topic crawl.
   * @param {string} websiteUrl 
   * @param {string} topicName 
   * @param {function} onProgress 
   * @returns {Promise<object>}
   */
  async crawl(websiteUrl, topicName, onProgress = () => {}) {
    const entrypoint = await this.resolveTopicEntrypoint(websiteUrl, topicName);
    const host = new URL(websiteUrl).hostname;
    const jobId = this.options.jobId || `${host}-${topicName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-topic-crawl`;

    const engine = new CrawlEngine({
      ...this.options,
      topic: topicName,
      category: topicName,
      jobId,
      exhaustive: this.options.exhaustive,
      fallbackSeedUrl: websiteUrl !== entrypoint ? websiteUrl : null
    });

    onProgress({
      type: 'log',
      message: `🚀 Launching Exhaustive Topic Crawl for [${topicName}] on ${websiteUrl}`
    });
    onProgress({
      type: 'log',
      message: `🎯 Target Entrypoint resolved to: ${entrypoint}`
    });

    const results = await engine.crawl(entrypoint, onProgress);

    return {
      topic: topicName,
      seedUrl: websiteUrl,
      entrypoint,
      jobId,
      visited: results.visited,
      succeeded: results.succeeded,
      failed: results.failed,
      skippedExisting: results.skippedExisting,
      dateCoverage: results.dateCoverage,
      failedUrls: results.failedUrls
    };
  }
}

/**
 * High-level helper to execute an exhaustive topic crawl.
 */
export async function runTopicCrawl(websiteUrl, topicName, options = {}, onProgress = () => {}) {
  const crawler = new TopicCrawler(options);
  return crawler.crawl(websiteUrl, topicName, onProgress);
}
