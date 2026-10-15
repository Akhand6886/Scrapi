#!/usr/bin/env node

import './polyfill.js';
import fs from 'fs/promises';
import path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as cheerio from 'cheerio';
import { scrapePage, fetchHtml } from './scraper.js';
import { 
  initStorage, 
  insertScrape, 
  getAllScrapes, 
  getScrapeById, 
  saveMarkdownFile,
  getProfileByName,
  saveJsonFile,
  downloadMediaFiles
} from './storage.js';
import { extractData, summarizeContent, groupScrapes } from './llm.js';
import { runSpider } from './spider.js';
import { startShell } from './cli/shell.js';
import { globalFetcherPool } from './fetchers/index.js';
import { runBenchmarks } from './benchmark/index.js';
import { extractEntities } from './parser/cluster_extractor.js';
import { globalBandit } from './trees/bandit.js';

const program = new Command();

program
  .name('scrapi')
  .description('A modular, adaptive, developer-grade web scraping framework')
  .version('2.0.0');

// Helper to log errors nicely
function handleError(error, spinner) {
  if (spinner) {
    spinner.fail(chalk.red('Failed!'));
  }
  console.error(chalk.red(`Error: ${error.message || error}`));
  process.exit(1);
}

// Scrape helper used by scrape command and batch command
async function performScrape(url, options) {
  const fetcherType = options.fetcher || 'auto';
  const spinner = ora(`Scraping ${chalk.cyan(url)} (Tier: ${chalk.yellow(fetcherType.toUpperCase())})...`).start();
  let dbRecord = {
    url,
    scraped_at: new Date().toISOString(),
    status: 'failed',
    selector: options.selector || 'auto',
    category: options.category || null,
  };

  try {
    // If a profile was specified, load its selectors
    if (options.profile) {
      const profile = getProfileByName(options.profile);
      if (!profile) {
        throw new Error(`Profile "${options.profile}" not found.`);
      }
      spinner.text = `Scraping ${chalk.cyan(url)} using profile "${options.profile}"...`;
      if (profile.selectors && profile.selectors.content) {
        options.selector = profile.selectors.content;
      }
      dbRecord.profile_id = profile.id;
      dbRecord.selector = options.selector;
    }

    const result = await scrapePage(url, {
      timeout: options.timeout ? parseInt(options.timeout, 10) : 10000,
      selector: options.selector,
      images: !!options.images,
      downloadMedia: !!options.downloadMedia,
      noCache: !!options.noCache,
      fetcher: options.fetcher || 'auto'
    });

    dbRecord.title = result.metadata.title;
    dbRecord.description = result.metadata.description;
    dbRecord.word_count = result.metadata.word_count;
    dbRecord.status = 'success';

    if (options.print) {
      spinner.succeed(chalk.green('Scrape complete!'));
      console.log('\n--- PRINT OUTPUT ---');
      console.log(result.markdown);
      console.log('--------------------\n');
    } else {
      let finalMarkdown = result.markdown;
      let filename = options.filename;
      
      // Perform LLM Summarization if requested
      if (options.llm && options.summarize) {
        spinner.text = 'Generating LLM summary...';
        try {
          const summary = await summarizeContent(result.markdown);
          finalMarkdown = `## Summary\n${summary}\n\n---\n\n${finalMarkdown}`;
        } catch (llmErr) {
          console.warn(chalk.yellow(`\n⚠️ Summarization failed: ${llmErr.message}. Skipping summary.`));
        }
      }

      filename = await saveMarkdownFile(finalMarkdown, result.metadata, {
        output: options.output,
        filename: filename,
        noMeta: options.noMeta,
        category: options.category
      });
      dbRecord.filename = filename;
      spinner.succeed(chalk.green(`Scraped successfully! Saved to ${chalk.cyan(filename)}`));
      
      if (options.downloadMedia && result.media && result.media.length > 0) {
        spinner.text = `Downloading ${result.media.length} media files...`;
        await downloadMediaFiles(result.media, filename, options.output || './output');
        spinner.succeed(chalk.green(`Downloaded ${result.media.length} media files.`));
      }

      // Perform LLM Structured Data Extraction if requested
      if (options.llm && (options.extract || options.schema)) {
        spinner.text = 'Extracting structured JSON...';
        try {
          const schemaName = options.schema || 'custom';
          const instruction = options.extract || 'Extract key data points.';
          
          const jsonData = await extractData(result.markdown, url, schemaName, { instruction });
          
          if (options.outputJson) {
            const jsonFilename = await saveJsonFile(jsonData, filename, { 
              output: options.output,
              category: options.category
            });
            console.log(chalk.green(`✓ Saved structured data to ${chalk.cyan(jsonFilename)}`));
          } else {
            console.log(chalk.bold.cyan('\nExtracted JSON:'));
            console.log(JSON.stringify(jsonData, null, 2));
          }

          dbRecord.llm_processed = true;
          dbRecord.schema_used = schemaName;
        } catch (llmErr) {
          console.warn(chalk.yellow(`\n⚠️ Structured extraction failed: ${llmErr.message}`));
        }
      }
    }

    if (!options.noDb) {
      insertScrape(dbRecord);
    }
    return { url, title: dbRecord.title || url, markdown: result.markdown };
  } catch (err) {
    dbRecord.error = err.message;
    if (!options.noDb) {
      try {
        insertScrape(dbRecord);
      } catch (dbErr) {
        console.error(chalk.red(`Failed to log failure to DB: ${dbErr.message}`));
      }
    }
    spinner.fail(chalk.red(`Failed to scrape ${url}`));
    console.error(chalk.red(`Reason: ${err.message}`));
    return null;
  }
}

