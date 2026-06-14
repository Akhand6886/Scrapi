import '../polyfill.js';
import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';
import axios from 'axios';
import * as cheerio from 'cheerio';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { initStorage, getAllProfiles, saveProfile, getAllScrapes, insertScrape, saveMarkdownFile } from '../storage.js';
import { scrapePage } from '../scraper.js';
import { runSpider } from '../spider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Global state tracking the active website spider crawl
let activeSpider = {
  running: false,
  seedUrl: '',
  stats: {
    visited: 0,
    queued: 0,
    succeeded: 0,
    failed: 0
  },
  logs: [],
  promise: null,
  aborted: false,
  options: null
};

// Shared long-lived headless browser instance to reduce CPU and memory usage
let sharedBrowser = null;
let idleTimer = null;
const BROWSER_IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes idle time

function resetIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(async () => {
    if (sharedBrowser) {
      console.log('💤 Shared headless browser idle for 5 minutes. Shutting down browser process to free RAM...');
      try {
        await sharedBrowser.close();
      } catch (e) {}
      sharedBrowser = null;
    }
  }, BROWSER_IDLE_TIMEOUT);
}

async function getSharedBrowser() {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  if (!sharedBrowser) {
    sharedBrowser = await chromium.launch({ headless: true });
    sharedBrowser.on('disconnected', () => {
      sharedBrowser = null;
    });
  }
  return sharedBrowser;
}

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

