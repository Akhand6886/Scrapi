import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { initStorage, getAllProfiles, saveProfile } from '../storage.js';
import { scrapePage } from '../scraper.js';

// Polyfill for Node.js < 20 where File is not global (needed by underlying tools like undici)
import { File } from 'buffer';
if (typeof globalThis.File === 'undefined') {
  globalThis.File = File;
}

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
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>${baseTag}`);
    } else if (html.includes('<HEAD>')) {
      html = html.replace('<HEAD>', `<HEAD>${baseTag}`);
    } else {
      html = baseTag + html;
    }

    // Inject our picker.js client script before </body>
    const scriptTag = `<script src="/api/picker.js"></script>`;
    if (html.includes('</body>')) {
      html = html.replace('</body>', `${scriptTag}</body>`);
    } else if (html.includes('</BODY>')) {
      html = html.replace('</BODY>', `${scriptTag}</BODY>`);
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Scrapi Local Server running on http://localhost:${PORT}`);
});