// Scrape command
program
  .command('scrape <url>')
  .description('Scrape a single URL with multi-tier fetchers and save as Markdown')
  .option('-f, --fetcher <type>', 'Fetcher tier: auto (Decision Tree), static, dynamic (Playwright), or stealth (Anti-bot)', 'auto')
  .option('-o, --output <dir>', 'Directory to save Markdown files', './output')
  .option('-s, --selector <css>', 'CSS selector to target specific content area', 'auto')
  .option('--filename <name>', 'Custom output filename (no extension)')
  .option('--category <name>', 'Category name to tag scrape and create subfolder')
  .option('--images', 'Include image alt text in output', false)
  .option('--download-media', 'Download images to local media directory', false)
  .option('--no-meta', 'Skip YAML frontmatter block', false)
  .option('--print', 'Print to terminal, do not save', false)
  .option('--no-db', 'Skip SQLite database insert', false)
  .option('--timeout <ms>', 'Request timeout in milliseconds', '10000')
  .option('--profile <name>', 'Use saved visual scraper profile name')
  .option('--llm', 'Enable LLM processing after scrape', false)
  .option('--extract <instruction>', 'Plain-English extraction instruction')
  .option('--summarize', 'Auto-summarize the scraped content', false)
  .option('--schema <name>', 'Use Zod schema (article, product, event, contact)', 'custom')
  .option('--output-json', 'Save structured JSON alongside Markdown', false)
  .option('--no-cache', 'Bypass HTTP cache and force fresh request', false)
  .action(async (url, options) => {
    try {
      await initStorage(undefined, options.output);
      await performScrape(url, options);
    } finally {
      await globalFetcherPool.close();
    }
  });

// Shell command (Interactive REPL)
program
  .command('shell [url]')
  .description('Open an interactive Scrapi REPL console to test selectors and fetchers in real time')
  .option('-f, --fetcher <type>', 'Fetcher tier: auto (Decision Tree), static, dynamic, or stealth', 'auto')
  .action(async (url, options) => {
    await initStorage();
    await startShell(url, options);
  });

// MCP Server command
program
  .command('mcp')
  .description('Start Model Context Protocol (MCP) server for AI agent integration (Cursor/Claude)')
  .action(async () => {
    const server = new MCPServer();
    server.start();
  });

// Serve command (Web Dashboard)
program
  .command('serve')
  .description('Start Scrapi web dashboard and visual selector picker server')
  .option('-p, --port <number>', 'Port number to run UI server on', '3000')
  .action(async (options) => {
    const port = parseInt(options.port, 10) || 3000;
    process.env.PORT = String(port);
    console.log(chalk.bold.cyan(`Starting Scrapi Web Dashboard on http://localhost:${port}...`));
    await import('./ui/server.js');
  });