// POST discover links matching selector
app.post('/api/discover', async (req, res) => {
  const { url, selector, mode } = req.body;
  if (!url || !selector) {
    return res.status(400).json({ error: 'Missing url or selector' });
  }

  const renderMode = mode || 'static';
  let html = '';

  try {
    if (renderMode === 'static') {
      console.log(`🌐 [Discover API] Static fetch: ${url}`);
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        },
        responseType: 'text'
      });
      html = response.data;
    } else {
      console.log(`🌐 [Discover API] Dynamic browser fetch: ${url}`);
      const browser = await getSharedBrowser();
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });
        html = await page.content();
      } finally {
        await context.close();
        resetIdleTimer();
      }
    }

    const $ = cheerio.load(html);
    const discoveredUrls = new Set();

    $(selector).each((_, elem) => {
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
        } catch (e) {
          // ignore parsing error
        }
      }
    });

    const resultList = Array.from(discoveredUrls);
    console.log(`✓ [Discover API] Found ${resultList.length} links matching selector "${selector}"`);
    res.json({ urls: resultList });
  } catch (err) {
    console.error(`❌ [Discover API] Discovery failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// GET proxy: Load page with Playwright or Axios and inject picker script
app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  const mode = req.query.mode || 'static';

  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  // 1. Try static Axios fetch first if static mode is active
  if (mode === 'static') {
    try {
      console.log(`🌐 [Hybrid Proxy] Attempting static Axios fetch for: ${targetUrl}`);
      const response = await axios.get(targetUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        },
        responseType: 'text'
      });

      const contentType = response.headers['content-type'] || '';
      if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        throw new Error(`Non-HTML content type: "${contentType}"`);
      }

      let html = response.data;
      if (!html || html.trim().length === 0) {
        throw new Error('Retrieved HTML is empty');
      }

      // Detect if this is an empty body typical of React/Vue client-side SPAs
      const hasAppRoot = /<div\s+id=["'](app|root|__next)["']\s*>\s*<\/div>/i.test(html);
      const isVeryShort = html.length < 5000;
      if (hasAppRoot && isVeryShort) {
        console.log(`⚠️ [Hybrid Proxy] Detected probable client-side SPA. Bypassing static fetch fallback to dynamic.`);
        throw new Error('Probable SPA detected');
      }

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

      console.log(`⚡ [Hybrid Proxy] Successfully loaded ${targetUrl} via static fetch (Axios). Bypassed Playwright.`);
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    } catch (err) {
      console.warn(`⚠️ [Hybrid Proxy] Static fetch failed or bypassed: ${err.message}. Falling back to dynamic Playwright browser...`);
    }
  }

  // 2. Playwright dynamic browser rendering fallback
  let context;
  try {
    const browser = await getSharedBrowser();
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    // Enable request routing to block tracker scripts, media, and fonts to save memory & CPU cycles
    await page.route('**/*', (route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      const url = request.url();

      const blockedTypes = ['media', 'font'];
      const blockedDomains = [
        'google-analytics.com', 'googletagmanager.com', 'facebook.net',
        'doubleclick.net', 'adnxs.com', 'ads-twitter.com', 'scorecardresearch.com',
        'amazon-adsystem.com', 'quantserve.com', 'crazyegg.com', 'hotjar.com'
      ];

      const shouldBlock = blockedTypes.includes(resourceType) || 
                          blockedDomains.some(domain => url.includes(domain));

      if (shouldBlock) {
        route.abort();
      } else {
        route.continue();
      }
    });
    
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
    if (context) {
      await context.close();
    }
    resetIdleTimer();
  }
});

// GET scrapes history
app.get('/api/scrapes', (req, res) => {
  try {
    const category = req.query.category || null;
    const scrapes = getAllScrapes(category);
    res.json(scrapes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST scrape on-demand
app.post('/api/scrape', async (req, res) => {
  const { url, selector, images, noMeta, category } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }
  try {
    const result = await scrapePage(url, { selector, images });
    const filename = await saveMarkdownFile(result.markdown, result.metadata, { noMeta, category });
    
    const record = {
      url,
      title: result.metadata.title,
      description: result.metadata.description,
      filename,
      word_count: result.metadata.word_count,
      scraped_at: result.metadata.scraped_at,
      selector: selector || 'auto',
      status: 'success',
      category: category || null
    };
    // Ensure we handle scraped_at safely if undefined
    if (!record.scraped_at) {
      record.scraped_at = new Date().toISOString();
    }
    insertScrape(record);
    res.json({ success: true, filename, markdown: result.markdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST start website spider
app.post('/api/spider', async (req, res) => {
  const { url, depth, maxPages, concurrency, delay, category } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }

  if (activeSpider.running) {
    return res.status(400).json({ error: 'Another spider job is already running.' });
  }

  const hostName = new URL(url).hostname;
  const spiderOptions = {
    depth: depth !== undefined && depth !== null ? (depth === 'Infinity' ? Infinity : parseInt(depth, 10)) : Infinity,
    maxPages: maxPages !== undefined ? parseInt(maxPages, 10) : 100,
    concurrency: concurrency !== undefined ? parseInt(concurrency, 10) : 2,
    delay: delay !== undefined ? parseInt(delay, 10) : 1500,
    category: category || hostName,
    aborted: false
  };

  activeSpider.running = true;
  activeSpider.seedUrl = url;
  activeSpider.aborted = false;
  activeSpider.logs = [`[System] Spider initialized on ${url}`];
  activeSpider.stats = { visited: 0, queued: 0, succeeded: 0, failed: 0 };
  activeSpider.options = spiderOptions;
  
  activeSpider.promise = runSpider(url, spiderOptions, (evt) => {
    if (evt.type === 'log') {
      activeSpider.logs.push(evt.message);
      if (activeSpider.logs.length > 200) {
        activeSpider.logs.shift(); // keep max 200 logs
      }
    } else if (evt.type === 'progress') {
      activeSpider.stats = evt.stats;
    }
  }).then((results) => {
    activeSpider.running = false;
    activeSpider.logs.push(`[System] Crawl complete! Visited ${results.visited} pages.`);
  }).catch((err) => {
    activeSpider.running = false;
    activeSpider.logs.push(`[System] Crawl encountered error: ${err.message}`);
  });

  res.json({ success: true, message: 'Spider started' });
});

// GET active/last spider status
app.get('/api/spider', (req, res) => {
  res.json({
    running: activeSpider.running,
    seedUrl: activeSpider.seedUrl,
    stats: activeSpider.stats,
    logs: activeSpider.logs,
    aborted: activeSpider.aborted
  });
});

// POST cancel running spider
app.post('/api/spider/cancel', (req, res) => {
  if (!activeSpider.running) {
    return res.status(400).json({ error: 'No spider job is running.' });
  }
  if (activeSpider.options) {
    activeSpider.options.aborted = true;
  }
  activeSpider.aborted = true;
  activeSpider.logs.push('[System] Crawl termination signal received. Stopping workers...');
  res.json({ success: true, message: 'Spider cancelled' });
});

// POST kill/shutdown server
app.post('/api/kill', (req, res) => {
  res.json({ success: true, message: 'Server is shutting down...' });
  console.log('🛑 Shutting down server as requested from Web UI...');
  
  // Schedule immediate exit in 1 second
  setTimeout(() => {
    console.log('Exiting process...');
    process.exit(0);
  }, 1000);

  // Close browser in parallel without blocking the exit timeout
  if (sharedBrowser) {
    sharedBrowser.close().catch(() => {});
  }
});

// Serve frontend files statically
app.use(express.static(__dirname));

const closeBrowser = async () => {
  if (sharedBrowser) {
    console.log('Closing shared headless browser...');
    try {
      await sharedBrowser.close();
    } catch (e) {}
    sharedBrowser = null;
  }
};

process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});

const PORT = process.env.PORT || 3001;
initStorage().then(() => {
  app.listen(PORT, async () => {
    console.log(`🚀 Scrapi Local Server running on http://localhost:${PORT}`);
    // Warm up the browser background-wise
    try {
      await getSharedBrowser();
      console.log('🌐 Shared headless browser instance warmed up and ready.');
    } catch (e) {
      console.error('⚠️ Failed to pre-warm headless browser:', e.message);
    }
  });
}).catch(err => {
  console.error('❌ Failed to initialize SQLite storage:', err.message);
  process.exit(1);
});
