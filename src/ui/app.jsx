const { useState, useEffect, useRef } = React;

// Helper function to safely fetch JSON and validate content-type and ok status
async function safeFetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!res.ok) {
    let errorMsg = `HTTP Error ${res.status}`;
    if (isJson) {
      try {
        const data = await res.json();
        errorMsg = data.error || errorMsg;
      } catch (e) {}
    } else {
      try {
        const text = await res.text();
        errorMsg = text.substring(0, 120) || errorMsg;
      } catch (e) {}
    }
    throw new Error(errorMsg);
  }

  if (!isJson) {
    throw new Error(`Expected JSON but got content-type "${contentType}"`);
  }

  return res.json();
}

function App() {
  // Inputs & Core State
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selector, setSelector] = useState('');
  const [activeSignature, setActiveSignature] = useState(null);
  const [profileName, setProfileName] = useState('');
  const [includeImages, setIncludeImages] = useState(false);
  const [downloadMedia, setDownloadMedia] = useState(false);
  const [renderMode, setRenderMode] = useState('auto'); // 'auto' | 'static' | 'dynamic' | 'stealth'
  const [lastDecision, setLastDecision] = useState(null);

  // Console Mode ('single' | 'batch' | 'spider')
  const [consoleMode, setConsoleMode] = useState('single');

  // Spider State & Checkpoints
  const [spiderActive, setSpiderActive] = useState(false);
  const [spiderStats, setSpiderStats] = useState({ visited: 0, queued: 0, succeeded: 0, failed: 0 });
  const [spiderLogs, setSpiderLogs] = useState([]);
  const [spiderPages, setSpiderPages] = useState([]);
  const [spiderDepth, setSpiderDepth] = useState('Infinity');
  const [spiderMaxPages, setSpiderMaxPages] = useState(100);
  const [spiderConcurrency, setSpiderConcurrency] = useState(2);
  const [spiderDelay, setSpiderDelay] = useState(1500);
  const [checkpoints, setCheckpoints] = useState([]);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState('');

  // Batch Scraping State
  const [discoveredUrls, setDiscoveredUrls] = useState([]);
  const [discovering, setDiscovering] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null);
  const [batchConcurrency, setBatchConcurrency] = useState(2);
  const [batchDelay, setBatchDelay] = useState(1500);
  const [discoveredCategories, setDiscoveredCategories] = useState([]);
  const [syncingCategories, setSyncingCategories] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);

  // Active Tab ('iframe' | 'markdown' | 'query' | 'adaptive')
  const [activeTab, setActiveTab] = useState('iframe');
  const [iframeUrl, setIframeUrl] = useState('');
  const [markdownOutput, setMarkdownOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ text: '', type: '' });
  const [confirmKill, setConfirmKill] = useState(false);

  // REPL / Query Tester State
  const [queryType, setQueryType] = useState('css'); // 'css' | 'xpath' | 'regex'
  const [queryInput, setQueryInput] = useState('');
  const [queryResults, setQueryResults] = useState(null);
  const [queryRunning, setQueryRunning] = useState(false);

  // Adaptive Self-Healing Studio State
  const [fingerprints, setFingerprints] = useState([]);
  const [adaptiveResult, setAdaptiveResult] = useState(null);
  const [testingAdaptive, setTestingAdaptive] = useState(false);

  // MCP Info Modal State
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [mcpInfo, setMcpInfo] = useState(null);

  // Export State
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Loaded data lists
  const [profiles, setProfiles] = useState([]);
  const [history, setHistory] = useState([]);

  const iframeRef = useRef(null);

  const showToast = (text, type = 'info') => {
    setStatusMsg({ text, type });
    setTimeout(() => setStatusMsg({ text: '', type: '' }), 4000);
  };

  // Load initial data
  const loadData = async (catFilter = categoryFilter) => {
    try {
      const urlParams = catFilter ? `?category=${encodeURIComponent(catFilter)}` : '';
      const [profData, histData, cpData, fpData] = await Promise.all([
        safeFetchJson('/api/profiles'),
        safeFetchJson(`/api/scrapes${urlParams}`),
        safeFetchJson('/api/spider/checkpoints'),
        safeFetchJson('/api/fingerprints')
      ]);
      setProfiles(profData);
      setHistory(histData);
      setCheckpoints(cpData.checkpoints || []);
      setFingerprints(fpData.fingerprints || []);
    } catch (err) {
      console.error("Failed to fetch initial data", err);
    }
  };

  // Load MCP server details
  const loadMcpInfo = async () => {
    try {
      const data = await safeFetchJson('/api/mcp/info');
      setMcpInfo(data);
    } catch (e) {}
  };

  useEffect(() => {
    loadData();
    loadMcpInfo();

    // Check active spider status on boot
    safeFetchJson('/api/spider')
      .then(data => {
        if (data.running) {
          setSpiderActive(true);
          setSpiderStats(data.stats || { visited: 0, queued: 0, succeeded: 0, failed: 0 });
          setSpiderLogs(data.logs || []);
          setSpiderPages(data.pages || []);
        }
      }).catch(err => {});

    // Listen for element clicks inside proxy iframe
    const handleIframeMessage = (event) => {
      if (event.data) {
        if (event.data.type === 'ELEMENT_SELECTED') {
          const { selector: sel, tagName, textSnippet, classes, parentTagName } = event.data;
          setSelector(sel);
          setActiveSignature({
            content: sel,
            tagName,
            textSnippet,
            classes,
            parentTagName
          });
          showToast(`Selected <${tagName}>: "${(textSnippet || '').substring(0, 30)}..."`, 'success');
        } else if (event.data.type === 'NAVIGATE_TO_URL') {
          const targetUrl = event.data.url;
          setUrl(targetUrl);
          setIframeUrl(`/api/proxy?url=${encodeURIComponent(targetUrl)}&mode=${renderMode}`);
          setLoading(true);
          showToast(`Navigating to ${targetUrl}...`, 'info');
        }
      }
    };

    window.addEventListener('message', handleIframeMessage);
    return () => window.removeEventListener('message', handleIframeMessage);
  }, []);

  // Spider status polling
  useEffect(() => {
    let timer = null;
    if (spiderActive) {
      timer = setInterval(async () => {
        try {
          const data = await safeFetchJson('/api/spider');
          setSpiderStats(data.stats || { visited: 0, queued: 0, succeeded: 0, failed: 0 });
          setSpiderLogs(data.logs || []);
          setSpiderPages(data.pages || []);
          if (!data.running) {
            setSpiderActive(false);
            showToast('Spider crawl completed!', 'success');
            loadData();
          }
        } catch (err) {}
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [spiderActive]);

  // Load Proxy Page
  const handleLoadProxy = () => {
    if (!url) {
      showToast('Please enter a target URL first.', 'error');
      return;
    }
    setLoading(true);
    setActiveTab('iframe');
    setIframeUrl(`/api/proxy?url=${encodeURIComponent(url)}&mode=${renderMode}`);
  };

  // Run On-Demand Scrape
  const handleScrape = async () => {
    if (!url) {
      showToast('Please enter a target URL first.', 'error');
      return;
    }
    setLoading(true);
    try {
      const data = await safeFetchJson('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          selector: selector || 'auto',
          images: includeImages,
          downloadMedia,
          noMeta,
          category: category.trim() || null,
          fetcher: renderMode
        })
      });

      setMarkdownOutput(data.markdown);
      if (data.decisionTree) {
        setLastDecision(data.decisionTree);
      }
      setActiveTab('markdown');
      showToast(`Scraped successfully via ${renderMode.toUpperCase()}! Saved to ${data.filename}`, 'success');
      loadData();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Start Site Spider
  const handleStartSpider = async (resumeJobId = null) => {
    if (!url && !resumeJobId) {
      showToast('Please enter a target seed URL first.', 'error');
      return;
    }
    setSpiderActive(true);
    setSpiderLogs(['[System] Initializing Spider...']);
    setSpiderPages([]);

    try {
      const targetUrl = resumeJobId ? (checkpoints.find(c => c.job_id === resumeJobId)?.seed_url || url) : url;
      const res = await safeFetchJson('/api/spider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          depth: spiderDepth === 'Infinity' ? 'Infinity' : parseInt(spiderDepth, 10),
          maxPages: parseInt(spiderMaxPages, 10),
          concurrency: parseInt(spiderConcurrency, 10),
          delay: parseInt(spiderDelay, 10),
          category: category.trim() || null,
          downloadMedia,
          fetcher: renderMode,
          jobId: resumeJobId || undefined,
          resume: !!resumeJobId
        })
      });
      showToast(resumeJobId ? `Resumed crawl for job ${resumeJobId}!` : 'Spider crawl started!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
      setSpiderActive(false);
    }
  };

  // Pause & Save Spider Checkpoint
  const handlePauseSpider = async () => {
    try {
      await safeFetchJson('/api/spider/pause', { method: 'POST' });
      showToast('Pause signal dispatched. Checkpoint is being saved...', 'info');
      setTimeout(loadData, 1500);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Cancel Running Spider
  const handleCancelSpider = async () => {
    try {
      await safeFetchJson('/api/spider/cancel', { method: 'POST' });
      showToast('Crawl cancellation signal sent.', 'info');
      setTimeout(loadData, 1500);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Delete Spider Checkpoint
  const handleDeleteCheckpoint = async (jobId) => {
    try {
      await safeFetchJson(`/api/spider/checkpoints/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
      showToast(`Checkpoint [${jobId}] deleted.`, 'info');
      loadData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Live Query / REPL Execution
  const handleRunQuery = async () => {
    if (!url) {
      showToast('Please enter a target URL first.', 'error');
      return;
    }
    if (!queryInput) {
      showToast('Please enter a query expression first.', 'error');
      return;
    }

    setQueryRunning(true);
    try {
      const payload = { url, mode: renderMode };
      if (queryType === 'css') payload.css = queryInput;
      else if (queryType === 'xpath') payload.xpath = queryInput;
      else if (queryType === 'regex') payload.regex = queryInput;

      const data = await safeFetchJson('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setQueryResults(data);
      showToast(`Found ${data.count} matches in ${data.elapsed}ms!`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setQueryRunning(false);
    }
  };

  // Test Adaptive Self-Healing
  const handleTestAdaptive = async (sig = activeSignature) => {
    if (!url) {
      showToast('Please enter a target URL first.', 'error');
      return;
    }
    if (!sig) {
      showToast('No element fingerprint selected. Click an element in Target Preview first.', 'error');
      return;
    }

    setTestingAdaptive(true);
    try {
      const data = await safeFetchJson('/api/adaptive/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          signature: sig,
          mode: renderMode
        })
      });
      setAdaptiveResult(data);
      if (data.found) {
        showToast(`Self-healing match found with ${(data.confidence * 100).toFixed(1)}% confidence!`, 'success');
      } else {
        showToast('Target element could not be reliably relocated.', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setTestingAdaptive(false);
    }
  };

  // Discover Links for Batch Scraping
  const handleDiscoverLinks = async () => {
    if (!url || !selector) {
      showToast('Target URL and Link Selector are required.', 'error');
      return;
    }
    setDiscovering(true);
    setDiscoveredUrls([]);
    try {
      const data = await safeFetchJson('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, selector, mode: renderMode })
      });
      setDiscoveredUrls(data.urls || []);
      showToast(`Discovered ${data.urls ? data.urls.length : 0} links!`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setDiscovering(false);
    }
  };

  // Live Batch Scraping
  const handleStartBatchScrape = async () => {
    if (discoveredUrls.length === 0) return;
    const total = discoveredUrls.length;
    setBatchProgress({ active: true, current: 0, total, succeeded: 0, failed: 0 });
    setLoading(true);

    const urlsQueue = [...discoveredUrls];
    let currentIdx = 0;
    let succeeded = 0;
    let failed = 0;
    const concurrencyVal = Math.max(1, parseInt(batchConcurrency, 10) || 2);
    const delayVal = Math.max(0, parseInt(batchDelay, 10) || 0);

    const runWorker = async () => {
      while (urlsQueue.length > 0) {
        const targetUrl = urlsQueue.shift();
        currentIdx++;
        setBatchProgress(prev => ({ ...prev, current: currentIdx }));

        try {
          await safeFetchJson('/api/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: targetUrl,
              selector: 'auto',
              images: includeImages,
              downloadMedia,
              noMeta,
              category: category.trim() || null,
              fetcher: renderMode
            })
          });
          succeeded++;
          setBatchProgress(prev => ({ ...prev, succeeded }));
        } catch (err) {
          failed++;
          setBatchProgress(prev => ({ ...prev, failed }));
        }

        if (urlsQueue.length > 0 && delayVal > 0) {
          await new Promise(res => setTimeout(res, delayVal));
        }
      }
    };

    try {
      const workers = Array.from({ length: concurrencyVal }, () => runWorker());
      await Promise.all(workers);
      showToast(`Batch completed: ${succeeded} ok, ${failed} failed.`, 'success');
      loadData();
    } catch (e) {
      showToast('Batch completed with errors.', 'error');
    } finally {
      setLoading(false);
      setBatchProgress(null);
    }
  };

  // Save Profile
  const handleSaveProfile = async () => {
    if (!url || !profileName || !selector) {
      showToast('URL, Profile Name, and Selector are required.', 'error');
      return;
    }
    const finalSignature = activeSignature && activeSignature.content === selector ? activeSignature : {
      content: selector,
      tagName: '*',
      textSnippet: '',
      classes: [],
      parentTagName: null
    };

    try {
      await safeFetchJson('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: profileName,
          urlPattern: url,
          selectors: finalSignature
        })
      });
      showToast(`Profile "${profileName}" saved!`, 'success');
      setProfileName('');
      loadData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleApplyProfile = (prof) => {
    setUrl(prof.url_pattern);
    if (prof.selectors) {
      if (typeof prof.selectors === 'object') {
        setSelector(prof.selectors.content || 'auto');
        setActiveSignature(prof.selectors);
      } else {
        setSelector(prof.selectors);
        setActiveSignature({ content: prof.selectors });
      }
    }
    showToast(`Profile "${prof.name}" applied!`, 'success');
  };

  // View Past Scrape
  const handleViewScrape = async (scrape) => {
    setLoading(true);
    try {
      const data = await safeFetchJson(`/api/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: scrape.url, selector: scrape.selector })
      });
      setMarkdownOutput(data.markdown);
      setActiveTab('markdown');
      setUrl(scrape.url);
      setSelector(scrape.selector || 'auto');
      showToast(`Loaded Scrape #${scrape.id}`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyMarkdown = () => {
    if (!markdownOutput) return;
    navigator.clipboard.writeText(markdownOutput);
    showToast('Markdown copied to clipboard!', 'success');
  };

  const handleKillServer = async () => {
    if (!confirmKill) {
      setConfirmKill(true);
      setTimeout(() => setConfirmKill(false), 3000);
      return;
    }
    showToast('Terminating server...', 'error');
    try { await fetch('/api/kill', { method: 'POST' }); } catch (e) {}
    setTimeout(() => {
      document.body.innerHTML = `
        <div class="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white font-sans">
          <span class="text-6xl mb-4">🛑</span>
          <h1 class="text-3xl font-bold text-red-500 mb-2">Scrapi Server Terminated</h1>
          <p class="text-slate-400">The local server process was halted safely.</p>
        </div>
      `;
    }, 1000);
  };

  return (
    <div class="flex-1 flex flex-col h-full overflow-hidden bg-slate-950 text-slate-100 font-sans">
      {/* Top Header */}
      <header class="glass h-16 flex items-center justify-between px-6 border-b border-white/5 shrink-0 z-20">
        <div class="flex items-center space-x-3">
          <span class="text-2xl animate-pulse-slow">🕷️</span>
          <div>
            <div class="flex items-center space-x-2">
              <span class="font-bold text-lg tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-teal-300 to-emerald-400">
                SCRAPI
              </span>
              <span class="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] rounded-full border border-blue-500/20 font-bold">
                v2.0 SCRAPLING
              </span>
            </div>
            <div class="text-[10px] text-slate-400">Multi-Tier Evasion • Adaptive Self-Healing • Spider Checkpoints</div>
          </div>
        </div>

        <div class="flex items-center space-x-3">
          {/* MCP AI Connect Button */}
          <button
            onClick={() => setShowMcpModal(true)}
            class="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all active:scale-95 shadow-md shadow-indigo-600/10"
            title="Model Context Protocol for Claude / Cursor AI Integration"
          >
            <span>🤖</span>
            <span>MCP Connect</span>
            <span class="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping"></span>
          </button>

          {/* Export Scrapes Dropdown */}
          <div class="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 rounded-lg text-xs font-semibold flex items-center space-x-1 transition-all active:scale-95"
            >
              <span>📥 Export</span>
              <span class="text-[10px]">▼</span>
            </button>
            {showExportMenu && (
              <div class="absolute right-0 mt-2 w-44 bg-slate-900 border border-white/10 rounded-xl shadow-2xl py-1 z-50 animate-fade-in">
                <a
                  href="/api/export?format=jsonl"
                  download
                  onClick={() => setShowExportMenu(false)}
                  class="block px-3 py-2 text-xs text-slate-300 hover:bg-blue-600/20 hover:text-blue-300 transition-colors"
                >
                  📄 JSON Lines (.jsonl)
                </a>
                <a
                  href="/api/export?format=csv"
                  download
                  onClick={() => setShowExportMenu(false)}
                  class="block px-3 py-2 text-xs text-slate-300 hover:bg-blue-600/20 hover:text-blue-300 transition-colors"
                >
                  📊 Spreadsheet (.csv)
                </a>
                <a
                  href="/api/export?format=json"
                  download
                  onClick={() => setShowExportMenu(false)}
                  class="block px-3 py-2 text-xs text-slate-300 hover:bg-blue-600/20 hover:text-blue-300 transition-colors"
                >
                  🗄️ Raw JSON (.json)
                </a>
              </div>
            )}
          </div>

          {/* Kill Program Button */}
          <button 
            onClick={handleKillServer}
            class={`px-3 py-1.5 text-white rounded-lg text-xs font-semibold transition-all border flex items-center shadow-lg active:scale-95 ${confirmKill ? 'bg-orange-600 hover:bg-orange-500 border-orange-500/50' : 'bg-red-600/80 hover:bg-red-600 border-red-500/30'}`}
            title="Terminate local backend server"
          >
            <span>🛑</span>
            <span class="ml-1.5">{confirmKill ? 'Confirm' : 'Shutdown'}</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <main class="flex-1 flex overflow-hidden">
        {/* Left Control Sidebar */}
        <section class="w-[390px] flex flex-col border-r border-white/5 glass overflow-y-auto custom-scrollbar p-5 space-y-5 shrink-0">
          
          {/* Console Mode Switcher */}
          <div class="space-y-1.5 shrink-0">
            <label class="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Console Mode</label>
            <div class="flex bg-slate-900/80 rounded-xl p-1 border border-white/10">
              <button
                onClick={() => setConsoleMode('single')}
                class={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${consoleMode === 'single' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
              >
                🕷️ Single Page
              </button>
              <button
                onClick={() => setConsoleMode('batch')}
                class={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${consoleMode === 'batch' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
              >
                ⚡ Link Batch
              </button>
              <button
                onClick={() => setConsoleMode('spider')}
                class={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${consoleMode === 'spider' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
              >
                🕸️ Site Spider
              </button>
            </div>
          </div>

          {/* Progressive Multi-Tier Fetcher Selector */}
          <div class="space-y-1.5 bg-slate-900/60 p-3 rounded-xl border border-white/5">
            <div class="flex justify-between items-center">
              <label class="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Progressive Fetcher Tier</label>
              <span class={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                renderMode === 'auto' ? 'text-amber-400 bg-amber-500/10 border border-amber-500/30' :
                renderMode === 'static' ? 'text-blue-400 bg-blue-500/10' :
                renderMode === 'dynamic' ? 'text-teal-400 bg-teal-500/10' :
                'text-purple-400 bg-purple-500/10 border border-purple-500/30'
              }`}>
                {renderMode === 'auto' ? '🤖 DECISION TREE (AUTO)' : renderMode === 'stealth' ? '🛡️ ANTI-BOT BYPASS' : renderMode === 'dynamic' ? '🌐 PLAYWRIGHT SPA' : '⚡ 304 CACHED'}
              </span>
            </div>
            
            <div class="grid grid-cols-4 gap-1 pt-1">
              <button
                onClick={() => setRenderMode('auto')}
                class={`py-1.5 px-1.5 text-[10px] font-semibold rounded-lg transition-all border ${renderMode === 'auto' ? 'bg-amber-600 text-white border-amber-400 shadow-md' : 'bg-slate-950/60 border-white/5 text-slate-400 hover:text-slate-200'}`}
                title="AI Decision Tree: Auto-routes in <20µs to Static, Dynamic, or Stealth based on DOM/HTTP signals"
              >
                🤖 Auto
              </button>
              <button
                onClick={() => setRenderMode('static')}
                class={`py-1.5 px-1.5 text-[10px] font-semibold rounded-lg transition-all border ${renderMode === 'static' ? 'bg-blue-600 text-white border-blue-400 shadow-md' : 'bg-slate-950/60 border-white/5 text-slate-400 hover:text-slate-200'}`}
                title="Ultra-fast connection pooling, TLS headers, and HTTP 304 caching"
              >
                ⚡ Static
              </button>
              <button
                onClick={() => setRenderMode('dynamic')}
                class={`py-1.5 px-1.5 text-[10px] font-semibold rounded-lg transition-all border ${renderMode === 'dynamic' ? 'bg-teal-600 text-white border-teal-400 shadow-md' : 'bg-slate-950/60 border-white/5 text-slate-400 hover:text-slate-200'}`}
                title="Playwright headless browser for dynamic JavaScript single-page apps"
              >
                🌐 Dynamic
              </button>
              <button
                onClick={() => setRenderMode('stealth')}
                class={`py-1.5 px-1.5 text-[10px] font-semibold rounded-lg transition-all border ${renderMode === 'stealth' ? 'bg-purple-600 text-white border-purple-400 shadow-md' : 'bg-slate-950/60 border-white/5 text-slate-400 hover:text-slate-200'}`}
                title="Anti-bot evasion: Cloudflare Turnstile bypass, navigator mask, canvas noise"
              >
                🛡️ Stealth
              </button>
            </div>
            <div class="text-[9px] text-slate-400 pt-1 leading-tight">
              {renderMode === 'auto' && 'Autonomous CART Decision Tree. Analyzes HTTP status, Turnstile tokens & SPA root in <20µs.'}
              {renderMode === 'static' && 'Ultra-fast HTTP client with connection keep-alive and ETag caching.'}
              {renderMode === 'dynamic' && 'Full Chromium rendering for React, Next.js, and client-side SPAs.'}
              {renderMode === 'stealth' && 'Anti-detection engine that solves Cloudflare Turnstile challenges automatically.'}
            </div>
          </div>

          {/* Mode 1: Single Page Scrape */}
          {consoleMode === 'single' && (
            <div class="space-y-4 animate-fade-in">
              <div class="space-y-2">
                <label class="text-xs text-slate-400 font-medium">Target URL</label>
                <input 
                  type="url" 
                  placeholder="https://example.com/article" 
                  value={url} 
                  onChange={e => setUrl(e.target.value)}
                  class="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <div class="space-y-2">
                <label class="text-xs text-slate-400 font-medium">Category Tag</label>
                <input 
                  type="text" 
                  placeholder="e.g. articles, tech (optional)" 
                  value={category} 
                  onChange={e => setCategory(e.target.value)}
                  class="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <div class="flex space-x-2">
                <button 
                  onClick={handleLoadProxy} 
                  disabled={loading}
                  class="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center justify-center shadow-lg shadow-blue-600/20"
                >
                  <span class="mr-1.5">🌐</span>
                  Proxy Page
                </button>
                <button 
                  onClick={handleScrape} 
                  disabled={loading}
                  class="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center justify-center shadow-lg shadow-emerald-600/20"
                >
                  <span class="mr-1.5">⚡</span>
                  Scrape Now
                </button>
              </div>

              {/* Selector & Fingerprint Section */}
              <div class="space-y-3 pt-3 border-t border-white/5">
                <div class="flex justify-between items-center">
                  <label class="text-xs text-slate-400 font-medium">CSS Selector</label>
                  {activeSignature && (
                    <span class="text-[9px] text-teal-400 font-bold uppercase bg-teal-500/10 px-1.5 py-0.5 rounded border border-teal-500/20">
                      Fingerprint Ready
                    </span>
                  )}
                </div>
                <div class="flex space-x-2">
                  <input 
                    type="text" 
                    placeholder="auto (smart content root)" 
                    value={selector} 
                    onChange={e => setSelector(e.target.value)}
                    class="flex-1 px-3 py-2 bg-slate-900 border border-white/10 rounded-xl text-xs text-emerald-400 font-mono focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  <button 
                    onClick={() => { setSelector(''); setActiveSignature(null); }}
                    class="px-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl border border-white/10 text-slate-400"
                    title="Clear Selector"
                  >
                    ✕
                  </button>
                </div>

                {/* Captured Fingerprint preview */}
                {activeSignature && (
                  <div class="p-2.5 bg-slate-900/90 border border-teal-500/30 rounded-xl space-y-1 text-[10px] font-mono">
                    <div class="flex justify-between text-teal-300 font-bold">
                      <span>🎯 DOM Anchor</span>
                      <span>&lt;{activeSignature.tagName}&gt;</span>
                    </div>
                    {activeSignature.classes && activeSignature.classes.length > 0 && (
                      <div class="text-slate-400 truncate">Classes: {activeSignature.classes.join(', ')}</div>
                    )}
                    {activeSignature.textSnippet && (
                      <div class="text-slate-300 italic truncate">"{activeSignature.textSnippet}"</div>
                    )}
                    <button
                      onClick={() => {
                        setActiveTab('adaptive');
                        handleTestAdaptive(activeSignature);
                      }}
                      class="w-full mt-1.5 py-1 bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border border-teal-500/30 rounded-lg text-[10px] font-semibold transition-all"
                    >
                      Test Self-Healing in Studio →
                    </button>
                  </div>
                )}

                <div class="space-y-2">
                  <label class="text-xs text-slate-400 font-medium">Save As Scraper Profile</label>
                  <div class="flex space-x-2">
                    <input 
                      type="text" 
                      placeholder="Profile Name (e.g. HN-Articles)" 
                      value={profileName} 
                      onChange={e => setProfileName(e.target.value)}
                      class="flex-1 px-3 py-1.5 bg-slate-900 border border-white/10 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                    <button 
                      onClick={handleSaveProfile}
                      class="px-3 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-xl text-xs font-bold transition-all active:scale-95"
                    >
                      Save
                    </button>
                  </div>
                </div>

                <div class="flex items-center space-x-4 pt-1">
                  <label class="flex items-center text-xs text-slate-400 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={includeImages} 
                      onChange={e => setIncludeImages(e.target.checked)}
                      class="rounded bg-slate-900 border-white/10 text-blue-500 mr-1.5"
                    />
                    Alt-Text
                  </label>
                  <label class="flex items-center text-xs text-slate-400 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={downloadMedia} 
                      onChange={e => setDownloadMedia(e.target.checked)}
                      class="rounded bg-slate-900 border-white/10 text-blue-500 mr-1.5"
                    />
                    Save Media
                  </label>
                  <label class="flex items-center text-xs text-slate-400 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={noMeta} 
                      onChange={e => setNoMeta(e.target.checked)}
                      class="rounded bg-slate-900 border-white/10 text-blue-500 mr-1.5"
                    />
                    Skip Meta
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Mode 2: Link Batch */}
          {consoleMode === 'batch' && (
            <div class="space-y-4 animate-fade-in">
              <div class="space-y-2">
                <div class="flex justify-between items-center">
                  <label class="text-xs text-slate-400 font-medium">Index / Listing Page</label>
                  <button onClick={() => setUrl('https://news.ycombinator.com')} class="text-[10px] text-blue-400 hover:underline">
                    HN Sample
                  </button>
                </div>
                <input 
                  type="url" 
                  placeholder="https://example.com/blog" 
                  value={url} 
                  onChange={e => setUrl(e.target.value)}
                  class="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div class="space-y-2">
                <label class="text-xs text-slate-400 font-medium">Subpage Link Selector</label>
                <div class="flex space-x-2">
                  <input 
                    type="text" 
                    placeholder="a.titleline, div.post a" 
                    value={selector} 
                    onChange={e => setSelector(e.target.value)}
                    class="flex-1 px-3 py-2 bg-slate-900 border border-white/10 rounded-xl text-xs text-emerald-400 font-mono"
                  />
                  <button 
                    onClick={async () => {
                      if (!url) return showToast('Enter URL first', 'error');
                      setAutoDetecting(true);
                      try {
                        const data = await safeFetchJson('/api/auto-selector', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ url })
                        });
                        if (data.selector) {
                          setSelector(data.selector);
                          showToast(`Detected selector: ${data.selector}`, 'success');
                        }
                      } finally { setAutoDetecting(false); }
                    }}
                    disabled={autoDetecting || !url}
                    class="px-3 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 rounded-xl text-xs font-bold"
                  >
                    {autoDetecting ? '...' : '🪄 Auto'}
                  </button>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-2">
                <div class="space-y-1">
                  <label class="text-[10px] text-slate-400 font-medium">Concurrency</label>
                  <input 
                    type="number" 
                    value={batchConcurrency} 
                    onChange={e => setBatchConcurrency(e.target.value)}
                    class="w-full px-2.5 py-1.5 bg-slate-900 border border-white/10 rounded-xl text-xs text-slate-200"
                  />
                </div>
                <div class="space-y-1">
                  <label class="text-[10px] text-slate-400 font-medium">Delay (ms)</label>
                  <input 
                    type="number" 
                    value={batchDelay} 
                    onChange={e => setBatchDelay(e.target.value)}
                    class="w-full px-2.5 py-1.5 bg-slate-900 border border-white/10 rounded-xl text-xs text-slate-200"
                  />
                </div>
              </div>

              <button 
                onClick={handleDiscoverLinks} 
                disabled={loading || discovering || !selector}
                class="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center shadow-lg"
              >
                {discovering ? '🔍 Discovering Links...' : '🔍 Discover Links Matching Selector'}
              </button>

              {discoveredUrls.length > 0 && (
                <div class="space-y-2 bg-slate-900/90 border border-white/10 p-3 rounded-xl">
                  <div class="flex justify-between items-center">
                    <span class="text-xs font-bold text-slate-200">📄 {discoveredUrls.length} Discovered Links</span>
                    <button onClick={() => setDiscoveredUrls([])} class="text-[10px] text-slate-500 hover:text-slate-300">Clear</button>
                  </div>
                  <div class="max-h-24 overflow-y-auto custom-scrollbar space-y-1 p-1 bg-slate-950 rounded-lg text-[9px] font-mono text-slate-400">
                    {discoveredUrls.map((u, i) => (
                      <div key={i} class="truncate" title={u}>• {u}</div>
                    ))}
                  </div>
                  <button
                    onClick={handleStartBatchScrape}
                    disabled={loading || batchProgress?.active}
                    class="w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-lg"
                  >
                    ⚡ Scrape All Discovered Links in Parallel
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Mode 3: Spider with Checkpoints & Pause/Resume */}
          {consoleMode === 'spider' && (
            <div class="space-y-4 animate-fade-in">
              {/* Checkpoint Resume Drawer */}
              {checkpoints.length > 0 && (
                <div class="p-3 bg-indigo-950/40 border border-indigo-500/30 rounded-xl space-y-2">
                  <div class="flex justify-between items-center text-xs font-bold text-indigo-300">
                    <span>💾 Saved Checkpoints</span>
                    <span class="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20">{checkpoints.length} Pending</span>
                  </div>
                  <div class="space-y-1.5 max-h-28 overflow-y-auto custom-scrollbar">
                    {checkpoints.map(cp => (
                      <div key={cp.job_id} class="p-2 bg-slate-900 rounded-lg border border-white/5 flex justify-between items-center">
                        <div class="min-w-0 flex-1 pr-2">
                          <div class="text-xs font-semibold text-slate-200 truncate">{cp.job_id}</div>
                          <div class="text-[9px] text-slate-400 truncate">{cp.seed_url} • {cp.state?.visited?.length || 0} visited</div>
                        </div>
                        <div class="flex space-x-1 shrink-0">
                          <button
                            onClick={() => handleStartSpider(cp.job_id)}
                            disabled={spiderActive}
                            class="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-bold"
                            title="Resume this crawl"
                          >
                            Resume
                          </button>
                          <button
                            onClick={() => handleDeleteCheckpoint(cp.job_id)}
                            class="px-1.5 py-1 bg-slate-800 hover:bg-red-600 text-slate-400 hover:text-white rounded text-[10px]"
                            title="Delete checkpoint"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div class="space-y-2">
                <label class="text-xs text-slate-400 font-medium">Seed URL</label>
                <input 
                  type="url" 
                  placeholder="https://example.com" 
                  value={url} 
                  onChange={e => setUrl(e.target.value)}
                  class="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div class="grid grid-cols-2 gap-2">
                <div class="space-y-1">
                  <label class="text-[10px] text-slate-400 font-medium">Max Depth</label>
                  <input 
                    type="text" 
                    value={spiderDepth} 
                    onChange={e => setSpiderDepth(e.target.value)}
                    class="w-full px-2.5 py-1.5 bg-slate-900 border border-white/10 rounded-xl text-xs text-slate-200"
                  />
                </div>
                <div class="space-y-1">
                  <label class="text-[10px] text-slate-400 font-medium">Page Budget</label>
                  <input 
                    type="number" 
                    value={spiderMaxPages} 
                    onChange={e => setSpiderMaxPages(e.target.value)}
                    class="w-full px-2.5 py-1.5 bg-slate-900 border border-white/10 rounded-xl text-xs text-slate-200"
                  />
                </div>
              </div>

              <div class="grid grid-cols-2 gap-2">
                <div class="space-y-1">
                  <label class="text-[10px] text-slate-400 font-medium">Concurrency</label>
                  <input 
                    type="number" 
                    value={spiderConcurrency} 
                    onChange={e => setSpiderConcurrency(e.target.value)}
                    class="w-full px-2.5 py-1.5 bg-slate-900 border border-white/10 rounded-xl text-xs text-slate-200"
                  />
                </div>
                <div class="space-y-1">
                  <label class="text-[10px] text-slate-400 font-medium">Delay (ms)</label>
                  <input 
                    type="number" 
                    value={spiderDelay} 
                    onChange={e => setSpiderDelay(e.target.value)}
                    class="w-full px-2.5 py-1.5 bg-slate-900 border border-white/10 rounded-xl text-xs text-slate-200"
                  />
                </div>
              </div>

              {/* Spider Control Buttons */}
              <div class="space-y-2">
                {!spiderActive ? (
                  <button 
                    onClick={() => handleStartSpider()} 
                    class="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/20 active:scale-95 flex items-center justify-center"
                  >
                    <span class="mr-1.5">🕸️</span>
                    Start Recursive Spider
                  </button>
                ) : (
                  <div class="grid grid-cols-2 gap-2">
                    <button
                      onClick={handlePauseSpider}
                      class="py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center justify-center shadow-lg"
                      title="Pause crawl and save checkpoint state"
                    >
                      <span class="mr-1">⏸️</span> Pause & Save
                    </button>
                    <button
                      onClick={handleCancelSpider}
                      class="py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center justify-center shadow-lg"
                      title="Stop crawl"
                    >
                      <span class="mr-1">🛑</span> Stop
                    </button>
                  </div>
                )}
              </div>

              {/* Live Spider Statistics & Logs */}
              {(spiderActive || spiderLogs.length > 0) && (
                <div class="space-y-3 bg-slate-900/90 border border-white/10 p-3.5 rounded-xl">
                  <div class="flex justify-between items-center">
                    <span class="text-xs font-bold text-slate-200">Crawl Metrics</span>
                    <span class={`text-[9px] font-bold px-2 py-0.5 rounded-full ${spiderActive ? 'bg-indigo-500/20 text-indigo-300 animate-pulse' : 'bg-emerald-500/20 text-emerald-300'}`}>
                      {spiderActive ? 'RUNNING' : 'COMPLETED'}
                    </span>
                  </div>

                  <div class="grid grid-cols-4 gap-1.5 text-center">
                    <div class="bg-slate-950 p-2 rounded-lg border border-white/5">
                      <div class="text-[9px] text-slate-400">Visited</div>
                      <div class="text-xs font-bold text-slate-100">{spiderStats.visited}</div>
                    </div>
                    <div class="bg-slate-950 p-2 rounded-lg border border-white/5">
                      <div class="text-[9px] text-slate-400">Queue</div>
                      <div class="text-xs font-bold text-slate-100">{spiderStats.queued}</div>
                    </div>
                    <div class="bg-slate-950 p-2 rounded-lg border border-white/5">
                      <div class="text-[9px] text-emerald-400">Ok</div>
                      <div class="text-xs font-bold text-emerald-300">{spiderStats.succeeded}</div>
                    </div>
                    <div class="bg-slate-950 p-2 rounded-lg border border-white/5">
                      <div class="text-[9px] text-red-400">Fail</div>
                      <div class="text-xs font-bold text-red-300">{spiderStats.failed}</div>
                    </div>
                  </div>

                  {/* Real-time pages stream */}
                  {spiderPages.length > 0 && (
                    <div class="space-y-1">
                      <div class="text-[10px] text-slate-400 font-semibold">Live Scraped Pages:</div>
                      <div class="max-h-24 overflow-y-auto custom-scrollbar space-y-1">
                        {spiderPages.map((pg, i) => (
                          <div key={i} class="p-1.5 bg-slate-950 rounded border border-white/5 flex justify-between items-center text-[9px]">
                            <span class="font-mono text-emerald-400 truncate max-w-[200px]" title={pg.filename}>{pg.filename}</span>
                            <span class="text-slate-500 shrink-0">{pg.time}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Terminal log output */}
                  <div class="h-28 overflow-y-auto custom-scrollbar bg-slate-950 border border-white/5 p-2 rounded-lg text-[9px] font-mono text-slate-400 space-y-1">
                    {spiderLogs.slice().reverse().map((log, idx) => (
                      <div key={idx} class="truncate" title={log}>{log}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Profiles section */}
          <div class="space-y-3 pt-3 border-t border-white/5 flex-1 flex flex-col min-h-[140px]">
            <h2 class="text-xs font-bold tracking-wider text-slate-400 uppercase">Saved Scraper Profiles</h2>
            <div class="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 max-h-[180px]">
              {profiles.length === 0 ? (
                <div class="text-xs text-slate-500 italic p-2">No profiles yet.</div>
              ) : (
                profiles.map(p => (
                  <div 
                    key={p.id} 
                    onClick={() => handleApplyProfile(p)}
                    class="p-2 rounded-xl bg-slate-900/60 hover:bg-slate-800 border border-white/5 cursor-pointer transition-all flex justify-between items-center group active:scale-98"
                  >
                    <div class="truncate pr-2">
                      <div class="text-xs font-semibold text-slate-200 truncate">{p.name}</div>
                      <div class="text-[10px] text-teal-400 font-mono truncate">{p.selectors?.content || 'auto'}</div>
                    </div>
                    <span class="text-[9px] text-blue-400 font-bold uppercase opacity-80 group-hover:opacity-100">Apply</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Recent Scrapes History */}
          <div class="space-y-3 pt-3 border-t border-white/5 flex-1 flex flex-col min-h-[180px]">
            <div class="flex justify-between items-center">
              <h2 class="text-xs font-bold tracking-wider text-slate-400 uppercase">Recent Scrapes ({history.length})</h2>
            </div>
            
            <div class="flex space-x-1.5">
              <input
                type="text"
                placeholder="Filter by category..."
                value={categoryFilter}
                onChange={e => {
                  setCategoryFilter(e.target.value);
                  loadData(e.target.value);
                }}
                class="w-full px-2.5 py-1 bg-slate-900 border border-white/10 rounded-lg text-xs text-slate-300 placeholder-slate-500"
              />
              {categoryFilter && (
                <button onClick={() => { setCategoryFilter(''); loadData(''); }} class="text-xs text-slate-400 hover:text-white px-1">
                  ✕
                </button>
              )}
            </div>

            <div class="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 max-h-[220px]">
              {history.length === 0 ? (
                <div class="text-xs text-slate-500 italic p-2">No past scrapes logged.</div>
              ) : (
                history.slice(0, 15).map(s => (
                  <div 
                    key={s.id} 
                    onClick={() => handleViewScrape(s)}
                    class="p-2 rounded-xl bg-slate-900/40 hover:bg-slate-800 border border-white/5 cursor-pointer transition-all flex items-start space-x-2 active:scale-98"
                  >
                    <span class={`text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 mt-0.5 ${s.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                      #{s.id}
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="text-xs text-slate-200 font-medium truncate">{s.title || s.url}</div>
                      <div class="text-[9px] text-slate-500 truncate">{s.url}</div>
                      {s.category && (
                        <span class="inline-block mt-0.5 text-[8px] bg-blue-500/10 text-blue-400 px-1 rounded font-semibold">
                          {s.category}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </section>

        {/* Right Main Display Panel */}
        <section class="flex-1 flex flex-col bg-slate-950 overflow-hidden relative">
          {/* Main Top Tab Navigation */}
          <div class="h-12 border-b border-white/5 flex items-center px-6 space-x-4 shrink-0 bg-slate-900/40">
            <button 
              onClick={() => setActiveTab('iframe')}
              class={`h-full px-3 text-xs font-bold border-b-2 transition-all flex items-center space-x-1.5 ${activeTab === 'iframe' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
            >
              <span>🌐</span>
              <span>Visual Target Preview</span>
            </button>
            <button 
              onClick={() => setActiveTab('markdown')}
              class={`h-full px-3 text-xs font-bold border-b-2 transition-all flex items-center space-x-1.5 ${activeTab === 'markdown' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
            >
              <span>📝</span>
              <span>Extracted Markdown</span>
            </button>
            <button 
              onClick={() => setActiveTab('query')}
              class={`h-full px-3 text-xs font-bold border-b-2 transition-all flex items-center space-x-1.5 ${activeTab === 'query' ? 'border-teal-500 text-teal-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
            >
              <span>🧪</span>
              <span>Live Query & REPL</span>
            </button>
            <button 
              onClick={() => setActiveTab('adaptive')}
              class={`h-full px-3 text-xs font-bold border-b-2 transition-all flex items-center space-x-1.5 ${activeTab === 'adaptive' ? 'border-purple-500 text-purple-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
            >
              <span>🎯</span>
              <span>Adaptive Studio</span>
            </button>
          </div>

          {/* Loading Overlay */}
          {loading && (
            <div class="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center z-50">
              <div class="relative w-14 h-14 mb-3">
                <div class="absolute inset-0 rounded-full border-4 border-blue-500/20 border-t-blue-500 animate-spin"></div>
              </div>
              <p class="text-xs font-bold text-blue-400 tracking-wider animate-pulse uppercase">PROCESSING REQUEST...</p>
            </div>
          )}

          {/* Tab 1: Visual Picker Iframe */}
          <div class={`flex-1 h-full w-full relative ${activeTab === 'iframe' ? 'block' : 'hidden'}`}>
            {iframeUrl ? (
              <iframe 
                ref={iframeRef}
                src={iframeUrl} 
                onLoad={() => setLoading(false)}
                class="w-full h-full border-none bg-white"
              ></iframe>
            ) : (
              <div class="w-full h-full flex flex-col items-center justify-center p-6 text-center space-y-3">
                <div class="text-5xl text-slate-700">🕸️</div>
                <h3 class="text-base font-bold text-slate-300">No Target URL Loaded in Visual Picker</h3>
                <p class="text-xs text-slate-500 max-w-md">Enter a URL in the left targeting panel and click "Proxy Page". The page will load with visual element highlighting enabled.</p>
              </div>
            )}
          </div>

          {/* Tab 2: Markdown Preview */}
          <div class={`flex-1 h-full overflow-auto custom-scrollbar p-6 ${activeTab === 'markdown' ? 'block' : 'hidden'}`}>
            {markdownOutput ? (
              <div class="space-y-4 max-w-4xl mx-auto">
                {lastDecision && (
                  <div class="bg-amber-950/30 border border-amber-500/30 p-3 rounded-xl flex items-center justify-between text-xs text-amber-200">
                    <div class="flex items-center space-x-2.5">
                      <span class="text-lg">🌳</span>
                      <div>
                        <div class="font-bold flex items-center space-x-2">
                          <span>Decision Tree Route: <span class="uppercase text-amber-400 font-mono px-1.5 py-0.5 bg-amber-500/20 rounded">{lastDecision.tier}</span></span>
                          <span class="text-amber-300/70 text-[11px]">({Math.round((lastDecision.confidence || 1) * 100)}% Confidence)</span>
                        </div>
                        <div class="text-[11px] text-amber-300/80 font-mono mt-0.5">{lastDecision.label}</div>
                      </div>
                    </div>
                    {lastDecision.explanation && (
                      <span class="text-[10px] text-slate-400 font-mono hidden md:inline-block max-w-xs truncate" title={lastDecision.explanation}>
                        {lastDecision.explanation}
                      </span>
                    )}
                  </div>
                )}
                <div class="flex justify-between items-center bg-slate-900 border border-white/5 p-3 rounded-xl">
                  <span class="text-xs text-slate-400 font-mono">Word Count: {markdownOutput.split(/\s+/).length}</span>
                  <button 
                    onClick={handleCopyMarkdown}
                    class="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-all active:scale-95 shadow-md shadow-blue-600/20"
                  >
                    Copy Markdown
                  </button>
                </div>
                <pre class="p-6 rounded-2xl border border-white/10 bg-slate-900 font-mono text-xs text-emerald-300 overflow-x-auto custom-scrollbar leading-relaxed whitespace-pre-wrap">
                  {markdownOutput}
                </pre>
              </div>
            ) : (
              <div class="w-full h-full flex flex-col items-center justify-center p-6 text-center space-y-3">
                <div class="text-5xl text-slate-700">📝</div>
                <h3 class="text-base font-bold text-slate-300">No Extracted Markdown</h3>
                <p class="text-xs text-slate-500 max-w-md">Click "Scrape Now" or click any scrape in Recent History to inspect high-fidelity GFM Markdown.</p>
              </div>
            )}
          </div>

          {/* Tab 3: Live Query & REPL Tester */}
          <div class={`flex-1 h-full overflow-auto custom-scrollbar p-6 ${activeTab === 'query' ? 'block' : 'hidden'}`}>
            <div class="max-w-4xl mx-auto space-y-5">
              <div class="p-5 bg-slate-900 border border-white/10 rounded-2xl space-y-4">
                <div class="flex justify-between items-center">
                  <div>
                    <h3 class="text-sm font-bold text-slate-200">🧪 Interactive Query & REPL Tester</h3>
                    <p class="text-xs text-slate-400">Test CSS, XPath, or Regex queries live on {url || 'target URL'}</p>
                  </div>
                  <div class="flex bg-slate-950 p-1 rounded-lg border border-white/10">
                    <button
                      onClick={() => setQueryType('css')}
                      class={`px-2.5 py-1 text-xs font-bold rounded ${queryType === 'css' ? 'bg-teal-600 text-white' : 'text-slate-400'}`}
                    >
                      CSS
                    </button>
                    <button
                      onClick={() => setQueryType('xpath')}
                      class={`px-2.5 py-1 text-xs font-bold rounded ${queryType === 'xpath' ? 'bg-teal-600 text-white' : 'text-slate-400'}`}
                    >
                      XPath
                    </button>
                    <button
                      onClick={() => setQueryType('regex')}
                      class={`px-2.5 py-1 text-xs font-bold rounded ${queryType === 'regex' ? 'bg-teal-600 text-white' : 'text-slate-400'}`}
                    >
                      Regex
                    </button>
                  </div>
                </div>

                <div class="flex space-x-2">
                  <input
                    type="text"
                    placeholder={queryType === 'css' ? 'e.g. h1, article a, table.itemlist' : queryType === 'xpath' ? 'e.g. //h1 | //a[@href]' : 'e.g. [a-zA-Z0-9]+'}
                    value={queryInput}
                    onChange={e => setQueryInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleRunQuery()}
                    class="flex-1 px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-xs text-teal-300 font-mono focus:outline-none focus:border-teal-500"
                  />
                  <button
                    onClick={handleRunQuery}
                    disabled={queryRunning || !url || !queryInput}
                    class="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all active:scale-95 shadow-md shadow-teal-600/20"
                  >
                    {queryRunning ? 'Evaluating...' : 'Run Query'}
                  </button>
                </div>

                <div class="flex items-center space-x-2 text-[11px] text-slate-400">
                  <span class="font-bold text-slate-500">Presets:</span>
                  <button onClick={() => { setQueryType('css'); setQueryInput('h1, h2'); }} class="hover:text-teal-300 underline">Headers</button>
                  <span>•</span>
                  <button onClick={() => { setQueryType('css'); setQueryInput('a[href]'); }} class="hover:text-teal-300 underline">Links</button>
                  <span>•</span>
                  <button onClick={() => { setQueryType('css'); setQueryInput('article'); }} class="hover:text-teal-300 underline">Articles</button>
                  <span>•</span>
                  <button onClick={() => { setQueryType('xpath'); setQueryInput('//a'); }} class="hover:text-teal-300 underline">XPath Anchors</button>
                </div>
              </div>

              {/* Query Results */}
              {queryResults && (
                <div class="space-y-3 animate-fade-in">
                  <div class="flex justify-between items-center text-xs text-slate-400 px-1">
                    <span class="font-bold text-slate-200">Matched {queryResults.count} Elements</span>
                    <span>Timing: <strong class="text-emerald-400">{queryResults.elapsed}ms</strong> • Tier: <strong class="text-blue-400 uppercase">{queryResults.fetcher}</strong></span>
                  </div>

                  <div class="space-y-2">
                    {queryResults.matches.map((m, idx) => (
                      <div key={idx} class="p-3 bg-slate-900 border border-white/5 rounded-xl space-y-1.5 font-mono text-xs">
                        <div class="flex justify-between items-center">
                          <span class="px-2 py-0.5 bg-teal-500/10 text-teal-300 rounded font-bold">&lt;{m.tag}&gt;</span>
                          <span class="text-[10px] text-slate-500">#{idx + 1}</span>
                        </div>
                        <div class="text-slate-200 font-sans">{m.text || '<empty text>'}</div>
                        {m.attribs && Object.keys(m.attribs).length > 0 && (
                          <div class="text-[10px] text-slate-400 truncate">
                            Attrs: {JSON.stringify(m.attribs)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Tab 4: Adaptive Self-Healing Studio */}
          <div class={`flex-1 h-full overflow-auto custom-scrollbar p-6 ${activeTab === 'adaptive' ? 'block' : 'hidden'}`}>
            <div class="max-w-4xl mx-auto space-y-5">
              <div class="p-5 bg-slate-900 border border-white/10 rounded-2xl space-y-3">
                <div class="flex justify-between items-center">
                  <div>
                    <h3 class="text-sm font-bold text-slate-200">🎯 Adaptive Self-Healing Studio</h3>
                    <p class="text-xs text-slate-400">Scrapling-inspired multi-anchor structural fingerprinting protects scrapers against website redesigns</p>
                  </div>
                  <button
                    onClick={() => handleTestAdaptive()}
                    disabled={testingAdaptive || !activeSignature}
                    class="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all active:scale-95 shadow-md shadow-purple-600/20"
                  >
                    {testingAdaptive ? 'Relocating...' : '⚡ Test Relocation on Target'}
                  </button>
                </div>

                {activeSignature ? (
                  <div class="grid grid-cols-2 gap-3 pt-2">
                    <div class="p-3 bg-slate-950 rounded-xl border border-white/5 space-y-1">
                      <div class="text-[10px] text-slate-500 uppercase font-bold">Anchor Tag & Hierarchy</div>
                      <div class="text-xs font-mono text-purple-300">&lt;{activeSignature.tagName}&gt; (parent: &lt;{activeSignature.parentTagName || 'body'}&gt;)</div>
                      <div class="text-[10px] text-slate-400 font-mono truncate">{activeSignature.content}</div>
                    </div>
                    <div class="p-3 bg-slate-950 rounded-xl border border-white/5 space-y-1">
                      <div class="text-[10px] text-slate-500 uppercase font-bold">Text & Class Anchors</div>
                      <div class="text-xs text-slate-200 truncate italic">"{activeSignature.textSnippet || 'N/A'}"</div>
                      <div class="text-[10px] text-teal-400 font-mono truncate">{activeSignature.classes?.join(', ') || 'No classes'}</div>
                    </div>
                  </div>
                ) : (
                  <div class="p-4 bg-slate-950/60 rounded-xl border border-dashed border-white/10 text-center text-xs text-slate-500">
                    Click any element in the "Visual Target Preview" tab to capture its live DOM structural fingerprint.
                  </div>
                )}
              </div>

              {/* Adaptive Self-Healing Result Card */}
              {adaptiveResult && (
                <div class="p-5 bg-slate-900 border border-purple-500/30 rounded-2xl space-y-3 animate-fade-in">
                  <div class="flex justify-between items-center">
                    <span class="text-xs font-bold text-slate-200">Self-Healing Engine Evaluation</span>
                    <span class={`px-2 py-0.5 rounded text-xs font-bold ${adaptiveResult.found ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-red-500/20 text-red-300'}`}>
                      {adaptiveResult.found ? `RECOVERED (${(adaptiveResult.confidence * 100).toFixed(1)}% Match)` : 'NO CONFIDENT MATCH'}
                    </span>
                  </div>

                  {adaptiveResult.found && (
                    <div class="space-y-2">
                      <div class="text-xs text-slate-400 font-mono">
                        Healed Selector: <strong class="text-purple-300">{adaptiveResult.healedSelector}</strong>
                      </div>
                      {adaptiveResult.match && (
                        <div class="p-3 bg-slate-950 rounded-xl border border-white/5 text-xs font-mono text-emerald-400">
                          {adaptiveResult.match.text}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Saved Domain Fingerprints Table */}
              <div class="p-5 bg-slate-900 border border-white/10 rounded-2xl space-y-3">
                <h4 class="text-xs font-bold text-slate-300 uppercase tracking-wider">Persisted Domain Fingerprints ({fingerprints.length})</h4>
                {fingerprints.length === 0 ? (
                  <div class="text-xs text-slate-500 italic">No persistent fingerprints in SQLite element_fingerprints table.</div>
                ) : (
                  <div class="space-y-2">
                    {fingerprints.map(fp => (
                      <div key={fp.id} class="p-3 bg-slate-950 rounded-xl border border-white/5 flex justify-between items-center text-xs">
                        <div>
                          <span class="font-bold text-slate-200">{fp.domain}</span>
                          <span class="text-slate-400 ml-2 font-mono text-[10px]">[{fp.name}]</span>
                          <div class="text-[10px] text-teal-400 font-mono truncate max-w-md">{JSON.stringify(fp.signature)}</div>
                        </div>
                        <button
                          onClick={async () => {
                            await safeFetchJson(`/api/fingerprints/${fp.id}`, { method: 'DELETE' });
                            loadData();
                          }}
                          class="px-2 py-1 bg-slate-800 hover:bg-red-600 text-slate-400 hover:text-white rounded text-[10px]"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Model Context Protocol (MCP) Modal */}
      {showMcpModal && (
        <div class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-6 animate-fade-in">
          <div class="bg-slate-900 border border-white/10 rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl">
            <div class="flex justify-between items-center">
              <div class="flex items-center space-x-2">
                <span class="text-2xl">🤖</span>
                <div>
                  <h3 class="text-sm font-bold text-slate-100">Model Context Protocol (MCP) Integration</h3>
                  <p class="text-[11px] text-slate-400">Connect Cursor, Claude Desktop, and Antigravity AI agents to Scrapi</p>
                </div>
              </div>
              <button onClick={() => setShowMcpModal(false)} class="text-slate-500 hover:text-white text-lg">✕</button>
            </div>

            <div class="space-y-3 text-xs">
              <div class="p-3 bg-slate-950 rounded-xl border border-white/5 space-y-1">
                <div class="text-[10px] text-slate-400 font-semibold uppercase">Stdio Launch Command</div>
                <div class="font-mono text-emerald-400 text-[11px]">node src/cli.js mcp</div>
              </div>

              <div class="space-y-1">
                <div class="text-[10px] text-slate-400 font-semibold uppercase">Exposed AI Tools</div>
                <div class="grid grid-cols-2 gap-2 text-[10px] font-mono">
                  <div class="p-2 bg-slate-950 rounded border border-white/5 text-teal-300">scrapi_fetch</div>
                  <div class="p-2 bg-slate-950 rounded border border-white/5 text-teal-300">scrapi_extract</div>
                  <div class="p-2 bg-slate-950 rounded border border-white/5 text-purple-300">scrapi_adaptive_query</div>
                  <div class="p-2 bg-slate-950 rounded border border-white/5 text-blue-300">scrapi_crawl</div>
                </div>
              </div>

              <div class="space-y-1">
                <div class="text-[10px] text-slate-400 font-semibold uppercase">Claude Desktop Config snippet</div>
                <pre class="p-3 bg-slate-950 rounded-xl border border-white/5 font-mono text-[10px] text-slate-300 overflow-x-auto">
{JSON.stringify(mcpInfo?.configSnippets?.claudeDesktop || {}, null, 2)}
                </pre>
              </div>
            </div>

            <button
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(mcpInfo?.configSnippets?.claudeDesktop || {}, null, 2));
                showToast('MCP config copied to clipboard!', 'success');
              }}
              class="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all"
            >
              Copy Claude Config JSON
            </button>
          </div>
        </div>
      )}

      {/* Floating Status Toast Notification */}
      {statusMsg.text && (
        <div class="fixed bottom-6 right-6 z-50 animate-bounce">
          <div class={`px-4 py-2.5 rounded-xl shadow-2xl flex items-center space-x-2 text-xs font-bold border ${
            statusMsg.type === 'success' ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/40' :
            statusMsg.type === 'error' ? 'bg-red-950/90 text-red-300 border-red-500/40' :
            'bg-blue-950/90 text-blue-300 border-blue-500/40'
          }`}>
            <span>{statusMsg.type === 'success' ? '✔' : statusMsg.type === 'error' ? '✖' : 'ℹ'}</span>
            <span>{statusMsg.text}</span>
          </div>
        </div>
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);