// Batch command
program
  .command('batch <file>')
  .description('Scrape all URLs listed in a .txt file (one per line)')
  .option('-f, --fetcher <type>', 'Fetcher tier: auto (Decision Tree), static, dynamic, or stealth', 'auto')
  .option('-o, --output <dir>', 'Directory to save Markdown files', './output')
  .option('-s, --selector <css>', 'CSS selector to target specific content area', 'auto')
  .option('--category <name>', 'Category name to tag scrapes and create subfolder')
  .option('--images', 'Include image alt text in output', false)
  .option('--no-meta', 'Skip YAML frontmatter block', false)
  .option('--no-db', 'Skip SQLite database insert', false)
  .option('--timeout <ms>', 'Request timeout in milliseconds', '10000')
  .option('--profile <name>', 'Use saved visual scraper profile name')
  .option('--llm', 'Enable LLM processing after scrape', false)
  .option('--extract <instruction>', 'Plain-English extraction instruction')
  .option('--summarize', 'Auto-summarize the scraped content', false)
  .option('--schema <name>', 'Use Zod schema (article, product, event, contact)', 'custom')
  .option('--output-json', 'Save structured JSON alongside Markdown', false)
  .option('--no-cache', 'Bypass HTTP cache and force fresh request', false)
  .option('--group', 'Group and categorize batch scraped pages dynamically', false)
  .option('-c, --concurrency <number>', 'Number of parallel scraper workers', '2')
  .action(async (file, options) => {
    await initStorage(undefined, options.output);
    const spinner = ora(`Reading URLs from ${file}...`).start();
    
    try {
      const content = await fs.readFile(file, 'utf-8');
      const urls = content.split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('#'));
      
      const concurrency = Math.max(1, parseInt(options.concurrency, 10) || 2);
      spinner.succeed(`Found ${urls.length} URLs in batch file. Starting batch run (Concurrency: ${concurrency}).`);
      
      const successfullyScraped = [];
      const queue = [...urls];
      let urlIndex = 0;

      const runWorker = async () => {
        while (queue.length > 0) {
          const url = queue.shift();
          const currentIdx = ++urlIndex;
          console.log(chalk.gray(`\n[Worker] [${currentIdx}/${urls.length}] Starting scrape of: ${url}`));
          
          const res = await performScrape(url, options);
          if (res) {
            successfullyScraped.push(res);
          }
          
          if (queue.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }
      };

      const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => runWorker());
      await Promise.all(workers);

      if (options.llm && options.group && successfullyScraped.length > 0) {
        const groupSpinner = ora('Categorizing and grouping batch scrapes...').start();
        try {
          const groupings = await groupScrapes(successfullyScraped);
          
          const stamp = Math.floor(Date.now() / 1000).toString().slice(-4);
          const baseName = `batch-grouping-${stamp}`;
          
          const jsonPath = path.join(options.output, `${baseName}.json`);
          await fs.writeFile(jsonPath, JSON.stringify(groupings, null, 2), 'utf-8');
          
          let indexMd = `# Batch Scrape Grouping Index\n\n`;
          indexMd += `> Created at: ${new Date().toISOString()}\n\n`;
          
          for (const [category, itemUrls] of Object.entries(groupings)) {
            indexMd += `## ${category}\n`;
            itemUrls.forEach(u => {
              const item = successfullyScraped.find(s => s.url === u);
              const title = item ? item.title : u;
              indexMd += `- [${title}](${u})\n`;
            });
            indexMd += `\n`;
          }
          
          const mdPath = path.join(options.output, `${baseName}.md`);
          await fs.writeFile(mdPath, indexMd, 'utf-8');
          
          groupSpinner.succeed(chalk.green(`Grouped scrapes into ${chalk.cyan(baseName + '.md')} and ${chalk.cyan(baseName + '.json')}`));
        } catch (groupErr) {
          groupSpinner.fail(chalk.red(`Failed to group batch scrapes: ${groupErr.message}`));
        }
      }
    } catch (err) {
      handleError(err, spinner);
    } finally {
      await globalFetcherPool.close();
    }
  });

