import ora from 'ora';
import chalk from 'chalk';
import { runParserBenchmarks } from './parser.js';
import { runFetcherBenchmarks } from './fetcher.js';
import { runMemoryBenchmarks } from './memory.js';
import { runStealthBenchmarks } from './stealth.js';
import { printBenchmarkSummary, writeMarkdownReport } from './reporter.js';

/**
 * Runs the Scrapi automated benchmark suite.
 * @param {object} options 
 * @returns {Promise<object>}
 */
export async function runBenchmarks(options = {}) {
  const suite = options.suite || 'all';
  const saveReport = options.report !== undefined ? options.report : true;
  const reportPath = options.reportPath || './docs/benchmarks.md';

  console.log(chalk.bold.cyan('\n🚀 Initializing Scrapi Performance & Anti-Bot Benchmark Suite...\n'));

  const results = {};

  // 1. Parser suite
  if (suite === 'all' || suite === 'parser') {
    const spinner = ora('Benchmarking DOM parser & query engine (CSS, XPath, Adaptive, Markdown)...').start();
    try {
      results.parser = await runParserBenchmarks({ iterations: options.iterations || 500 });
      spinner.succeed(chalk.green('Parser benchmarks completed'));
    } catch (err) {
      spinner.fail(chalk.red(`Parser benchmarks failed: ${err.message}`));
    }
  }

  // 2. Fetcher suite
  if (suite === 'all' || suite === 'fetcher') {
    const spinner = ora('Benchmarking multi-tier fetchers (Cold, 304 Cache, Chromium SPA, Stealth)...').start();
    try {
      results.fetcher = await runFetcherBenchmarks({ runs: options.runs || 5 });
      spinner.succeed(chalk.green('Fetcher benchmarks completed'));
    } catch (err) {
      spinner.fail(chalk.red(`Fetcher benchmarks failed: ${err.message}`));
    }
  }

  // 3. Memory & concurrency suite
  if (suite === 'all' || suite === 'memory') {
    const spinner = ora('Benchmarking memory footprint & concurrency stress test...').start();
    try {
      results.memory = await runMemoryBenchmarks({
        pageCount: options.pageCount || 50,
        concurrency: options.concurrency || 6
      });
      spinner.succeed(chalk.green('Memory stress test completed'));
    } catch (err) {
      spinner.fail(chalk.red(`Memory stress test failed: ${err.message}`));
    }
  }

  // 4. Anti-bot stealth audit
  if (suite === 'all' || suite === 'stealth') {
    const spinner = ora('Auditing anti-bot evasion & Turnstile solver testbed...').start();
    try {
      results.stealth = await runStealthBenchmarks();
      spinner.succeed(chalk.green('Anti-bot evasion audit completed'));
    } catch (err) {
      spinner.fail(chalk.red(`Anti-bot audit failed: ${err.message}`));
    }
  }

  // Terminal output
  printBenchmarkSummary(results);

  // Markdown report output
  if (saveReport) {
    await writeMarkdownReport(results, reportPath);
  }

  return results;
}
