/**
 * Scrapi XML Sitemap Discovery & Parsing Engine
 * ──────────────────────────────────────────────
 * Discovers historical XML sitemaps to uncover all available articles
 * from earliest publication up to the current date.
 */

export class SitemapEngine {
  /**
   * Discovers sitemap index URLs from robots.txt or standard conventions.
   * @param {string} seedUrl 
   * @param {import('../fetchers/index.js').FetcherPool} fetcherPool 
   * @returns {Promise<string[]>}
   */
  static async discoverSitemapCandidates(seedUrl, fetcherPool) {
    const candidates = new Set();
    let origin;
    try {
      origin = new URL(seedUrl).origin;
    } catch {
      return [];
    }

    // Standard candidates
    candidates.add(`${origin}/sitemap.xml`);
    candidates.add(`${origin}/sitemap_index.xml`);
    candidates.add(`${origin}/post-sitemap.xml`);

    // Probe robots.txt for Sitemap directives
    try {
      const robotsRes = await fetcherPool.fetch(`${origin}/robots.txt`, {
        fetcher: 'static',
        timeout: 8000
      });
      if (robotsRes && robotsRes.status === 200 && robotsRes.rawHtml) {
        const lines = robotsRes.rawHtml.split('\n');
        for (const line of lines) {
          const match = line.match(/^Sitemap:\s*(https?:\/\/[^\s]+)/i);
          if (match && match[1]) {
            candidates.add(match[1].trim());
          }
        }
      }
    } catch {}

    return Array.from(candidates);
  }

  /**
   * Fetches and parses a sitemap or sitemap index, filtering for topic-related URLs.
   * @param {string} sitemapUrl 
   * @param {import('../fetchers/index.js').FetcherPool} fetcherPool 
   * @param {object} [options]
   * @param {string} [options.topicSlug] - Target topic/category to filter
   * @param {number} [options.maxChildSitemaps=10]
   * @returns {Promise<Array<{ url: string, lastmod: string|null }>>}
   */
  static async extractTopicUrlsFromSitemap(sitemapUrl, fetcherPool, options = {}) {
    const topicSlug = options.topicSlug ? options.topicSlug.toLowerCase() : null;
    const maxChildSitemaps = options.maxChildSitemaps || 10;
    const discoveredArticles = [];
    const visitedSitemaps = new Set();
    const sitemapQueue = [sitemapUrl];

    while (sitemapQueue.length > 0 && visitedSitemaps.size < maxChildSitemaps) {
      const currentSitemap = sitemapQueue.shift();
      if (!currentSitemap || visitedSitemaps.has(currentSitemap)) continue;
      visitedSitemaps.add(currentSitemap);

      try {
        const res = await fetcherPool.fetch(currentSitemap, {
          fetcher: 'static',
          timeout: 12000
        });

        if (!res || res.status !== 200 || !res.rawHtml) continue;

        const xml = res.rawHtml;

        // 1. Check for nested sitemap indices <sitemap><loc>...</loc></sitemap>
        const sitemapLocMatches = xml.matchAll(/<sitemap>[\s\S]*?<loc>(https?:\/\/[^<]+)<\/loc>[\s\S]*?<\/sitemap>/gi);
        for (const match of sitemapLocMatches) {
          const childSitemapUrl = match[1].trim();
          // If topic is specified, prioritize child sitemaps that match post/article/topic
          if (topicSlug) {
            const lowerChild = childSitemapUrl.toLowerCase();
            if (lowerChild.includes(topicSlug) || lowerChild.includes('post') || lowerChild.includes('article') || /\b(20[12]\d)\b/.test(lowerChild)) {
              sitemapQueue.push(childSitemapUrl);
            }
          } else {
            sitemapQueue.push(childSitemapUrl);
          }
        }

        // 2. Check for url entries <url><loc>...</loc><lastmod>...</lastmod></url>
        const urlBlocks = xml.matchAll(/<url>([\s\S]*?)<\/url>/gi);
        for (const block of urlBlocks) {
          const content = block[1];
          const locMatch = content.match(/<loc>(https?:\/\/[^<]+)<\/loc>/i);
          if (!locMatch) continue;

          const url = locMatch[1].trim();
          const lastmodMatch = content.match(/<lastmod>([^<]+)<\/lastmod>/i);
          const lastmod = lastmodMatch ? lastmodMatch[1].trim() : null;

          // Topic filtering: if topicSlug is defined, check if URL matches topic
          if (topicSlug) {
            const lowerUrl = url.toLowerCase();
            if (lowerUrl.includes(`/${topicSlug}/`) || lowerUrl.includes(`/${topicSlug}`) || lowerUrl.includes(`topic=${topicSlug}`) || lowerUrl.includes(`category=${topicSlug}`)) {
              discoveredArticles.push({ url, lastmod });
            }
          } else {
            discoveredArticles.push({ url, lastmod });
          }
        }
      } catch (err) {
        // Sitemap probe failure, continue with other discovery methods
      }
    }

    return discoveredArticles;
  }
}