// List command
program
  .command('list')
  .description('Show all past scrapes from the SQLite DB')
  .option('--category <name>', 'Filter history by category name')
  .action(async (options) => {
    await initStorage();
    try {
      const scrapes = getAllScrapes(options.category);
      if (scrapes.length === 0) {
        console.log(chalk.yellow('No scrapes recorded in database.'));
        return;
      }
      
      console.log(chalk.bold.cyan('\nPast Scrapes:'));
      console.log(chalk.bold('ID  | Status  | Word Count | Scraped At           | Category   | URL'));
      console.log('-----------------------------------------------------------------------------------------');
      scrapes.forEach(s => {
        const idStr = String(s.id).padEnd(3);
        const statusStr = s.status === 'success' ? chalk.green('SUCCESS') : chalk.red('FAILED ');
        const countStr = String(s.word_count || 0).padStart(10);
        const dateStr = s.scraped_at.substring(0, 19).replace('T', ' ');
        const catStr = String(s.category || '').padEnd(10);
        console.log(`${idStr} | ${statusStr} | ${countStr} | ${dateStr} | ${catStr} | ${s.url}`);
      });
      console.log('');
    } catch (err) {
      handleError(err);
    }
  });

// Show command
program
  .command('show <id>')
  .description('Print the Markdown content of a past scrape by ID')
  .option('-o, --output <dir>', 'Directory containing Markdown files', './output')
  .action(async (id, options) => {
    await initStorage(options.dbDir, options.output);
    try {
      const scrape = getScrapeById(parseInt(id, 10));
      if (!scrape) {
        throw new Error(`Scrape record ID ${id} not found.`);
      }
      if (scrape.status !== 'success' || !scrape.filename) {
        throw new Error(`Scrape ID ${id} has status "${scrape.status}" and no file associated.`);
      }

      const filePath = path.join(options.output, scrape.filename);
      const markdown = await fs.readFile(filePath, 'utf-8');
      
      console.log(`\n${chalk.cyan(`--- ${scrape.filename} ---`)}`);
      console.log(markdown);
      console.log(chalk.cyan('----------------------------------------\n'));
    } catch (err) {
      handleError(err);
    }
  });

// Export command
program
  .command('export <id>')
  .description('Re-export a scrape to a new Markdown file')
  .option('-s, --src-dir <dir>', 'Source directory containing Markdown files', './output')
  .requiredOption('-d, --dest <file>', 'Destination filepath to write Markdown to')
  .action(async (id, options) => {
    await initStorage();
    try {
      const scrape = getScrapeById(parseInt(id, 10));
      if (!scrape) {
        throw new Error(`Scrape record ID ${id} not found.`);
      }
      if (scrape.status !== 'success' || !scrape.filename) {
        throw new Error(`Scrape ID ${id} is not exportable.`);
      }

      const srcPath = path.join(options.srcDir, scrape.filename);
      const content = await fs.readFile(srcPath, 'utf-8');
      
      await fs.mkdir(path.dirname(options.dest), { recursive: true });
      await fs.writeFile(options.dest, content, 'utf-8');
      
      console.log(chalk.green(`Successfully exported Scrape ID ${id} to ${chalk.cyan(options.dest)}`));
    } catch (err) {
      handleError(err);
    }
  });

// Discover command
program
  .command('discover <url>')
  .description('Extract and list all links matching a CSS selector from a page')
  .requiredOption('-s, --selector <css>', 'CSS selector targeting anchor links')
  .option('-o, --output <file>', 'Save discovered URLs list to a text file (one per line)')
  .option('--no-cache', 'Bypass HTTP cache and force fresh request', false)
  .action(async (url, options) => {
    await initStorage();
    const spinner = ora(`Fetching page: ${chalk.cyan(url)}...`).start();
    try {
      const html = await fetchHtml(url, { noCache: !!options.noCache });
      spinner.text = 'Parsing links...';
      
      const $ = cheerio.load(html);
      const discoveredUrls = new Set();
      
      $(options.selector).each((_, elem) => {
        let href = $(elem).attr('href');
        if (!href) {
          const parentAnchor = $(elem).closest('a');
          if (parentAnchor.length > 0) {
            href = parentAnchor.attr('href');
          }
        }
        
        if (href) {
          try {
            if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
              return;
            }
            const absoluteUrl = new URL(href, url).href;
            discoveredUrls.add(absoluteUrl);
          } catch (e) {}
        }
      });
      
      const resultList = Array.from(discoveredUrls);
      spinner.succeed(`Extracted ${chalk.green(resultList.length)} unique links using selector "${options.selector}":\n`);
      
      if (resultList.length === 0) {
        console.log(chalk.yellow('No links found matching that selector.'));
        return;
      }
      
      resultList.forEach(u => console.log(chalk.gray(`- ${u}`)));
      console.log('');
      
      if (options.output) {
        await fs.mkdir(path.dirname(options.output), { recursive: true });
        const fileContent = resultList.join('\n') + '\n';
        await fs.writeFile(options.output, fileContent, 'utf-8');
        console.log(chalk.green(`✓ Successfully saved links list to ${chalk.cyan(options.output)}`));
      }
    } catch (err) {
      handleError(err, spinner);
    }
  });

