import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';

let db;

/**
 * Initializes the SQLite database and output directories.
 * @param {string} dbDir 
 * @param {string} outputDir 
 */
export async function initStorage(dbDir = './data', outputDir = './output') {
  // Ensure directories exist
  await fs.mkdir(dbDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  const dbPath = path.join(dbDir, 'scrapes.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS scrapes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      title TEXT,
      description TEXT,
      filename TEXT,
      word_count INTEGER,
      scraped_at DATETIME NOT NULL,
      selector TEXT,
      status TEXT NOT NULL,
      error TEXT,
      profile_id INTEGER,
      llm_processed BOOLEAN DEFAULT 0,
      schema_used TEXT
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      url_pattern TEXT NOT NULL,
      selectors TEXT NOT NULL, -- JSON string
      created_at DATETIME NOT NULL
    );
  `);
}

/**
 * Generates frontmatter and saves markdown file.
 * @param {string} markdown 
 * @param {object} metadata 
 * @param {object} options 
 * @returns {Promise<string>} File path where saved
 */
export async function saveMarkdownFile(markdown, metadata, options = {}) {
  const outputDir = options.output || './output';
  await fs.mkdir(outputDir, { recursive: true });

  // Generate safe filename if not custom provided
  let baseFilename = options.filename;
  if (!baseFilename) {
    baseFilename = (metadata.title || 'scrape')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    
    // Add brief timestamp suffix to prevent collision
    const stamp = Math.floor(Date.now() / 1000).toString().slice(-4);
    baseFilename = `${baseFilename}-${stamp}`;
  }

  const filename = `${baseFilename}.md`;
  const fullPath = path.join(outputDir, filename);

  let fileContent = '';
  if (!options.noMeta) {
    fileContent += '---\n';
    fileContent += `title: "${(metadata.title || '').replace(/"/g, '\\"')}"\n`;
    fileContent += `url: "${metadata.url}"\n`;
    fileContent += `scraped_at: "${metadata.scraped_at}"\n`;
    if (metadata.description) {
      fileContent += `description: "${metadata.description.replace(/"/g, '\\"')}"\n`;
    }
    if (metadata.date) {
      fileContent += `date: "${metadata.date}"\n`;
    }
    fileContent += '---\n\n';
  }

  fileContent += `# ${metadata.title || 'Scraped Page'}\n\n`;
  fileContent += `> Source: ${metadata.url}\n\n`;
  fileContent += '---\n\n';
  fileContent += markdown;

  await fs.writeFile(fullPath, fileContent, 'utf-8');
  return filename;
}

/**
 * Saves JSON file for LLM output structured data.
 * @param {object} jsonData 
 * @param {string} filename 
 * @param {object} options 
 */
export async function saveJsonFile(jsonData, filename, options = {}) {
  const outputDir = options.output || './output';
  await fs.mkdir(outputDir, { recursive: true });

  const jsonFilename = filename.replace(/\.md$/, '.json');
  const fullPath = path.join(outputDir, jsonFilename);
  await fs.writeFile(fullPath, JSON.stringify(jsonData, null, 2), 'utf-8');
  return jsonFilename;
}

/**
 * Inserts a scrape record.
 * @param {object} record 
 * @returns {number} Inserted ID
 */
export function insertScrape(record) {
  const stmt = db.prepare(`
    INSERT INTO scrapes (
      url, title, description, filename, word_count, 
      scraped_at, selector, status, error, profile_id,
      llm_processed, schema_used
    ) VALUES (
      ?, ?, ?, ?, ?, 
      ?, ?, ?, ?, ?,
      ?, ?
    )
  `);

  const info = stmt.run(
    record.url,
    record.title || null,
    record.description || null,
    record.filename || null,
    record.word_count || 0,
    record.scraped_at,
    record.selector || null,
    record.status,
    record.error || null,
    record.profile_id || null,
    record.llm_processed ? 1 : 0,
    record.schema_used || null
  );

  return info.lastInsertRowid;
}

/**
 * Updates LLM details of a scrape.
 * @param {number} scrapeId 
 * @param {string} schemaUsed 
 */
export function markScrapeLlmProcessed(scrapeId, schemaUsed) {
  const stmt = db.prepare(`
    UPDATE scrapes 
    SET llm_processed = 1, schema_used = ?
    WHERE id = ?
  `);
  stmt.run(schemaUsed, scrapeId);
}

/**
 * Retrieves list of all scrapes.
 * @returns {Array}
 */
export function getAllScrapes() {
  const stmt = db.prepare(`
    SELECT * FROM scrapes ORDER BY scraped_at DESC
  `);
  return stmt.all();
}

/**
 * Retrieves a scrape by its ID.
 * @param {number} id 
 * @returns {object}
 */
export function getScrapeById(id) {
  const stmt = db.prepare(`
    SELECT * FROM scrapes WHERE id = ?
  `);
  return stmt.get(id);
}

/**
 * Saves a visual config profile.
 * @param {string} name 
 * @param {string} urlPattern 
 * @param {object} selectors 
 */
export function saveProfile(name, urlPattern, selectors) {
  const stmt = db.prepare(`
    INSERT INTO profiles (name, url_pattern, selectors, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      url_pattern = excluded.url_pattern,
      selectors = excluded.selectors,
      created_at = excluded.created_at
  `);
  stmt.run(name, urlPattern, JSON.stringify(selectors), new Date().toISOString());
}

/**
 * Gets a profile by name.
 * @param {string} name 
 * @returns {object}
 */
export function getProfileByName(name) {
  const stmt = db.prepare(`
    SELECT * FROM profiles WHERE name = ?
  `);
  const profile = stmt.get(name);
  if (profile) {
    profile.selectors = JSON.parse(profile.selectors);
  }
  return profile;
}

/**
 * Gets all profiles.
 * @returns {Array}
 */
export function getAllProfiles() {
  const stmt = db.prepare(`
    SELECT * FROM profiles ORDER BY created_at DESC
  `);
  return stmt.all().map(p => {
    p.selectors = JSON.parse(p.selectors);
    return p;
  });
}
