import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import Database from 'better-sqlite3';
import { 
  initStorage, 
  insertScrape, 
  getAllScrapes, 
  saveMarkdownFile, 
  saveJsonFile 
} from './src/storage.js';

const execAsync = promisify(exec);

async function runTests() {
  console.log('--- Starting Crawl & Category Scraping Tests ---\n');

  const testDbDir = './data_test';
  const testOutputDir = './output_test';

  // Clean up previous test runs if any
  await fs.rm(testDbDir, { recursive: true, force: true });
  await fs.rm(testOutputDir, { recursive: true, force: true });

  console.log('1. Testing Storage Initialization and Migration...');
  await initStorage(testDbDir, testOutputDir);

  // Assert category column exists
  const db = new Database(path.join(testDbDir, 'scrapes.db'));
  const columns = db.prepare("PRAGMA table_info(scrapes)").all();
  const hasCategory = columns.some(col => col.name === 'category');
  db.close();
  if (!hasCategory) {
    throw new Error('Assertion Failed: category column missing from scrapes table!');
  }
  console.log('✓ Category column successfully verified in SQLite table schema.\n');

  console.log('2. Testing Category Tag Insertion & Retrieval...');
  const record1 = {
    url: 'https://example.com/blog-post-1',
    title: 'Blog Post 1',
    description: 'First test post',
    filename: 'blog-post-1.md',
    word_count: 120,
    scraped_at: new Date().toISOString(),
    selector: 'auto',
    status: 'success',
    category: 'blog'
  };
  const record2 = {
    url: 'https://example.com/news-post-1',
    title: 'News Post 1',
    description: 'First news post',
    filename: 'news-post-1.md',
    word_count: 150,
    scraped_at: new Date().toISOString(),
    selector: 'auto',
    status: 'success',
    category: 'news'
  };

  insertScrape(record1);
  insertScrape(record2);

  const blogScrapes = getAllScrapes('blog');
  if (blogScrapes.length !== 1 || blogScrapes[0].url !== 'https://example.com/blog-post-1') {
    throw new Error('Assertion Failed: category-filtered query failed to retrieve correct records!');
  }
  console.log('✓ Category query filtering verified successfully.\n');

  console.log('3. Testing File Saving in Category Subfolders...');
  const metadata = {
    title: 'Test Page',
    url: 'https://example.com/test',
    scraped_at: new Date().toISOString(),
    word_count: 50
  };

  const mdFilename = await saveMarkdownFile('# Test Markdown Content', metadata, {
    output: testOutputDir,
    category: 'custom-cat'
  });

  const expectedMdPath = path.join(testOutputDir, 'custom-cat', mdFilename);
  const mdExists = await fs.access(expectedMdPath).then(() => true).catch(() => false);
  if (!mdExists) {
    throw new Error(`Assertion Failed: markdown file was not saved under the category subfolder: ${expectedMdPath}`);
  }

  const jsonFilename = await saveJsonFile({ key: 'val' }, mdFilename, {
    output: testOutputDir,
    category: 'custom-cat'
  });

  const expectedJsonPath = path.join(testOutputDir, 'custom-cat', jsonFilename);
  const jsonExists = await fs.access(expectedJsonPath).then(() => true).catch(() => false);
  if (!jsonExists) {
    throw new Error(`Assertion Failed: json file was not saved under the category subfolder: ${expectedJsonPath}`);
  }
  console.log('✓ File routing to category-specific subfolders verified successfully.\n');

  console.log('4. Testing CLI crawl Subcommand (End-to-End Integration)...');
  
  // Clean output directory for CLI test
  await fs.rm(testOutputDir, { recursive: true, force: true });

  // Run a crawl on example.com targeting anchor links, saving to output_test under category 'cli-test'
  const cliCommand = `node src/cli.js crawl https://example.com -s "a" --category cli-test -o ${testOutputDir}`;
  console.log(`Executing CLI command: ${cliCommand}`);
  
  const { stdout, stderr } = await execAsync(cliCommand);
  console.log('CLI stdout:\n', stdout);
  if (stderr) {
    console.error('CLI stderr:\n', stderr);
  }

  // Check if directory output_test/cli-test has been created and contains files
  const categorySubdir = path.join(testOutputDir, 'cli-test');
  const dirExists = await fs.access(categorySubdir).then(() => true).catch(() => false);
  if (!dirExists) {
    throw new Error(`Assertion Failed: CLI crawl subfolder was not created: ${categorySubdir}`);
  }

  const files = await fs.readdir(categorySubdir);
  console.log(`Discovered files in ${categorySubdir}:`, files);
  if (files.length === 0) {
    throw new Error('Assertion Failed: No scraped markdown files were written to the crawl directory!');
  }
  console.log('✓ CLI crawl integration test completed successfully.\n');

  console.log('--- ALL TESTS PASSED SUCCESSFULLY! ---');
  
  // Clean up test directories
  await fs.rm(testDbDir, { recursive: true, force: true });
  await fs.rm(testOutputDir, { recursive: true, force: true });
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