// Crawl command
program
  .command('crawl <url>')
  .description('Crawl a list/index page, discover nested links, and scrape them concurrently under a category')
  .requiredOption('-s, --selector <css>', 'CSS selector targeting anchor links on list page')
  .option('-f, --fetcher <type>', 'Fetcher tier: auto (Decision Tree), static, dynamic, or stealth', 'auto')
  .option('-o, --output <dir>', 'Directory to save Markdown files', './output')
  .option('--category <name>', 'Category name to tag scrapes and create subfolder')
  .option('-c, --concurrency <number>', 'Number of parallel scraper workers', '2')
  .option('--images', 'Include image alt text in output', false)
  .option('--download-media', 'Download images to local media directory', false)
  .option('--no-meta', 'Skip YAML frontmatter block', false)
  .option('--no-db', 'Skip SQLite database insert', false)
  .option('--timeout <ms>', 'Request timeout in milliseconds', '10000')
  .option('--profile <name>', 'Use saved visual scraper profile name')
  .option('--delay <ms>', 'Polite rate-limiting delay between requests in milliseconds', '1500')
  .option('--llm', 'Enable LLM processing after scrape', false)
  .option('--extract <instruction>', 'Plain-English extraction instruction')
  .option('--summarize', 'Auto-summarize the scraped content', false)
  .option('--schema <name>', 'Use Zod schema (article, product, event, contact)', 'custom')
  .option('--output-json', 'Save structured JSON alongside Markdown', false)
  .option('--no-cache', 'Bypass HTTP cache and force fresh request', false)
  .action(async (url, options) => {
    await initStorage(undefined, options.output);
    const spinner = ora(`Fetching list page: ${chalk.cyan(url)}...`).start();
    try {
      const html = await fetchHtml(url, { noCache: !!options.noCache, fetcher: options.fetcher });
      spinner.text = 'Discovering links on list page...';
      
      const $ = cheerio.load(html);
      const discoveredUrls = new Set();
      
      $(options.selector).each((_, elem) => {
        let href = $(elem).attr('href');
        if (!href) {
          const parentAnchor = $(elem).closest('a');
          if (parentAnchor.length > 0) {
            href = parentAnchor.attr('href');
          }
        }
        
        if (href) {
          try {
            if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
              return;
            }
            const absoluteUrl = new URL(href, url).href;
            discoveredUrls.add(absoluteUrl);
          } catch (e) {}
        }
      });
      
      const urls = Array.from(discoveredUrls);
      if (urls.length === 0) {
        spinner.fail(chalk.yellow('No links found matching list page selector.'));
        return;
      }
      
      const concurrency = Math.max(1, parseInt(options.concurrency, 10) || 2);
      spinner.succeed(`Discovered ${chalk.green(urls.length)} links. Starting concurrent scrapes (Concurrency: ${concurrency}).`);
      
      const successfullyScraped = [];
      const queue = [...urls];
      let urlIndex = 0;

      const scrapeOptions = {
        ...options,
        selector: 'auto'
      };

      const runWorker = async () => {
        while (queue.length > 0) {
          const targetUrl = queue.shift();
          const currentIdx = ++urlIndex;
          console.log(chalk.gray(`\n[Worker] [${currentIdx}/${urls.length}] Crawling subpage: ${targetUrl}`));
          
          const res = await performScrape(targetUrl, scrapeOptions);
          if (res) {
            successfullyScraped.push(res);
          }
          
          const delayVal = options.delay !== undefined ? parseInt(options.delay, 10) : 1500;
          if (queue.length > 0 && delayVal > 0) {
            await new Promise(resolve => setTimeout(resolve, delayVal));
          }
        }
      };

      const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => runWorker());
      await Promise.all(workers);
      
      console.log(chalk.bold.green(`\n✓ Crawl completed! Successfully scraped ${successfullyScraped.length}/${urls.length} pages.`));
    } catch (err) {
      handleError(err, spinner);
    } finally {
      await globalFetcherPool.close();
    }
  });

