import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';
import zlib from 'zlib';
import axios from 'axios';

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
      schema_used TEXT,
      category TEXT
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      url_pattern TEXT NOT NULL,
      selectors TEXT NOT NULL, -- JSON string
      created_at DATETIME NOT NULL
    );

    CREATE TABLE IF NOT EXISTS http_cache (
      url TEXT PRIMARY KEY,
      html TEXT NOT NULL,
      etag TEXT,
      last_modified TEXT,
      cached_at DATETIME NOT NULL
    );

    CREATE TABLE IF NOT EXISTS llm_cache (
      content_hash TEXT PRIMARY KEY,
      schema_used TEXT,
      instruction TEXT,
      result TEXT,
      cached_at DATETIME NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scrapes_category ON scrapes(category);
    CREATE INDEX IF NOT EXISTS idx_scrapes_scraped_at ON scrapes(scraped_at DESC);
  `);

  // Migration: Add category column if it does not exist in scrapes table
  try {
    db.prepare('SELECT category FROM scrapes LIMIT 1').get();
  } catch (e) {
    db.exec('ALTER TABLE scrapes ADD COLUMN category TEXT');
  }
}

/**
 * Generates frontmatter and saves markdown file.
 * @param {string} markdown 
 * @param {object} metadata 
 * @param {object} options 
 * @returns {Promise<string>} File path where saved
 */
export async function saveMarkdownFile(markdown, metadata, options = {}) {
  const baseOutputDir = options.output || './output';
  let outputDir = baseOutputDir;
  if (options.subdir) {
    outputDir = path.join(outputDir, options.subdir);
  } else if (options.category) {
    outputDir = path.join(outputDir, options.category);
  }
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
  return path.relative(baseOutputDir, fullPath);
}

/**
 * Saves JSON file for LLM output structured data.
 * @param {object} jsonData 
 * @param {string} filename 
 * @param {object} options 
 */
export async function saveJsonFile(jsonData, filename, options = {}) {
  const baseOutputDir = options.output || './output';
  const jsonFilename = filename.replace(/\.md$/, '.json');
  const fullPath = path.join(baseOutputDir, jsonFilename);
  
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
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
      llm_processed, schema_used, category
    ) VALUES (
      ?, ?, ?, ?, ?, 
      ?, ?, ?, ?, ?,
      ?, ?, ?
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
    record.schema_used || null,
    record.category || null
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
export function getAllScrapes(categoryFilter = null) {
  if (categoryFilter) {
    const stmt = db.prepare(`
      SELECT * FROM scrapes WHERE category = ? ORDER BY scraped_at DESC
    `);
    return stmt.all(categoryFilter);
  }
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

/**
 * Retrieves a cached HTTP response.
 * @param {string} url 
 * @returns {object|null}
 */
export function getCachedPage(url) {
  if (!db) return null;
  const stmt = db.prepare(`
    SELECT * FROM http_cache WHERE url = ?
  `);
  const cached = stmt.get(url);
  if (cached && cached.html) {
    if (Buffer.isBuffer(cached.html)) {
      try {
        cached.html = zlib.gunzipSync(cached.html).toString('utf-8');
      } catch (err) {
        console.error(`Error decompressing cached page for ${url}:`, err.message);
        cached.html = cached.html.toString('utf-8');
      }
    }
  }
  return cached;
}

/**
 * Saves or updates a cached HTTP response.
 * @param {string} url 
 * @param {string} html 
 * @param {string} etag 
 * @param {string} lastModified 
 */
export function saveCachedPage(url, html, etag, lastModified) {
  if (!db) return;
  const compressedHtml = zlib.gzipSync(Buffer.from(html, 'utf-8'));
  const stmt = db.prepare(`
    INSERT INTO http_cache (url, html, etag, last_modified, cached_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      html = excluded.html,
      etag = excluded.etag,
      last_modified = excluded.last_modified,
      cached_at = excluded.cached_at
  `);
  stmt.run(url, compressedHtml, etag || null, lastModified || null, new Date().toISOString());
}

/**
 * Retrieves cached LLM extraction result by content hash.
 * @param {string} hash 
 * @returns {object|null}
 */
export function getLlmCache(hash) {
  if (!db) return null;
  const stmt = db.prepare(`
    SELECT * FROM llm_cache WHERE content_hash = ?
  `);
  const record = stmt.get(hash);
  if (record && record.result) {
    try {
      return JSON.parse(record.result);
    } catch (e) {
      return null;
    }
  }
  return null;
}

/**
 * Saves LLM extraction result to cache.
 * @param {string} hash 
 * @param {string} schemaName 
 * @param {string} instruction 
 * @param {object} result 
 */
export function saveLlmCache(hash, schemaName, instruction, result) {
  if (!db) return;
  const stmt = db.prepare(`
    INSERT INTO llm_cache (content_hash, schema_used, instruction, result, cached_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(content_hash) DO UPDATE SET
      schema_used = excluded.schema_used,
      instruction = excluded.instruction,
      result = excluded.result,
      cached_at = excluded.cached_at
  `);
  stmt.run(hash, schemaName, instruction || '', JSON.stringify(result), new Date().toISOString());
}

/**
 * Downloads media files to a local directory based on the markdown file's path.
 * @param {Array<{url: string, filename: string}>} mediaList 
 * @param {string} markdownFilePath 
 * @param {string} baseOutputDir 
 */
export async function downloadMediaFiles(mediaList, markdownFilePath, baseOutputDir = './output') {
  if (!mediaList || mediaList.length === 0) return;
  
  // markdownFilePath is relative to baseOutputDir or absolute.
  const absoluteMarkdownDir = path.resolve(baseOutputDir, path.dirname(markdownFilePath));
  const mediaDir = path.join(absoluteMarkdownDir, 'media');
  
  await fs.mkdir(mediaDir, { recursive: true });
  
  const downloadPromises = mediaList.map(async (media) => {
    try {
      const response = await axios.get(media.url, {
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const filePath = path.join(mediaDir, media.filename);
      await fs.writeFile(filePath, response.data);
    } catch (err) {
      console.error(`Failed to download media ${media.url}:`, err.message);
    }
  });
  
  await Promise.allSettled(downloadPromises);
}
