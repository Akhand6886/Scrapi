import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const testFiles = [
  'test_scrapling_arch.js',
  'test_spider.js',
  'test_optimizations.js',
  'test_category_crawl.js'
];

async function runAll() {
  console.log('🚀 Running all Scrapi test suites...\n');
  for (const file of testFiles) {
    console.log(`▶ Running ${file}...`);
    try {
      const { stdout } = await execAsync(`node ${file}`);
      console.log(stdout);
      console.log(`✅ ${file} passed!\n`);
    } catch (err) {
      console.error(`❌ ${file} failed!`);
      if (err.stdout) console.log(err.stdout);
      if (err.stderr) console.error(err.stderr);
      process.exit(1);
    }
  }
  console.log('🎉 All test suites passed successfully!');
}

runAll();
