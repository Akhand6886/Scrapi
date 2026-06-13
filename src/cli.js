#!/usr/bin/env node

import './polyfill.js';
import fs from 'fs/promises';
import path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { scrapePage } from './scraper.js';
import { 
  initStorage, 
  insertScrape, 
  getAllScrapes, 
  getScrapeById, 
  saveMarkdownFile,
  getProfileByName,
  saveJsonFile
} from './storage.js';
import { extractData, summarizeContent, groupScrapes } from './llm.js';

const program = new Command();

program
  .name('scrapi')
  .description('A terminal-first, developer-grade web scraping tool')
  .version('1.0.0');

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
  const spinner = ora(`Scraping ${chalk.cyan(url)}...`).start();
  let dbRecord = {
    url,
    scraped_at: new Date().toISOString(),
    status: 'failed',
    selector: options.selector || 'auto',
  };

  try {
    // If a profile was specified, load its selectors
    if (options.profile) {
      const profile = getProfileByName(options.profile);
      if (!profile) {
        throw new Error(`Profile "${options.profile}" not found.`);
      }
      spinner.text = `Scraping ${chalk.cyan(url)} using profile "${options.profile}"...`;
      // Use selectors from the profile. For Phase 1 we target the selector, 
      // in Phase 2 picker this gets mapped. Let's merge profile selectors.
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
      noCache: !!options.noCache
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
        noMeta: options.noMeta
      });
      dbRecord.filename = filename;
      spinner.succeed(chalk.green(`Scraped successfully! Saved to ${chalk.cyan(filename)}`));

      // Perform LLM Structured Data Extraction if requested
      if (options.llm && (options.extract || options.schema)) {
        spinner.text = 'Extracting structured JSON...';
        try {
          const schemaName = options.schema || 'custom';
          const instruction = options.extract || 'Extract key data points.';
          
          const jsonData = await extractData(result.markdown, url, schemaName, { instruction });
          
          // Save JSON output if requested
          if (options.outputJson) {
            const jsonFilename = await saveJsonFile(jsonData, filename, { output: options.output });
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

    // Insert into DB unless disabled
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
  .description('Scrape a single URL and save as Markdown + SQLite row')
  .option('-o, --output <dir>', 'Directory to save Markdown files', './output')
  .option('-s, --selector <css>', 'CSS selector to target specific content area', 'auto')
  .option('-f, --filename <name>', 'Custom output filename (no extension)')
  .option('--images', 'Include image alt text in output', false)
  .option('--no-meta', 'Skip YAML frontmatter block', false)
  .option('--print', 'Print to terminal, do not save', false)
  .option('--no-db', 'Skip SQLite database insert', false)
  .option('--timeout <ms>', 'Request timeout in milliseconds', '10000')
  .option('--profile <name>', 'Use saved visual scraper profile name')
  // LLM options
  .option('--llm', 'Enable LLM processing after scrape', false)
  .option('--extract <instruction>', 'Plain-English extraction instruction')
  .option('--summarize', 'Auto-summarize the scraped content', false)
  .option('--schema <name>', 'Use Zod schema (article, product, event, contact)', 'custom')
  .option('--output-json', 'Save structured JSON alongside Markdown', false)
  .option('--no-cache', 'Bypass HTTP cache and force fresh request', false)
  .action(async (url, options) => {
    await initStorage(undefined, options.output);
    await performScrape(url, options);
  });

// Batch command
program
  .command('batch <file>')
  .description('Scrape all URLs listed in a .txt file (one per line)')
  .option('-o, --output <dir>', 'Directory to save Markdown files', './output')
  .option('-s, --selector <css>', 'CSS selector to target specific content area', 'auto')
  .option('--images', 'Include image alt text in output', false)
  .option('--no-meta', 'Skip YAML frontmatter block', false)
  .option('--no-db', 'Skip SQLite database insert', false)
  .option('--timeout <ms>', 'Request timeout in milliseconds', '10000')
  .option('--profile <name>', 'Use saved visual scraper profile name')
  // LLM options
  .option('--llm', 'Enable LLM processing after scrape', false)
  .option('--extract <instruction>', 'Plain-English extraction instruction')
  .option('--summarize', 'Auto-summarize the scraped content', false)
  .option('--schema <name>', 'Use Zod schema (article, product, event, contact)', 'custom')
  .option('--output-json', 'Save structured JSON alongside Markdown', false)
  .option('--no-cache', 'Bypass HTTP cache and force fresh request', false)
  .option('--group', 'Group and categorize batch scraped pages dynamically', false)
  .action(async (file, options) => {
    await initStorage(undefined, options.output);
    const spinner = ora(`Reading URLs from ${file}...`).start();
    
    try {
      const content = await fs.readFile(file, 'utf-8');
      const urls = content.split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('#'));
      
      spinner.succeed(`Found ${urls.length} URLs in batch file.`);
      
      const successfullyScraped = [];
      for (let i = 0; i < urls.length; i++) {
        console.log(chalk.gray(`\n[${i + 1}/${urls.length}]`));
        const res = await performScrape(urls[i], options);
        if (res) {
          successfullyScraped.push(res);
        }
        // Short delay between requests to be polite
        if (i < urls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }

      // Grouping logic if requested
      if (options.llm && options.group && successfullyScraped.length > 0) {
        const groupSpinner = ora('Categorizing and grouping batch scrapes...').start();
        try {
          const groupings = await groupScrapes(successfullyScraped);
          
          const stamp = Math.floor(Date.now() / 1000).toString().slice(-4);
          const baseName = `batch-grouping-${stamp}`;
          
          // Save dynamic JSON groupings map
          const jsonPath = path.join(options.output, `${baseName}.json`);
          await fs.writeFile(jsonPath, JSON.stringify(groupings, null, 2), 'utf-8');
          
          // Write index markdown summary
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
    }
  });

// List command
program
  .command('list')
  .description('Show all past scrapes from the SQLite DB')
  .action(async () => {
    await initStorage();
    try {
      const scrapes = getAllScrapes();
      if (scrapes.length === 0) {
        console.log(chalk.yellow('No scrapes recorded in database.'));
        return;
      }
      
      console.log(chalk.bold.cyan('\nPast Scrapes:'));
      console.log(chalk.bold('ID  | Status  | Word Count | Scraped At           | URL'));
      console.log('----------------------------------------------------------------------');
      scrapes.forEach(s => {
        const idStr = String(s.id).padEnd(3);
        const statusStr = s.status === 'success' ? chalk.green('SUCCESS') : chalk.red('FAILED ');
        const countStr = String(s.word_count || 0).padStart(10);
        const dateStr = s.scraped_at.substring(0, 19).replace('T', ' ');
        console.log(`${idStr} | ${statusStr} | ${countStr} | ${dateStr} | ${s.url}`);
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
      
      // Ensure parent directory of destination exists
      await fs.mkdir(path.dirname(options.dest), { recursive: true });
      await fs.writeFile(options.dest, content, 'utf-8');
      
      console.log(chalk.green(`Successfully exported Scrape ID ${id} to ${chalk.cyan(options.dest)}`));
    } catch (err) {
      handleError(err);
    }
  });

program.parse(process.argv);
