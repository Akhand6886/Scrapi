import readline from 'readline';
import { globalFetcherPool } from '../fetchers/index.js';
import { CrawlEngine } from '../spiders/engine.js';
import { AdaptiveEngine } from '../parser/adaptive.js';
import { initStorage } from '../storage.js';

/**
 * MCP Server implementing Model Context Protocol over stdio JSON-RPC.
 */
export class MCPServer {
  constructor(options = {}) {
    this.options = options;
    this.tools = [
      {
        name: 'scrapi_fetch',
        description: 'Fetch and parse web page into clean, token-efficient Markdown with metadata.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Target website URL' },
            fetcher: { type: 'string', enum: ['static', 'dynamic', 'stealth'], default: 'static', description: 'Fetcher tier to use' },
            selector: { type: 'string', description: 'Optional CSS selector to target main content' },
            images: { type: 'boolean', default: false, description: 'Whether to include image markdown tags' }
          },
          required: ['url']
        }
      },
      {
        name: 'scrapi_extract',
        description: 'Extract specific elements from a URL using CSS selector, XPath, or Regex.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Target website URL' },
            css: { type: 'string', description: 'CSS selector query' },
            xpath: { type: 'string', description: 'XPath query' },
            regex: { type: 'string', description: 'Regex extraction pattern' },
            fetcher: { type: 'string', enum: ['static', 'dynamic', 'stealth'], default: 'static' }
          },
          required: ['url']
        }
      },
      {
        name: 'scrapi_adaptive_query',
        description: 'Execute self-healing adaptive query on a web page using multi-anchor fingerprints.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Target website URL' },
            signature: {
              type: 'object',
              description: 'Element fingerprint (tagName, textSnippet, classes, id)',
              properties: {
                tagName: { type: 'string' },
                textSnippet: { type: 'string' },
                classes: { type: 'array', items: { type: 'string' } },
                id: { type: 'string' }
              }
            }
          },
          required: ['url', 'signature']
        }
      },
      {
        name: 'scrapi_crawl',
        description: 'Crawl a website seed URL to discover and extract connected pages.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Seed website URL' },
            maxPages: { type: 'number', default: 5, description: 'Maximum pages to crawl' },
            depth: { type: 'number', default: 2, description: 'Maximum depth level' }
          },
          required: ['url']
        }
      }
    ];
  }

  async handleToolCall(name, args) {
    switch (name) {
      case 'scrapi_fetch': {
        const response = await globalFetcherPool.fetch(args.url, {
          fetcher: args.fetcher || 'static'
        });
        const result = response.toMarkdown({
          selector: args.selector,
          images: !!args.images
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                url: args.url,
                title: result.metadata.title,
                description: result.metadata.description,
                wordCount: result.metadata.word_count,
                fetcher: response.fetcher,
                timingMs: response.timing,
                markdown: result.markdown
              }, null, 2)
            }
          ]
        };
      }

      case 'scrapi_extract': {
        const response = await globalFetcherPool.fetch(args.url, {
          fetcher: args.fetcher || 'static'
        });

        let results = [];
        if (args.css) {
          results = response.css(args.css).map(el => ({
            tag: el.tag,
            text: el.cleanText,
            attribs: el.attribs,
            html: el.html
          }));
        } else if (args.xpath) {
          results = response.xpath(args.xpath).map(el => ({
            tag: el.tag,
            text: el.cleanText,
            attribs: el.attribs
          }));
        } else if (args.regex) {
          const root = response.findBestContentRoot();
          results = root.re(args.regex);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ url: args.url, count: results.length, matches: results }, null, 2)
            }
          ]
        };
      }

      case 'scrapi_adaptive_query': {
        const response = await globalFetcherPool.fetch(args.url);
        const result = AdaptiveEngine.relocate(response.$, args.signature, args.url);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                found: !!result.element,
                confidence: result.confidence,
                healedSelector: result.healedSelector,
                text: result.element ? result.element.text : null,
                html: result.element ? result.element.html : null
              }, null, 2)
            }
          ]
        };
      }

      case 'scrapi_crawl': {
        const engine = new CrawlEngine({
          maxPages: args.maxPages || 5,
          depth: args.depth || 2,
          concurrency: 1,
          delay: 500,
          noDb: true
        });
        const stats = await engine.crawl(args.url);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ seedUrl: args.url, ...stats }, null, 2)
            }
          ]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  /**
   * Start listening on stdio JSON-RPC.
   */
  start() {
    initStorage().catch(() => {});

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const request = JSON.parse(trimmed);
        const { id, method, params } = request;

        if (method === 'tools/list') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: { tools: this.tools }
          }) + '\n');
          return;
        }

        if (method === 'tools/call') {
          const { name, arguments: toolArgs } = params;
          try {
            const toolResult = await this.handleToolCall(name, toolArgs || {});
            process.stdout.write(JSON.stringify({
              jsonrpc: '2.0',
              id,
              result: toolResult
            }) + '\n');
          } catch (toolErr) {
            process.stdout.write(JSON.stringify({
              jsonrpc: '2.0',
              id,
              error: { code: -32603, message: toolErr.message }
            }) + '\n');
          }
          return;
        }

        if (method === 'initialize') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'scrapi-mcp', version: '2.0.0' }
            }
          }) + '\n');
          return;
        }

        // Default method not found
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` }
        }) + '\n');
      } catch (err) {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' }
        }) + '\n');
      }
    });

    console.error('🚀 Scrapi MCP Server running over stdio (JSON-RPC)');
  }
}
