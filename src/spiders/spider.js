/**
 * Spider base class inspired by Scrapy and Scrapling spiders.
 */
export class Spider {
  constructor(options = {}) {
    this.name = options.name || this.constructor.name;
    this.startUrls = options.startUrls || [];
    this.allowedDomains = options.allowedDomains || [];
    this.customSettings = options.customSettings || {};
  }

  /**
   * Generates initial request targets.
   * @returns {Array<string|{url: string, depth: number, meta?: object}>}
   */
  startRequests() {
    return this.startUrls.map(url => ({ url, depth: 0, meta: {} }));
  }

  /**
   * Main parsing callback. Override this to yield items or follow links.
   * @param {import('../parser/adaptor.js').Response} response 
   * @returns {Promise<{ items?: Array<object>, followUrls?: Array<string> }>}
   */
  async parse(response) {
    const links = response.css('a').attribs('href');
    const result = response.toMarkdown();
    return {
      items: [
        {
          url: response.url,
          title: response.extractMetadata().title,
          markdown: result.markdown,
          metadata: result.metadata
        }
      ],
      followUrls: links
    };
  }

  /**
   * Hook called when an item is scraped.
   */
  async onItemScraped(item) {
    return item;
  }

  /**
   * Hook called on error.
   */
  async onError(error, targetUrl) {
    console.error(`Spider [${this.name}] Error on ${targetUrl}:`, error.message);
  }

  /**
   * Hook called when crawl completes.
   */
  async onComplete(stats) {
    console.log(`Spider [${this.name}] Completed:`, stats);
  }
}