// Spider command
program
  .command('spider <url>')
  .description('Recursively crawl and scrape an entire website under the same origin')
  .option('-f, --fetcher <type>', 'Fetcher tier: auto (Decision Tree), static, dynamic, or stealth', 'auto')
  .option('-o, --output <dir>', 'Directory to save Markdown files', './output')
  .option('-c, --concurrency <number>', 'Number of parallel scraper workers', '2')
  .option('-d, --depth <number>', 'Maximum link crawling depth', 'Infinity')
  .option('-m, --max-pages <number>', 'Maximum page scraping budget limit', '100')
  .option('--delay <ms>', 'Polite rate-limiting delay between requests in milliseconds', '1500')
  .option('--category <name>', 'Category tag for DB entries (defaults to host name)')
  .option('--images', 'Include image alt text in output', false)
  .option('--download-media', 'Download images to local media directory', false)
  .option('--no-meta', 'Skip YAML frontmatter block', false)
  .option('--no-db', 'Skip SQLite database insert', false)
  .option('--timeout <ms>', 'Request timeout in milliseconds', '10000')
  .option('--no-cache', 'Bypass HTTP cache and force fresh request', false)
  .option('--resume <jobId>', 'Resume crawl from a saved checkpoint ID')
  .action(async (url, options) => {
    await initStorage(undefined, options.output);
    const hostName = new URL(url).hostname;
    const spiderOptions = {
      ...options,
      depth: options.depth === 'Infinity' ? Infinity : parseInt(options.depth, 10),
      maxPages: parseInt(options.maxPages, 10),
      concurrency: parseInt(options.concurrency, 10),
      delay: parseInt(options.delay, 10),
      category: options.category || hostName,
      jobId: options.resume || `${hostName}-spider`
    };

    const spinner = ora(`Initializing Spider on ${chalk.cyan(url)}...`).start();

    try {
      spinner.stop();
      console.log(chalk.bold.cyan('\n🕸️ Starting recursive site crawl...'));
      
      const stats = await runSpider(url, spiderOptions, (evt) => {
        if (evt.type === 'log') {
          console.log(chalk.gray(evt.message));
        }
      });

      console.log(chalk.bold.green(`\n✓ Crawl completed successfully!`));
      console.log(chalk.cyan(`   Total Visited Pages:  ${stats.visited}`));
      console.log(chalk.green(`   Successful Scrapes:   ${stats.succeeded}`));
      console.log(chalk.red(`   Failed/Error Pages:   ${stats.failed}\n`));
    } catch (err) {
      handleError(err, spinner);
    } finally {
      await globalFetcherPool.close();
    }
  });

// Benchmark command
program
  .command('benchmark')
  .description('Run automated performance, throughput, and anti-bot evasion benchmark suite')
  .option('-s, --suite <name>', 'Benchmark suite to run: all, parser, fetcher, memory, or stealth', 'all')
  .option('--no-report', 'Skip writing docs/benchmarks.md report document', false)
  .option('-i, --iterations <number>', 'Number of parser iterations', '500')
  .action(async (options) => {
    try {
      await runBenchmarks({
        suite: options.suite,
        report: options.report !== false,
        iterations: parseInt(options.iterations, 10) || 500
      });
    } catch (err) {
      console.error(chalk.red(`Benchmark failed: ${err.message}`));
      process.exit(1);
    }
  });

