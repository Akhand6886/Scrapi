import './src/polyfill.js';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import Database from 'better-sqlite3';
import { initStorage } from './src/storage.js';
import { runSpider } from './src/spider.js';

const execAsync = promisify(exec);

async function runTests() {
  console.log('--- Starting Website Spidering Integration Tests ---\n');

  const testDbDir = './data_test';
  const testOutputDir = './output_test';

  // Clean up previous test runs if any
  await fs.rm(testDbDir, { recursive: true, force: true });
  await fs.rm(testOutputDir, { recursive: true, force: true });

  console.log('1. Initializing Storage...');
  await initStorage(testDbDir, testOutputDir);

  console.log('2. Running Programmatic Spider on example.com (Budget: 3 pages)...');
  
  const stats = await runSpider('https://example.com', {
    output: testOutputDir,
    maxPages: 3,
    concurrency: 1,
    delay: 500
  }, (evt) => {
    if (evt.type === 'log') {
      console.log(`[Spider Log] ${evt.message}`);
    }
  });

  console.log('\nSpider Run Statistics:', stats);
  if (stats.visited === 0 || stats.succeeded === 0) {
    throw new Error('Assertion Failed: Spider failed to visit or scrape any pages!');
  }

  // Check the output subdirectory structure
  const hostDir = path.join(testOutputDir, 'example.com');
  const hostDirExists = await fs.access(hostDir).then(() => true).catch(() => false);
  if (!hostDirExists) {
    throw new Error(`Assertion Failed: Mapped host folder structure was not created at: ${hostDir}`);
  }

  // Assert index.md exists
  const indexPath = path.join(hostDir, 'index.md');
  const indexExists = await fs.access(indexPath).then(() => true).catch(() => false);
  if (!indexExists) {
    throw new Error(`Assertion Failed: index.md file was not saved under subdirectory: ${indexPath}`);
  }
  console.log('✓ File path mapping to subdirectories verified successfully.\n');

  // Verify database scrapes logging
  const db = new Database(path.join(testDbDir, 'scrapes.db'));
  const scrapeRecords = db.prepare("SELECT * FROM scrapes WHERE category = 'example.com'").all();
  db.close();

  console.log(`Found ${scrapeRecords.length} DB records logged under category 'example.com'.`);
  if (scrapeRecords.length === 0) {
    throw new Error('Assertion Failed: Scraped pages were not recorded in the database!');
  }
  
  // Verify relative filename in DB
  const sample = scrapeRecords.find(r => r.filename.includes('index.md'));
  if (!sample) {
    throw new Error('Assertion Failed: index.md row was not logged in scrapes table!');
  }
  console.log(`DB Filename Field: "${sample.filename}"`);
  if (sample.filename.startsWith('/') || sample.filename.includes('./output')) {
    throw new Error(`Assertion Failed: Filename stored in DB should be relative, got: "${sample.filename}"`);
  }
  console.log('✓ Database records and relative path strings verified successfully.\n');

  console.log('3. Testing CLI spider command...');
  
  // Clean output directory for CLI E2E test
  await fs.rm(testOutputDir, { recursive: true, force: true });
  
  const cliCommand = `node src/cli.js spider https://example.com -m 2 -o ${testOutputDir}`;
  console.log(`Executing CLI command: ${cliCommand}`);
  const { stdout, stderr } = await execAsync(cliCommand);
  console.log('CLI output:\n', stdout);
  if (stderr) {
    console.error('CLI stderr:\n', stderr);
  }

  const cliHostDir = path.join(testOutputDir, 'example.com');
  const cliFiles = await fs.readdir(cliHostDir);
  console.log(`CLI Output Directory contents:`, cliFiles);
  if (cliFiles.length === 0) {
    throw new Error('Assertion Failed: CLI spider command did not output any files!');
  }
  console.log('✓ CLI spider command E2E test completed successfully.\n');

  console.log('--- ALL SPIDER TESTS PASSED SUCCESSFULLY! ---');

  // Clean up test directories
  await fs.rm(testDbDir, { recursive: true, force: true });
  await fs.rm(testOutputDir, { recursive: true, force: true });
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
