import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const standardTurndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  hr: '---'
});
standardTurndown.use(gfm);

const noImagesTurndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  hr: '---'
});
noImagesTurndown.use(gfm);
noImagesTurndown.addRule('stripImages', {
  filter: 'img',
  replacement: () => ''
});

/**
 * MarkdownEngine handles conversion from HTML / Cheerio selections to Markdown.
 */
export class MarkdownEngine {
  /**
   * Convert an HTML string or Cheerio element to clean Markdown.
   * @param {string|object} htmlOrEl 
   * @param {object} options 
   * @returns {string}
   */
  static convert(htmlOrEl, options = {}) {
    const service = options.images ? standardTurndown : noImagesTurndown;
    let html = '';
    if (typeof htmlOrEl === 'string') {
      html = htmlOrEl;
    } else if (htmlOrEl && typeof htmlOrEl.html === 'function') {
      html = htmlOrEl.html() || '';
    } else if (htmlOrEl && htmlOrEl.$el) {
      html = htmlOrEl.$el.html() || '';
    }
    return service.turndown(html || '');
  }

  /**
   * Generates YAML frontmatter string from a metadata dictionary.
   */
  static generateFrontmatter(metadata = {}) {
    const lines = ['---'];
    if (metadata.title) lines.push(`title: "${String(metadata.title).replace(/"/g, '\\"')}"`);
    if (metadata.url) lines.push(`url: "${metadata.url}"`);
    if (metadata.scraped_at) lines.push(`scraped_at: "${metadata.scraped_at}"`);
    if (metadata.description) lines.push(`description: "${String(metadata.description).replace(/"/g, '\\"')}"`);
    if (metadata.word_count !== undefined) lines.push(`word_count: ${metadata.word_count}`);
    if (metadata.category) lines.push(`category: "${metadata.category}"`);
    if (metadata.fetcher) lines.push(`fetcher: "${metadata.fetcher}"`);
    lines.push('---');
    return lines.join('\n');
  }
}
