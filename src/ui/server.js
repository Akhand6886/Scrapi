import '../polyfill.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { 
  initStorage, 
  getAllProfiles, 
  saveProfile, 
  getAllScrapes, 
  insertScrape, 
  saveMarkdownFile, 
  downloadMediaFiles,
  getAllSpiderCheckpoints,
  deleteSpiderCheckpoint,
  getAllElementFingerprints,
  saveElementFingerprint,
  deleteElementFingerprint
} from '../storage.js';
import { scrapePage, discoverCategories, autoDetectLinkSelector } from '../scraper.js';
import { runSpider } from '../spider.js';
import { globalFetcherPool } from '../fetchers/index.js';
import { AdaptiveEngine } from '../parser/index.js';

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
  pages: [],
  promise: null,
  aborted: false,
  options: null
};

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
    // Also save element fingerprint if available
    try {
      const domain = new URL(urlPattern).hostname;
      if (typeof selectors === 'object') {
        saveElementFingerprint(domain, name, selectors);
      }
    } catch (e) {}
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST preview scraper markdown
app.post('/api/preview', async (req, res) => {
  const { url, selector, fetcher } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }
  try {
    const result = await scrapePage(url, { selector, fetcher: fetcher || 'static' });
    res.json({ markdown: result.markdown, metadata: result.metadata });
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
  try {
    const response = await globalFetcherPool.fetch(url, {
      fetcher: renderMode,
      timeout: 30000
    });

    const links = response.css(selector).attribs('href');
    const discoveredUrls = new Set();

    for (const href of links) {
      if (href) {
        try {
          if (!href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:')) {
            const absoluteUrl = new URL(href, url).href;
            discoveredUrls.add(absoluteUrl);
          }
        } catch (e) {}
      }
    }

    const resultList = Array.from(discoveredUrls);
    res.json({ urls: resultList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET proxy: Load page via multi-tier FetcherPool (static, dynamic, stealth) and inject picker script
app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  const mode = req.query.mode || 'static';

  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const response = await globalFetcherPool.fetch(targetUrl, {
      fetcher: mode,
      timeout: 30000
    });

    let html = response.rawHtml || '';
    if (!html || html.trim().length === 0) {
      throw new Error('Received empty HTML from target URL');
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

    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  } catch (err) {
    console.error(`❌ [Proxy] Error loading ${targetUrl} (${mode}):`, err.message);
    res.status(500).send(`Error proxying page: ${err.message}`);
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

// POST get categories for a given URL
app.post('/api/categories', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }
  try {
    const categories = await discoverCategories(url);
    res.json({ categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST auto detect link selector for a URL
app.post('/api/auto-selector', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }
  try {
    const selector = await autoDetectLinkSelector(url);
    res.json({ selector });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST scrape on-demand
app.post('/api/scrape', async (req, res) => {
  const { url, selector, images, downloadMedia, noMeta, category, fetcher } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }
  try {
    const result = await scrapePage(url, { 
      selector, 
      images, 
      downloadMedia,
      fetcher: fetcher || 'static'
    });
    const filename = await saveMarkdownFile(result.markdown, result.metadata, { noMeta, category });
    
    if (downloadMedia && result.media && result.media.length > 0) {
      await downloadMediaFiles(result.media, filename, './output');
    }
    
    const record = {
      url,
      title: result.metadata.title,
      description: result.metadata.description,
      filename,
      word_count: result.metadata.word_count,
      scraped_at: result.metadata.scraped_at || new Date().toISOString(),
      selector: selector || 'auto',
      status: 'success',
      category: category || null
    };
    insertScrape(record);
    res.json({ success: true, filename, markdown: result.markdown, timing: result.timing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET saved spider checkpoints
app.get('/api/spider/checkpoints', (req, res) => {
  try {
    const checkpoints = getAllSpiderCheckpoints();
    res.json({ checkpoints });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE spider checkpoint
app.delete('/api/spider/checkpoints/:jobId', (req, res) => {
  const { jobId } = req.params;
  try {
    deleteSpiderCheckpoint(jobId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST start website spider (supports checkpoints, resume, and multi-tier fetchers)
app.post('/api/spider', async (req, res) => {
  const { url, depth, maxPages, concurrency, delay, category, downloadMedia, fetcher, jobId, resume } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }

  if (activeSpider.running) {
    return res.status(400).json({ error: 'Another spider job is already running.' });
  }

  const hostName = new URL(url).hostname;
  const currentJobId = jobId || `${hostName}-spider`;

  const spiderOptions = {
    depth: depth !== undefined && depth !== null ? (depth === 'Infinity' ? Infinity : parseInt(depth, 10)) : Infinity,
    maxPages: maxPages !== undefined ? parseInt(maxPages, 10) : 100,
    concurrency: concurrency !== undefined ? parseInt(concurrency, 10) : 2,
    delay: delay !== undefined ? parseInt(delay, 10) : 1500,
    category: category || hostName,
    downloadMedia: !!downloadMedia,
    fetcher: fetcher || 'static',
    jobId: currentJobId,
    resume: !!resume,
    aborted: false
  };

  activeSpider.running = true;
  activeSpider.seedUrl = url;
  activeSpider.aborted = false;
  activeSpider.logs = [`[System] Spider initialized on ${url} (Tier: ${(fetcher || 'static').toUpperCase()})`];
  activeSpider.stats = { visited: 0, queued: 0, succeeded: 0, failed: 0 };
  activeSpider.pages = [];
  activeSpider.options = spiderOptions;
  
  activeSpider.promise = runSpider(url, spiderOptions, (evt) => {
    if (evt.type === 'log') {
      activeSpider.logs.push(evt.message);
      if (activeSpider.logs.length > 250) {
        activeSpider.logs.shift();
      }

      if (evt.message.includes('✓ Success: Scraped and saved to')) {
        const parts = evt.message.split('saved to ');
        const savedPath = parts[1] || '';
        activeSpider.pages.unshift({
          filename: savedPath,
          status: 'success',
          time: new Date().toLocaleTimeString()
        });
        if (activeSpider.pages.length > 100) activeSpider.pages.pop();
      }
    } else if (evt.type === 'progress') {
      activeSpider.stats = evt.stats;
    }
  }).then((results) => {
    activeSpider.running = false;
    activeSpider.logs.push(`[System] Crawl finished! Visited ${results.visited} pages.`);
  }).catch((err) => {
    activeSpider.running = false;
    activeSpider.logs.push(`[System] Crawl encountered error: ${err.message}`);
  });

  res.json({ success: true, message: 'Spider started', jobId: currentJobId });
});

// GET active/last spider status
app.get('/api/spider', (req, res) => {
  res.json({
    running: activeSpider.running,
    seedUrl: activeSpider.seedUrl,
    stats: activeSpider.stats,
    logs: activeSpider.logs,
    pages: activeSpider.pages,
    aborted: activeSpider.aborted,
    options: activeSpider.options
  });
});

// POST pause / checkpoint running spider
app.post('/api/spider/pause', (req, res) => {
  if (!activeSpider.running) {
    return res.status(400).json({ error: 'No spider job is running.' });
  }
  if (activeSpider.options) {
    activeSpider.options.aborted = true;
  }
  activeSpider.aborted = true;
  activeSpider.logs.push('[System] Crawl pause signal received. Saving checkpoint...');
  res.json({ success: true, message: 'Spider pause signal dispatched' });
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
  activeSpider.logs.push('[System] Crawl cancellation signal received. Halting workers...');
  res.json({ success: true, message: 'Spider cancelled' });
});

// GET element fingerprints
app.get('/api/fingerprints', (req, res) => {
  try {
    const domain = req.query.domain || null;
    const fingerprints = getAllElementFingerprints(domain);
    res.json({ fingerprints });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST save element fingerprint
app.post('/api/fingerprints', (req, res) => {
  const { domain, name, signature, confidence } = req.body;
  if (!domain || !name || !signature) {
    return res.status(400).json({ error: 'Missing domain, name, or signature' });
  }
  try {
    saveElementFingerprint(domain, name, signature, confidence || 1.0);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE element fingerprint
app.delete('/api/fingerprints/:id', (req, res) => {
  const { id } = req.params;
  try {
    deleteElementFingerprint(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST test adaptive self-healing selector
app.post('/api/adaptive/test', async (req, res) => {
  const { url, signature, mode } = req.body;
  if (!url || !signature) {
    return res.status(400).json({ error: 'Missing url or signature' });
  }
  try {
    const response = await globalFetcherPool.fetch(url, {
      fetcher: mode || 'static',
      timeout: 15000
    });

    const result = response.adaptive(signature);
    res.json({
      success: true,
      found: result.found,
      confidence: result.confidence,
      healedSelector: result.healedSelector,
      match: result.element ? {
        tag: result.element.tag,
        text: result.element.cleanText,
        attribs: result.element.attribs,
        html: (result.element.html || '').substring(0, 300)
      } : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST live query / REPL tester
app.post('/api/query', async (req, res) => {
  const { url, mode, css, xpath, regex } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing target url' });
  }

  const startTime = Date.now();
  try {
    const response = await globalFetcherPool.fetch(url, {
      fetcher: mode || 'static',
      timeout: 20000
    });

    let matches = [];
    if (css) {
      matches = response.css(css).map(el => ({
        tag: el.tag,
        text: el.cleanText || el.text,
        attribs: el.attribs,
        html: (el.html || '').substring(0, 350)
      }));
    } else if (xpath) {
      matches = response.xpath(xpath).map(el => ({
        tag: el.tag,
        text: el.cleanText || el.text,
        attribs: el.attribs,
        html: (el.html || '').substring(0, 350)
      }));
    } else if (regex) {
      const root = response.findBestContentRoot();
      const rawMatches = root.re(new RegExp(regex, 'gi'));
      matches = rawMatches.map(m => ({ tag: 'text', text: m, attribs: {}, html: m }));
    }

    const elapsed = Date.now() - startTime;
    res.json({
      success: true,
      count: matches.length,
      elapsed,
      fetcher: response.fetcher,
      matches: matches.slice(0, 100)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET export scrapes (jsonl, csv, json)
app.get('/api/export', (req, res) => {
  const { format = 'jsonl', category } = req.query;
  try {
    const scrapes = getAllScrapes(category || null);
    
    if (format === 'jsonl') {
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Content-Disposition', `attachment; filename="scrapi-export-${Date.now()}.jsonl"`);
      for (const row of scrapes) {
        res.write(JSON.stringify(row) + '\n');
      }
      return res.end();
    } else if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="scrapi-export-${Date.now()}.csv"`);
      res.write('id,url,title,category,word_count,scraped_at,status,filename\n');
      for (const row of scrapes) {
        const safe = str => `"${String(str || '').replace(/"/g, '""')}"`;
        res.write([
          row.id,
          safe(row.url),
          safe(row.title),
          safe(row.category),
          row.word_count,
          safe(row.scraped_at),
          safe(row.status),
          safe(row.filename)
        ].join(',') + '\n');
      }
      return res.end();
    } else {
      res.setHeader('Content-Type', 'application/json');
      return res.json(scrapes);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET MCP server & agent integration configuration info
app.get('/api/mcp/info', (req, res) => {
  res.json({
    name: 'scrapi-mcp-server',
    version: '2.0.0',
    protocol: 'json-rpc-2.0',
    command: 'node src/cli.js mcp',
    tools: [
      {
        name: 'scrapi_fetch',
        description: 'Fetch and extract clean Markdown with progressive fetchers (static/dynamic/stealth)'
      },
      {
        name: 'scrapi_extract',
        description: 'Extract elements matching CSS, XPath, or Regex queries'
      },
      {
        name: 'scrapi_adaptive_query',
        description: 'Query with DOM self-healing recovery against site mutations'
      },
      {
        name: 'scrapi_crawl',
        description: 'Run site crawl and discover internal links'
      }
    ],
    configSnippets: {
      claudeDesktop: {
        mcpServers: {
          scrapi: {
            command: "node",
            args: [path.resolve(process.cwd(), "src/cli.js"), "mcp"]
          }
        }
      },
      cursor: {
        "mcp": {
          "servers": {
            "scrapi": {
              "command": "node",
              "args": [path.resolve(process.cwd(), "src/cli.js"), "mcp"]
            }
          }
        }
      }
    }
  });
});

// POST kill/shutdown server
app.post('/api/kill', (req, res) => {
  res.json({ success: true, message: 'Server is shutting down...' });
  console.log('🛑 Shutting down server as requested from Web UI...');
  setTimeout(() => {
    process.exit(0);
  }, 800);
});

// Serve frontend files statically
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3001;
initStorage().then(() => {
  app.listen(PORT, async () => {
    console.log(`🚀 Scrapi Local Server running on http://localhost:${PORT}`);
    console.log('⚡ Compiling React UI bundle...');
    exec('npm run build:ui', (err, stdout, stderr) => {
      if (err) {
        console.error('⚠️ Failed to compile UI bundle:', stderr);
      } else {
        console.log('✓ UI Bundle compiled successfully!');
      }
    });
  });
}).catch(err => {
  console.error('❌ Failed to initialize SQLite storage:', err.message);
  process.exit(1);
});