// Unsupervised Entity Extraction Command
program
  .command('entities <url>')
  .description('Unsupervised structural extraction of repeating collections (products, cards, listings)')
  .option('-f, --fetcher <type>', 'Fetcher engine: auto, static, dynamic, stealth', 'auto')
  .option('-l, --limit <number>', 'Maximum entities to return', '50')
  .option('-j, --json', 'Output raw JSON result', false)
  .action(async (url, options) => {
    const spinner = ora(`Mining entities from ${chalk.cyan(url)}...`).start();
    try {
      await initStorage();
      const response = await globalFetcherPool.fetch(url, { fetcher: options.fetcher });
      const $ = cheerio.load(response.rawHtml || response.html || '');
      const limit = parseInt(options.limit, 10) || 50;

      const result = extractEntities($, { baseUrl: url, limit });
      spinner.succeed(chalk.green(`Extracted ${result.entities.length} items (Archetype: ${result.detectedType.toUpperCase()}, Confidence: ${Math.round(result.confidence * 100)}%)`));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(chalk.bold(`\n📦 Discovered Repeating Entities (${result.detectedType.toUpperCase()}):`));
        result.entities.forEach((item, idx) => {
          console.log(chalk.cyan(`\n  [${idx + 1}] ${item.title || '(Untitled item)'}`));
          if (item.price) console.log(chalk.green(`      Price: ${item.price}`));
          if (item.url) console.log(chalk.gray(`      URL:   ${item.url}`));
          if (item.badge) console.log(chalk.yellow(`      Badge: [${item.badge}]`));
          if (item.date) console.log(chalk.magenta(`      Date:  ${item.date}`));
          if (item.description) console.log(chalk.white(`      Desc:  ${item.description.slice(0, 100)}...`));
        });
      }
    } catch (err) {
      handleError(err, spinner);
    } finally {
      await globalFetcherPool.close();
    }
  });

// Thompson Sampling Bandit Inspection Command
program
  .command('bandit [domain]')
  .description('Inspect online reinforcement learning domain defense distributions & bypass status')
  .action(async (domain) => {
    try {
      await initStorage();
      if (domain) {
        const stats = globalBandit.getDomainStats(domain);
        console.log(chalk.bold(`\n🎰 Bayesian Thompson Sampling Priors for: ${chalk.cyan(stats.domain)}`));
        console.log(`   Total Scrape Trials: ${stats.totalTrials}`);
        console.log(`   Static Tier  : E[X] = ${(stats.arms.static.expectedValue * 100).toFixed(1)}% (α=${stats.arms.static.alpha}, β=${stats.arms.static.beta})`);
        console.log(`   Dynamic Tier : E[X] = ${(stats.arms.dynamic.expectedValue * 100).toFixed(1)}% (α=${stats.arms.dynamic.alpha}, β=${stats.arms.dynamic.beta})`);
        console.log(`   Stealth Tier : E[X] = ${(stats.arms.stealth.expectedValue * 100).toFixed(1)}% (α=${stats.arms.stealth.alpha}, β=${stats.arms.stealth.beta})`);
        if (stats.bypass.bypass) {
          console.log(chalk.green(`   ⚡ Probe Bypass Active: Directly routes to ${stats.bypass.tier.toUpperCase()} (Confidence: ${(stats.bypass.confidence * 100).toFixed(1)}%)`));
        } else {
          console.log(chalk.yellow(`   Standard Probing Active (Zero bypass)`));
        }
      } else {
        const all = globalBandit.getAllStats();
        console.log(chalk.bold(`\n🎰 Learned Domain Prior Distributions (${all.length} domains tracked):`));
        all.forEach(s => {
          const bypassTag = s.bypass.bypass ? chalk.green(`[BYPASS ➔ ${s.bypass.tier.toUpperCase()}]`) : chalk.gray('[PROBE]');
          console.log(`  • ${chalk.cyan(s.domain.padEnd(25))} ${bypassTag} Trials: ${s.totalTrials} | Static: ${(s.arms.static.expectedValue * 100).toFixed(0)}% | Stealth: ${(s.arms.stealth.expectedValue * 100).toFixed(0)}%`);
        });
      }
    } catch (err) {
      console.error(chalk.red(`Bandit inspection failed: ${err.message}`));
    }
  });

program.parse(process.argv);

