import '../polyfill.js';
import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { initStorage, getAllProfiles, saveProfile, getAllScrapes, insertScrape, saveMarkdownFile } from '../storage.js';
import { scrapePage } from '../scraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Initialize SQLite database
initStorage();

// Serve the picker script static endpoint
app.get('/api/picker.js', async (req, res) => {
  try {
    const pickerPath = path.join(__dirname, 'picker.js');
    const content = await fs.readFile(pickerPath, 'utf-8');
    res.setHeader('Content-Type', 'application/javascript');
    res.send(content);
  } catch (err) {
    res.status(500).send(`Error reading picker script: ${err.message}`);
  }
});

// GET profiles
app.get('/api/profiles', (req, res) => {
  try {
    const profiles = getAllProfiles();
    res.json(profiles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST profiles
app.post('/api/profiles', (req, res) => {
  const { name, urlPattern, selectors } = req.body;
  if (!name || !urlPattern || !selectors) {
    return res.status(400).json({ error: 'Missing name, urlPattern, or selectors' });
  }
  try {
    saveProfile(name, urlPattern, selectors);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST preview scraper markdown
app.post('/api/preview', async (req, res) => {
  const { url, selector } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }
  try {
    const result = await scrapePage(url, { selector });
    res.json({ markdown: result.markdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET proxy: Load page with Playwright and inject picker script
app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    // Navigate to page
    await page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 });

    // Retrieve HTML contents
    let html = await page.content();
    
    // Injects <base href="..."> into <head> so relative assets load fine
    const baseTag = `<base href="${targetUrl}">`;
    const headRegex = /(<head[^>]*>)/i;
    if (headRegex.test(html)) {
      html = html.replace(headRegex, `$1${baseTag}`);
    } else {
      html = baseTag + html;
    }

    // Inject our picker.js client script absolute to our host before </body>
    const host = req.headers.host || 'localhost:3001';
    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const scriptTag = `<script src="${protocol}://${host}/api/picker.js"></script>`;
    const bodyCloseRegex = /(<\/body>)/i;
    if (bodyCloseRegex.test(html)) {
      html = html.replace(bodyCloseRegex, `${scriptTag}$1`);
    } else {
      html = html + scriptTag;
    }

    // Strip out Content-Security-Policy meta tags that might block our scripts
    html = html.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send(`Error proxying page: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// GET scrapes history
app.get('/api/scrapes', (req, res) => {
  try {
    const scrapes = getAllScrapes();
    res.json(scrapes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST scrape on-demand
app.post('/api/scrape', async (req, res) => {
  const { url, selector, images, noMeta } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }
  try {
    const result = await scrapePage(url, { selector, images });
    const filename = await saveMarkdownFile(result.markdown, result.metadata, { noMeta });
    
    const record = {
      url,
      title: result.metadata.title,
      description: result.metadata.description,
      filename,
      word_count: result.metadata.word_count,
      scraped_at: result.metadata.scraped_at,
      selector: selector || 'auto',
      status: 'success'
    };
    insertScrape(record);
    res.json({ success: true, filename, markdown: result.markdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST kill/shutdown server
app.post('/api/kill', (req, res) => {
  res.json({ success: true, message: 'Server is shutting down...' });
  console.log('🛑 Shutting down server as requested from Web UI...');
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

// Serve frontend files statically
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Scrapi Local Server running on http://localhost:${PORT}`);
});
