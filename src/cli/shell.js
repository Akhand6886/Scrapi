import repl from 'repl';
import chalk from 'chalk';
import * as scrapi from '../index.js';
import { globalFetcherPool, fetch, fetchDynamic, fetchStealth } from '../fetchers/index.js';
import { AdaptiveEngine } from '../parser/adaptive.js';
import { MarkdownEngine } from '../parser/markdown.js';

/**
 * Launch Scrapi Interactive REPL Shell.
 * @param {string} [initialUrl] 
 * @param {object} [options] 
 */
export async function startShell(initialUrl, options = {}) {
  console.log(chalk.bold.cyan('\n🚀 Welcome to Scrapi Interactive Shell (Scrapling-Engine v2.0)'));
  console.log(chalk.gray('Available globals: scrapi, fetch, fetchDynamic, fetchStealth, response, $, AdaptiveEngine, MarkdownEngine\n'));

  let initialResponse = null;
  if (initialUrl) {
    console.log(chalk.yellow(`Fetching initial URL: ${initialUrl}...`));
    try {
      initialResponse = await globalFetcherPool.fetch(initialUrl, options);
      console.log(chalk.green(`✓ Fetched ${initialUrl} (Status ${initialResponse.status}, ${initialResponse.timing}ms)`));
      console.log(chalk.gray(`Try: response.css('h1').texts, response.xpath('//a').cleanTexts, response.toMarkdown()\n`));
    } catch (err) {
      console.error(chalk.red(`Failed to fetch initial URL: ${err.message}`));
    }
  }

  const r = repl.start({
    prompt: chalk.magenta('scrapi > '),
    useColors: true,
    preview: true
  });

  r.context.scrapi = scrapi;
  r.context.fetch = fetch;
  r.context.fetchDynamic = fetchDynamic;
  r.context.fetchStealth = fetchStealth;
  r.context.AdaptiveEngine = AdaptiveEngine;
  r.context.MarkdownEngine = MarkdownEngine;
  r.context.response = initialResponse;
  r.context.$ = initialResponse ? initialResponse.$ : null;

  r.on('exit', () => {
    console.log(chalk.yellow('\nExiting Scrapi Shell. Happy Scraping!'));
    process.exit(0);
  });
}
