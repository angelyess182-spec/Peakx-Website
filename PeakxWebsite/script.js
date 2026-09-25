  // ===== WISP Configuration =====
  // Load custom WISP server from localStorage or use defaults
  const DEFAULT_WISP_SERVERS = [
    'wss://wisp.mercurywork.shop/',
    'wss://wisp.luminati.dev/',
    'wss://wisp.server.akash.network/',
    'wss://wisp-proxy.titaniumnetwork.dev/v1/',
    'wss://wisp.colmug.org/',
    'wss://wisp.letsblock.it/',
    'wss://wisp.mersedia.com/'
  ];
  
  let WISP_SERVERS = JSON.parse(localStorage.getItem('peakx_wisp_servers') || 'null') || DEFAULT_WISP_SERVERS;
  let WISP_SERVER = WISP_SERVERS[0];
  
  // Function to update WISP servers
  function updateWISPServers(servers) {
    WISP_SERVERS = servers;
    WISP_SERVER = servers[0];
    localStorage.setItem('peakx_wisp_servers', JSON.stringify(servers));
    console.log('✅ WISP servers updated:', servers);
    // Reinitialize libcurl with new servers
    initializeLibcurl().then(() => {
      // Test connection after reinitialization
      testWISPConnection();
    });
  }
  
  // ===== State =====
  let tabs = [{ id: genId(), url: '', title: 'New Tab', isActive: true, isLoading: false, history: [], historyIndex: -1, muted: false, pinned: false }];
  let favorites = JSON.parse(localStorage.getItem('peakx_favorites') || '[]');
  let tunnelStatus = 'connecting';
  let tunnelProxy = '...';
  let contextMenuTabId = null;
  let draggedTab = null;
  let chatHistory = [];
  let libcurlReady = false;

  // ===== Helpers =====
  function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
  function getPageTitle(url) { try { return new URL(url).hostname.replace('www.', ''); } catch { return url; } }
  function normalizeUrl(input) {
    let url = input.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (!url.includes('.') || url.includes(' ')) return 'https://www.google.com/search?q=' + encodeURIComponent(url);
      url = 'https://' + url;
    }
    return url;
  }
  function formatTime() {
    const now = new Date();
    return now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true });
  }
  function getActiveTab() { return tabs.find(t => t.isActive) || tabs[0]; }

  // ===== Initialize libcurl.js =====
  async function initializeLibcurl() {
    console.log('🚀 Initializing libcurl.js...');
    
    // Wait for libcurl.js to load
    let attempts = 0;
    const maxAttempts = 100;
    while (typeof libcurl === 'undefined' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
      if (attempts % 10 === 0) {
        console.log('⏳ Waiting for libcurl.js to load...', attempts);
      }
    }
    
    if (typeof libcurl === 'undefined') {
      console.error('❌ libcurl.js failed to load after', maxAttempts, 'attempts');
      // Show error message to user
      const statusText = document.getElementById('statusText');
      if (statusText) {
        statusText.textContent = 'WISP: Failed to load libcurl.js';
        statusText.style.color = '#ef4444';
      }
      return false;
    }
    
    // Try each WISP server until one works
    for (let i = 0; i < WISP_SERVERS.length; i++) {
      const server = WISP_SERVERS[i];
      try {
        console.log(`🧪 Testing WISP server ${i + 1}/${WISP_SERVERS.length}: ${server}`);
        
        // Configure WISP server
        libcurl.set_websocket(server);
        
        // Test connection with a simple request
        const testResponse = await libcurl.fetch('https://example.com', { method: 'HEAD' });
        
        if (testResponse.ok) {
          WISP_SERVER = server;
          libcurlReady = true;
          console.log('✅ WISP server connected successfully:', server);
          return true;
        } else {
          console.warn(`⚠️ WISP server ${server} returned non-OK status, trying next...`);
        }
      } catch (error) {
        console.warn(`⚠️ WISP server ${server} failed:`, error.message);
      }
    }
    
    // If all servers failed, still configure with first server and mark as ready
    console.warn('⚠️ All WISP servers failed tests, using first server anyway');
    libcurl.set_websocket(WISP_SERVERS[0]);
    WISP_SERVER = WISP_SERVERS[0];
    libcurlReady = true;
    return true;
  }

  // ===== Test WISP Connection Function =====
  async function testWISPConnection() {
    console.log('🧪 Testing WISP connection...');
    
    const statusText = document.getElementById('statusText');
    const homeText = document.getElementById('statusText');
    
    // Update status to show testing
    if (statusText) {
      statusText.textContent = 'WISP: Testing connection...';
      statusText.style.color = '#f59e0b';
    }
    if (homeText) {
      homeText.textContent = 'WISP: Testing connection...';
      homeText.style.color = '#f59e0b';
    }
    
    if (!libcurlReady) {
      const error = 'libcurl.js not initialized';
      console.error('❌', error);
      if (statusText) {
        statusText.textContent = 'WISP: ' + error;
        statusText.style.color = '#ef4444';
      }
      if (homeText) {
        homeText.textContent = 'WISP: ' + error;
        homeText.style.color = '#ef4444';
      }
      return { success: false, error };
    }
    
    const results = [];
    
    // Test each server
    for (let i = 0; i < WISP_SERVERS.length; i++) {
      const server = WISP_SERVERS[i];
      try {
        console.log(`🧪 Testing server ${i + 1}/${WISP_SERVERS.length}: ${server}`);
        
        libcurl.set_websocket(server);
        
        const startTime = Date.now();
        
        // Create timeout promise
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout after 10 seconds')), 10000)
        );
        
        // Race between fetch and timeout
        const testResponse = await Promise.race([
          libcurl.fetch('https://example.com', { method: 'HEAD' }),
          timeoutPromise
        ]);
        
        const latency = Date.now() - startTime;
        
        if (testResponse.ok) {
          results.push({ server, status: 'success', latency, message: `Connected in ${latency}ms` });
          console.log(`✅ Server ${server} connected successfully (${latency}ms)`);
        } else {
          results.push({ server, status: 'error', latency, message: `HTTP ${testResponse.status}` });
          console.warn(`⚠️ Server ${server} returned HTTP ${testResponse.status}`);
        }
      } catch (error) {
        const errorMessage = error.message || 'Unknown error';
        results.push({ server, status: 'failed', latency: 0, message: errorMessage });
        console.warn(`❌ Server ${server} failed:`, errorMessage);
      }
      
      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Find working server
    const workingServer = results.find(r => r.status === 'success');
    
    if (workingServer) {
      WISP_SERVER = workingServer.server;
      tunnelStatus = 'connected';
      tunnelProxy = `WISP (${workingServer.latency}ms)`;
      
      if (statusText) {
        statusText.textContent = `WISP: Connected via ${workingServer.server.split('/')[2]} (${workingServer.latency}ms)`;
        statusText.style.color = '#22c55e';
      }
      if (homeText) {
        homeText.textContent = `WISP: Connected via ${workingServer.server.split('/')[2]} (${workingServer.latency}ms)`;
        homeText.style.color = '#22c55e';
      }
      
      console.log('✅ WISP connection test completed. Best server:', workingServer.server);
      return { success: true, results, bestServer: workingServer };
    } else {
      tunnelStatus = 'disconnected';
      tunnelProxy = 'WISP (all servers failed)';
      
      if (statusText) {
        statusText.textContent = 'WISP: All servers failed';
        statusText.style.color = '#ef4444';
      }
      if (homeText) {
        homeText.textContent = 'WISP: All servers failed';
        homeText.style.color = '#ef4444';
      }
      
      console.error('❌ All WISP servers failed connection test');
      return { success: false, results, error: 'All servers failed' };
    }
  }

async function fetchViaWisp(url, retryCount = 0, serverIndex = 0) {
    if (!libcurlReady) {
      throw new Error('libcurl.js not initialized');
    }
    
    const maxRetries = 2;
    const currentServer = WISP_SERVERS[serverIndex % WISP_SERVERS.length];
    console.log(`🌐 Fetching via WISP: ${url} (attempt ${retryCount + 1}/${maxRetries + 1}, server: ${currentServer})`);
    
    try {
      // Ensure we're using the correct server
      libcurl.set_websocket(currentServer);
      
      const response = await libcurl.fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache'
        }
      });
      
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        error.server = currentServer;
        throw error;
      }
      
      const content = await response.text();
      
      // Validate content
      if (!content || content.length < 100) {
        const error = new Error('Received empty or invalid content');
        error.server = currentServer;
        throw error;
      }
      
      // Check if content looks like HTML
      if (!content.includes('<html') && !content.includes('<!DOCTYPE')) {
        console.warn('⚠️ Content may not be HTML, length:', content.length);
      }
      
      // Update active server if successful
      WISP_SERVER = currentServer;
      console.log('✅ Fetched', content.length, 'bytes via WISP from', currentServer);
      
      return { success: true, content, url };
    } catch (error) {
      const errorMessage = error.message || 'Unknown error';
      const errorDetails = `Server: ${currentServer} | Error: ${errorMessage}`;
      console.error(`❌ WISP fetch failed (attempt ${retryCount + 1}, server ${currentServer}):`, errorMessage);
      
      // Add server info to error for better debugging
      error.server = currentServer;
      error.serverIndex = serverIndex;
      error.details = errorDetails;
      
      // Try next server if available
      if (serverIndex < WISP_SERVERS.length - 1) {
        console.log(`🔄 Trying next WISP server (${serverIndex + 1}/${WISP_SERVERS.length - 1})...`);
        return fetchViaWisp(url, retryCount, serverIndex + 1);
      }
      
      // Retry on network errors or server errors
      if (retryCount < maxRetries && (
        errorMessage.includes('network') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('503') ||
        errorMessage.includes('502') ||
        errorMessage.includes('504') ||
        errorMessage.includes('connect') ||
        errorMessage.includes('7') // libcurl error 7
      )) {
        console.log(`🔄 Retrying in 1 second...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return fetchViaWisp(url, retryCount + 1, 0); // Reset server index on retry
      }
      
      // If we've tried all servers and retries, throw comprehensive error
      throw new Error(`Failed to connect to any WISP server. Last attempted: ${currentServer}. Error: ${errorMessage}. Try checking your internet connection or configure different WISP servers in settings.`);
    }
  }

  // ===== URL Rewriter =====
  function rewriteUrls(html, baseUrl) {
    try {
      const base = new URL(baseUrl);
      
      // Add base tag for relative URLs
      if (!html.includes('<base')) {
        html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${base.origin}/">`);
      }
      
      // Rewrite all relative URLs to absolute
      const attributes = ['href', 'src', 'action', 'poster', 'data-src', 'data-href'];
      
      attributes.forEach(attr => {
        // Match both single and double quotes
        const regex = new RegExp(`${attr}=["']([^"']+)["']`, 'gi');
        html = html.replace(regex, (match, url) => {
          // Skip data URLs, javascript, mailto, tel, etc.
          if (/^(javascript:|mailto:|tel:|data:|blob:|#)/i.test(url)) {
            return match;
          }
          
          try {
            const absolute = new URL(url, base).href;
            return `${attr}="${absolute}"`;
          } catch {
            return match;
          }
        });
      });
      
      // Rewrite CSS url() references
      html = html.replace(/url\(["']?([^"')]+)["']?\)/gi, (match, url) => {
        if (/^(data:|#)/i.test(url)) {
          return match;
        }
        try {
          const absolute = new URL(url, base).href;
          return `url("${absolute}")`;
        } catch {
          return match;
        }
      });
      
      return html;
    } catch (error) {
      console.warn('Failed to rewrite URLs:', error);
      return html;
    }
  }

  // ===== Runtime Script Injector =====
  function injectRuntime(html, pageUrl) {
    // Escape pageUrl for JavaScript
    const escapedUrl = pageUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    
    const runtimeScript = `
      <script>
        // PEAKX Runtime - Intercept navigation
        (function() {
          const PAGE_URL = "${escapedUrl}";
          
          // Intercept link clicks
          document.addEventListener('click', function(e) {
            const link = e.target.closest('a');
            if (link && link.href && !link.href.startsWith('javascript:')) {
              e.preventDefault();
              e.stopPropagation();
              window.parent.postMessage({
                type: 'navigate',
                url: link.href
              }, '*');
            }
          }, true);
          
          // Intercept form submissions
          document.addEventListener('submit', function(e) {
            const form = e.target;
            if (form && form.action) {
              e.preventDefault();
              e.stopPropagation();
              window.parent.postMessage({
                type: 'form-submit',
                url: form.action,
                method: form.method || 'GET'
              }, '*');
            }
          }, true);
          
          // Intercept window.open
          const originalOpen = window.open;
          window.open = function(url, name, features) {
            if (url && !url.startsWith('javascript:')) {
              window.parent.postMessage({
                type: 'navigate',
                url: url
              }, '*');
              return null;
            }
            return originalOpen.call(this, url, name, features);
          };
          
          console.log('PEAKX Runtime injected for:', PAGE_URL);
        })();
      <\/script>
    `;
    
    // Inject before closing body or at end
    if (html.includes('</body>')) {
      return html.replace('</body>', runtimeScript + '</body>');
    } else if (html.includes('</html>')) {
      return html.replace('</html>', runtimeScript + '</html>');
    }
    return html + runtimeScript;
  }

  // ===== Particles =====
  function createParticles() {
    const container = document.getElementById('particlesContainer');
    container.innerHTML = '';
    for (let i = 0; i < 50; i++) {
      const particle = document.createElement('div');
      particle.className = 'snowflake';
      const size = Math.random() * 4 + 2;
      particle.style.left = Math.random() * 100 + '%';
      particle.style.width = size + 'px';
      particle.style.height = size + 'px';
      particle.style.animation = 'snowfall ' + (Math.random() * 8 + 6) + 's linear ' + (Math.random() * 10) + 's infinite';
      particle.style.opacity = Math.random() * 0.5 + 0.3;
      container.appendChild(particle);
    }
  }

  // ===== Clock =====
  function updateClock() {
    const now = new Date();
    document.getElementById('dateDisplay').textContent = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('timezoneDisplay').textContent = formatTime();
  }

  // ===== Favorites =====
  function saveFavorites() { localStorage.setItem('peakx_favorites', JSON.stringify(favorites)); }
  function renderFavorites() {
    const grid = document.getElementById('favoritesGrid');
    grid.innerHTML = '';
    favorites.forEach(fav => {
      const item = document.createElement('div');
      item.className = 'favorite-item';
      item.innerHTML = '<img src="' + (fav.favicon || 'https://www.google.com/s2/favicons?domain=' + fav.url + '&sz=16') + '" onerror="this.style.display=\'none\'" /><span>' + fav.title + '</span><div class="favorite-remove" data-id="' + fav.id + '">×</div>';
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('favorite-remove')) {
          favorites = favorites.filter(f => f.id !== fav.id);
          saveFavorites();
          renderFavorites();
        } else {
          navigateTo(fav.url);
        }
      });
      grid.appendChild(item);
    });
  }

  // ===== Tabs =====
  function renderTabs() {
    const bar = document.getElementById('tabsBar');
    const homeBar = document.getElementById('homeTabsBar');
    
    [bar, homeBar].forEach(targetBar => {
      targetBar.innerHTML = '';
      tabs.forEach(tab => {
        const item = document.createElement('div');
        item.className = 'tab-item' + (tab.isActive ? ' active' : '') + (tab.pinned ? ' pinned' : '');
        item.setAttribute('data-tab-id', tab.id);
        item.draggable = true;
        
        let faviconHtml = '';
        if (tab.url && !tab.isLoading) {
          try {
            const hostname = new URL(tab.url).hostname;
            faviconHtml = '<img src="https://www.google.com/s2/favicons?domain=' + hostname + '&sz=16" style="width:16px;height:16px;border-radius:2px;margin-right:6px;" onerror="this.style.display=\'none\'" />';
          } catch(e) {}
        }
        
        item.innerHTML = (tab.isLoading ? '<div class="spinner" style="margin-right:6px;"></div>' : faviconHtml) + '<span class="tab-title">' + tab.title + '</span><span class="tab-close" data-id="' + tab.id + '">×</span>';
        
        item.addEventListener('click', (e) => {
          if (e.target.classList.contains('tab-close')) {
            closeTab(tab.id);
          } else {
            switchTab(tab.id);
          }
        });

        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          contextMenuTabId = tab.id;
          showContextMenu(e.clientX, e.clientY);
        });

        item.addEventListener('dragstart', (e) => {
          draggedTab = tab.id;
          item.classList.add('dragging');
        });

        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          draggedTab = null;
        });

        item.addEventListener('dragover', (e) => { e.preventDefault(); });

        item.addEventListener('drop', (e) => {
          e.preventDefault();
          if (draggedTab && draggedTab !== tab.id) {
            const fromIndex = tabs.findIndex(t => t.id === draggedTab);
            const toIndex = tabs.findIndex(t => t.id === tab.id);
            const [movedTab] = tabs.splice(fromIndex, 1);
            tabs.splice(toIndex, 0, movedTab);
            renderTabs();
          }
        });

        targetBar.appendChild(item);
      });

      const newBtn = document.createElement('button');
      newBtn.className = 'new-tab-btn';
      newBtn.textContent = '+';
      newBtn.addEventListener('click', addNewTab);
      targetBar.appendChild(newBtn);
    });
  }

  function addNewTab() {
    tabs.forEach(t => t.isActive = false);
    tabs.push({ id: genId(), url: '', title: 'New Tab', isActive: true, isLoading: false, history: [], historyIndex: -1, muted: false, pinned: false });
    renderTabs();
    
    // Clear content area when creating new tab
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#333;background:#0a0a0a;"><p>Ready to browse</p></div>';
    
    showHome();
  }

  function closeTab(id) {
    const idx = tabs.findIndex(t => t.id === id);
    const wasActive = tabs[idx]?.isActive;
    tabs = tabs.filter(t => t.id !== id);
    
    if (tabs.length === 0) {
      tabs.push({ id: genId(), url: '', title: 'New Tab', isActive: true, isLoading: false, history: [], historyIndex: -1, muted: false, pinned: false });
      renderTabs();
      showHome();
    } else if (wasActive) {
      tabs[tabs.length - 1].isActive = true;
      renderTabs();
      const active = getActiveTab();
      if (active.url) {
        showBrowser();
        // Restore content for the newly active tab
        const contentArea = document.getElementById('contentArea');
        document.getElementById('navUrl').value = active.url;
        document.getElementById('homeNavInput').value = active.url;
        document.getElementById('currentUrl').textContent = active.url;
        updateNavButtons();
      } else {
        showHome();
      }
    } else {
      renderTabs();
    }
  }

  function switchTab(id) {
    tabs.forEach(t => t.isActive = t.id === id);
    renderTabs();
    const active = getActiveTab();
    
    if (active.url) {
      showBrowser();
      // Restore the content for this tab
      const contentArea = document.getElementById('contentArea');
      const iframe = contentArea.querySelector('iframe');
      
      // Update URL bar
      document.getElementById('navUrl').value = active.url;
      document.getElementById('homeNavInput').value = active.url;
      document.getElementById('currentUrl').textContent = active.url;
      updateNavButtons();
      
      // If iframe exists but has different content, reload
      if (iframe && iframe.srcdoc) {
        // Content is already there, just make sure it's visible
        console.log('Switched to tab with URL:', active.url);
      } else if (active.url && !iframe) {
        // Need to reload the page
        navigateTo(active.url, active.id);
      }
    } else {
      showHome();
      // Clear content area
      const contentArea = document.getElementById('contentArea');
      contentArea.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#333;background:#0a0a0a;"><p>Ready to browse</p></div>';
    }
  }

  function showHome() {
    document.getElementById('homeScreen').classList.remove('hidden');
    document.getElementById('browserView').classList.remove('active');
    
    // Clear content area when showing home
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#333;background:#0a0a0a;"><p>Ready to browse</p></div>';
  }

  function showBrowser() {
    document.getElementById('homeScreen').classList.add('hidden');
    document.getElementById('browserView').classList.add('active');
  }

  // ===== Context Menu =====
  function showContextMenu(x, y) {
    const menu = document.getElementById('contextMenu');
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.add('active');
  }

  function hideContextMenu() {
    document.getElementById('contextMenu').classList.remove('active');
    contextMenuTabId = null;
  }

  // ===== Navigation =====
  async function navigateTo(url, tabId) {
    const tab = tabId ? tabs.find(t => t.id === tabId) : getActiveTab();
    if (!tab) return;
    const normalized = normalizeUrl(url);

    // Close AI chat when navigating
    closeAIChat();

    const newHistory = tab.history.slice(0, tab.historyIndex + 1).concat([normalized]);
    tab.url = normalized;
    tab.title = getPageTitle(normalized);
    tab.isLoading = true;
    tab.history = newHistory;
    tab.historyIndex = newHistory.length - 1;

    renderTabs();
    showBrowser();
    document.getElementById('navUrl').value = normalized;
    document.getElementById('homeNavInput').value = normalized;
    document.getElementById('currentUrl').textContent = normalized;
    document.getElementById('loadingBar').classList.add('active');
    updateNavButtons();

    console.log('🌐 Navigating to:', normalized);

    const contentArea = document.getElementById('contentArea');
    
    // Show loading indicator
    contentArea.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;background:#0a0a0a;color:#fff;font-family:sans-serif;">
        <div style="width:40px;height:40px;border:3px solid #333;border-top-color:#6366f1;border-radius:50%;animation:spin 1s linear infinite;"></div>
        <p style="margin-top:16px;color:#888;font-size:14px;">Loading ${normalized}...</p>
      </div>
    `;
    
    try {
      let result;
      
      console.log('🔍 Starting navigation via WISP...');
      // WISP only - no Service Worker, no CORS proxy fallback
      const fetchPromise = fetchViaWisp(normalized);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('WISP request timeout after 15 seconds')), 15000)
      );

      result = await Promise.race([fetchPromise, timeoutPromise]);
      console.log('✅ WISP connection successful');
      // Check if content is valid
      if (!result.content || result.content.length < 100) {
        throw new Error('Received empty or invalid content');
      }
      
      // Rewrite URLs
      let content = rewriteUrls(result.content, normalized);
      
      // Inject runtime script
      content = injectRuntime(content, normalized);
      
      // Create iframe with srcdoc
      const iframe = document.createElement('iframe');
      iframe.className = 'content-iframe';
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups' + (tab.muted ? '' : ' allow-autoplay'));
      iframe.srcdoc = content;
      
      // Wait for iframe to load
      const loadPromise = new Promise((resolve, reject) => {
        iframe.onload = () => resolve();
        iframe.onerror = () => reject(new Error('Failed to render page'));
        setTimeout(() => reject(new Error('Render timeout')), 10000);
      });
      
      contentArea.innerHTML = '';
      contentArea.appendChild(iframe);
      
      await loadPromise;
      
      tab.isLoading = false;
      renderTabs();
      document.getElementById('loadingBar').classList.remove('active');
      
      // Update tunnel status based on what worked
      tunnelStatus = 'connected';
      tunnelProxy = 'WISP';

      updateStatus();
      
      // Save to history
      const history = JSON.parse(localStorage.getItem('peakx_history') || '[]');
      history.unshift({ title: tab.title, url: normalized, timestamp: Date.now() });
      localStorage.setItem('peakx_history', JSON.stringify(history.slice(0, 100)));
      
      console.log('✅ Page loaded successfully');
      
    } catch (error) {
      console.error('❌ Navigation failed:', error);
      
      tab.isLoading = false;
      renderTabs();
      document.getElementById('loadingBar').classList.remove('active');
      
      // Extract error details
      const errorMessage = error.message || 'Unknown error occurred';
      const errorServer = error.server || 'Unknown server';
      const errorDetails = error.details || '';
      
      // Show detailed error
      contentArea.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;background:#0a0a0a;color:#fff;font-family:sans-serif;padding:40px;text-align:center;">
          <h1 style="font-size:48px;margin:0 0 16px;">⚠️</h1>
          <p style="color:#fff;font-size:18px;font-weight:600;">Failed to load page</p>
          <p style="color:#ef4444;margin:8px 0;font-size:14px;">${errorMessage}</p>
          ${errorDetails ? `<p style="color:#f59e0b;margin:8px 0;font-size:12px;padding:8px;background:#1a1a1a;border-radius:6px;">${errorDetails}</p>` : ''}
          <p style="color:#444;font-size:12px;margin-top:16px;padding:12px;background:#111;border-radius:8px;word-break:break-all;max-width:400px;">${normalized}</p>
          <p style="color:#555;font-size:12px;margin-top:12px;">WISP server may be down. You can configure different WISP servers in settings.</p>
          <div style="display:flex;gap:10px;margin-top:20px;">
            <button onclick="navigateTo('${normalized}')" style="padding:10px 20px;background:#6366f1;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;">Retry</button>
            <button onclick="document.getElementById('settingsBtn').click()" style="padding:10px 20px;background:#1a1a1a;color:#fff;border:1px solid #333;border-radius:8px;cursor:pointer;font-size:14px;">Configure WISP</button>
            
          </div>
        </div>
      `;
      
      // Update status to show connection issue
      tunnelStatus = 'disconnected';
      tunnelProxy = `WISP Error (${errorServer})`;
      updateStatus();
      
      console.warn('⚠️ Page load failed - WISP connection issue');
    }
  }

  function updateNavButtons() {
    const tab = getActiveTab();
    const canGoBack = tab.historyIndex > 0;
    const canGoForward = tab.historyIndex < tab.history.length - 1;
    
    document.getElementById('backBtn').disabled = !canGoBack;
    document.getElementById('forwardBtn').disabled = !canGoForward;
    document.getElementById('homeBackBtn').disabled = !canGoBack;
    document.getElementById('homeForwardBtn').disabled = !canGoForward;

    document.getElementById('backBtn').classList.toggle('can-navigate', canGoBack);
    document.getElementById('homeBackBtn').classList.toggle('can-navigate', canGoBack);
    document.getElementById('forwardBtn').classList.toggle('can-navigate', canGoForward);
    document.getElementById('homeForwardBtn').classList.toggle('can-navigate', canGoForward);
  }

  function updateStatus() {
    const dot = document.getElementById('statusDot2');
    const text = document.getElementById('statusText2');
    dot.className = 'status-dot' + (tunnelStatus === 'connected' ? '' : tunnelStatus === 'connecting' ? ' connecting' : ' disconnected');
    
    // Show appropriate label based on proxy type
    const proxyLabel = 'WISP';
    text.textContent = `${proxyLabel}: ${tunnelProxy}`;
    
    const homeDot = document.getElementById('statusDot');
    const homeText = document.getElementById('statusText');
    if (homeDot && homeText) {
      homeDot.className = 'status-dot' + (tunnelStatus === 'connected' ? '' : tunnelStatus === 'connecting' ? ' connecting' : ' disconnected');
      homeText.textContent = `${proxyLabel}: ${tunnelProxy}`;
    }
  }

  // ===== History Popup =====
  function showHistory() {
    const popup = document.getElementById('historyPopup');
    const list = document.getElementById('historyList');
    const history = JSON.parse(localStorage.getItem('peakx_history') || '[]');
    
    list.innerHTML = '';
    if (history.length === 0) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">No history yet</div>';
    } else {
      history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';
        const time = new Date(item.timestamp).toLocaleString();
        div.innerHTML = '<img src="https://www.google.com/s2/favicons?domain=' + item.url + '&sz=16" onerror="this.style.display=\'none\'" /><div class="history-item-content"><div class="history-item-url">' + item.url + '</div><div class="history-item-meta"><span>' + time + '</span></div></div>';
        div.addEventListener('click', () => {
          navigateTo(item.url);
          popup.classList.remove('active');
        });
        list.appendChild(div);
      });
    }
    
    popup.classList.add('active');
  }

  // ===== AI Chat =====
  function openAIChat() {
    document.getElementById('aiSidebar').classList.add('active');
  }

  function closeAIChat() {
    document.getElementById('aiSidebar').classList.remove('active');
  }

  async function sendAIMessage() {
    const input = document.getElementById('aiInput');
    const message = input.value.trim();
    if (!message) return;

    const messagesDiv = document.getElementById('aiMessages');
    const sendBtn = document.getElementById('aiSend');
    
    messagesDiv.innerHTML += '<div class="ai-message user">' + escapeHtml(message) + '</div>';
    input.value = '';
    sendBtn.disabled = true;
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // Add loading message
    const loadingId = 'loading-' + Date.now();
    messagesDiv.innerHTML += '<div class="ai-message loading" id="' + loadingId + '">Thinking...</div>';
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // Add to chat history
    chatHistory.push({ role: 'user', content: message });

    try {
      const response = await fetch('https://api.bazaarlink.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-bl-DDUhjdl99PbhSZzX592sycEFe8JAXX9Opg01ZBwWe5t_TQR_'
        },
        body: JSON.stringify({
          model: 'auto:free',
          messages: chatHistory,
          max_tokens: 2048
        })
      });

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content || 'Sorry, I could not process your request.';
      
      // Remove loading and add response
      document.getElementById(loadingId)?.remove();
      messagesDiv.innerHTML += '<div class="ai-message assistant">' + escapeHtml(reply) + '</div>';
      
      chatHistory.push({ role: 'assistant', content: reply });
    } catch (error) {
      document.getElementById(loadingId)?.remove();
      messagesDiv.innerHTML += '<div class="ai-message assistant">Sorry, there was an error: ' + escapeHtml(error.message) + '</div>';
    }

    sendBtn.disabled = false;
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ===== Event Listeners =====
  document.getElementById('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('searchInput').value.trim();
    if (q) navigateTo(q);
  });

  document.getElementById('navForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = document.getElementById('navUrl').value.trim();
    if (url) navigateTo(url);
  });

  document.getElementById('homeNavForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = document.getElementById('homeNavInput').value.trim();
    if (url) navigateTo(url);
  });

  document.getElementById('backBtn').addEventListener('click', () => {
    const tab = getActiveTab();
    if (tab.historyIndex > 0) {
      tab.historyIndex--;
      const url = tab.history[tab.historyIndex];
      tab.url = url;
      tab.title = getPageTitle(url);
      renderTabs();
      navigateTo(url, tab.id);
    }
  });

  document.getElementById('forwardBtn').addEventListener('click', () => {
    const tab = getActiveTab();
    if (tab.historyIndex < tab.history.length - 1) {
      tab.historyIndex++;
      const url = tab.history[tab.historyIndex];
      tab.url = url;
      tab.title = getPageTitle(url);
      renderTabs();
      navigateTo(url, tab.id);
    }
  });

  document.getElementById('homeBackBtn').addEventListener('click', () => {
    document.getElementById('backBtn').click();
  });

  document.getElementById('homeForwardBtn').addEventListener('click', () => {
    document.getElementById('forwardBtn').click();
  });

  document.getElementById('reloadBtn').addEventListener('click', () => {
    const tab = getActiveTab();
    if (tab.url) navigateTo(tab.url);
  });

  document.getElementById('homeReloadBtn').addEventListener('click', () => {
    document.getElementById('reloadBtn').click();
  });

  document.getElementById('homeBtn').addEventListener('click', () => {
    tabs.forEach(t => t.isActive = false);
    tabs.push({ id: genId(), url: '', title: 'New Tab', isActive: true, isLoading: false, history: [], historyIndex: -1, muted: false, pinned: false });
    renderTabs();
    showHome();
  });

  document.getElementById('homeHomeBtn').addEventListener('click', () => {
    document.getElementById('homeBtn').click();
  });

  document.getElementById('fullscreenBtn').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => console.log(err));
    } else {
      document.exitFullscreen();
    }
  });

  document.getElementById('historyBtn').addEventListener('click', () => {
    showHistory();
  });

  document.getElementById('aiChatBtn').addEventListener('click', openAIChat);
  document.getElementById('aiClose').addEventListener('click', closeAIChat);
  document.getElementById('aiSend').addEventListener('click', sendAIMessage);
  document.getElementById('aiInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAIMessage();
    }
  });

  // WISP Settings
  document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('wispSettingsModal').classList.add('active');
    document.getElementById('wispServersInput').value = WISP_SERVERS.join('\n');
  });

  document.getElementById('wispSettingsCancel').addEventListener('click', () => {
    document.getElementById('wispSettingsModal').classList.remove('active');
  });

  document.getElementById('wispSettingsSave').addEventListener('click', () => {
    const serversText = document.getElementById('wispServersInput').value.trim();
    const servers = serversText.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    
    if (servers.length === 0) {
      alert('Please enter at least one WISP server URL');
      return;
    }
    
    updateWISPServers(servers);
    document.getElementById('wispSettingsModal').classList.remove('active');
    alert('WISP servers updated. Reconnecting...');
  });

  document.getElementById('wispTestConnection').addEventListener('click', async () => {
    const testBtn = document.getElementById('wispTestConnection');
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    
    const result = await testWISPConnection();
    
    testBtn.disabled = false;
    testBtn.textContent = 'Test Connection';
    
    if (result.success) {
      alert(`✅ WISP Connection successful!\n\nBest server: ${result.bestServer.server}\nLatency: ${result.bestServer.latency}ms\n\nResults:\n${result.results.map(r => `${r.server.split('/')[2]}: ${r.message}`).join('\n')}`);
    } else {
      alert(`❌ WISP Connection failed!\n\nAll servers failed to connect. The browser will automatically use CORS proxy as fallback.\n\nTry:\n1. Check your internet connection\n2. Add different WISP servers\n3. Check if any servers are temporarily down\n\nResults:\n${result.results.map(r => `${r.server.split('/')[2]}: ${r.message}`).join('\n')}`);
      useCorsProxy = true; // Use CORS proxy as fallback
      tunnelStatus = 'connected';
      tunnelProxy = 'CORS Proxy (WISP failed)';
      updateStatus();
    }
  });

  document.getElementById('wispSettingsModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('wispSettingsModal')) {
      document.getElementById('wispSettingsModal').classList.remove('active');
    }
  });

  // Context menu actions
  document.querySelectorAll('.context-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      const action = item.getAttribute('data-action');
      const tab = tabs.find(t => t.id === contextMenuTabId);
      if (!tab) return;

      if (action === 'reload') {
        if (tab.url) navigateTo(tab.url, tab.id);
      } else if (action === 'mute') {
        tab.muted = !tab.muted;
        if (tab.isActive && tab.url) navigateTo(tab.url, tab.id);
      } else if (action === 'pin') {
        tab.pinned = !tab.pinned;
        renderTabs();
      } else if (action === 'close') {
        closeTab(tab.id);
      }

      hideContextMenu();
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu')) {
      hideContextMenu();
    }
    if (!e.target.closest('.history-popup') && !e.target.closest('#historyBtn')) {
      document.getElementById('historyPopup').classList.remove('active');
    }
  });

  // Star button
  document.getElementById('starBtn').addEventListener('click', () => {
    const tab = getActiveTab();
    if (tab.url) {
      try {
        const hostname = new URL(tab.url).hostname;
        favorites.push({ id: genId(), url: tab.url, title: tab.title, favicon: 'https://www.google.com/s2/favicons?domain=' + hostname + '&sz=32' });
        saveFavorites();
        renderFavorites();
      } catch {}
    }
  });

  // Modal
  document.getElementById('addFavBtn').addEventListener('click', () => {
    document.getElementById('modalOverlay').classList.add('active');
    document.getElementById('modalUrl').focus();
  });
  document.getElementById('modalCancel').addEventListener('click', () => {
    document.getElementById('modalOverlay').classList.remove('active');
  });
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalOverlay')) {
      document.getElementById('modalOverlay').classList.remove('active');
    }
  });
  document.getElementById('modalAdd').addEventListener('click', () => {
    const url = document.getElementById('modalUrl').value.trim();
    const title = document.getElementById('modalTitle').value.trim();
    if (url) {
      const normalized = normalizeUrl(url);
      try {
        const hostname = new URL(normalized).hostname;
        favorites.push({ id: genId(), url: normalized, title: title || getPageTitle(normalized), favicon: 'https://www.google.com/s2/favicons?domain=' + hostname + '&sz=32' });
      } catch {
        favorites.push({ id: genId(), url: normalized, title: title || normalized });
      }
      saveFavorites();
      renderFavorites();
      document.getElementById('modalOverlay').classList.remove('active');
      document.getElementById('modalUrl').value = '';
      document.getElementById('modalTitle').value = '';
    }
  });

  // Listen for messages from iframe
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'navigate' && event.data.url) {
      navigateTo(event.data.url);
    } else if (event.data?.type === 'form-submit') {
      navigateTo(event.data.url);
    }
  });

  // ===== Init =====
  console.log('🚀 PEAKX Browser starting...');
  
  // Hide loading message
  const loadingMessage = document.getElementById('loadingMessage');
  if (loadingMessage) {
    loadingMessage.style.display = 'none';
  }
  
  try {
    createParticles();
    updateClock();
    setInterval(updateClock, 1000);
    renderFavorites();
    renderTabs();
    console.log('✅ UI initialized');
  } catch (error) {
    console.error('❌ UI initialization failed:', error);
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#000;color:#fff;font-family:sans-serif;text-align:center;padding:20px;">
        <div>
          <h1 style="font-size:32px;margin-bottom:20px;">⚠️ PEAKX Browser Error</h1>
          <p style="color:#888;margin-bottom:10px;">Failed to initialize UI</p>
          <p style="color:#666;font-size:14px;">${error.message}</p>
          <button onclick="location.reload()" style="margin-top:20px;padding:10px 20px;background:#6366f1;color:#fff;border:none;border-radius:8px;cursor:pointer;">Reload</button>
        </div>
      </div>
    `;
  }

  // Initialize libcurl.js
  initializeLibcurl().then(success => {
    console.log('📡 libcurl initialization result:', success);
    if (success) {
      // Test WISP connection after initialization
      testWISPConnection().then(testResult => {
        console.log('🧪 WISP test result:', testResult);
        if (testResult.success) {
          console.log('✅ PEAKX ready with libcurl.js + WISP');
      } else {
        alert(`❌ WISP Connection failed!\n\nAll servers failed to connect.\n\nTry:\n1. Check your internet connection\n2. Add different WISP servers\n3. Check if any servers are temporarily down\n\nResults:\n${result.results.map(r => `${r.server.split('/')[2]}: ${r.message}`).join('\n')}`);
        tunnelStatus = 'disconnected';
        tunnelProxy = 'WISP unavailable';
        updateStatus();
      }
      });
    } else {
      console.warn('⚠️ libcurl initialization returned false - WISP unavailable');
      tunnelStatus = 'disconnected';
      tunnelProxy = 'WISP unavailable';
      updateStatus();
      console.warn('⚠️ libcurl initialization returned false - WISP unavailable');
      tunnelStatus = 'disconnected';
      tunnelProxy = 'WISP unavailable';
      updateStatus();
    }
  }).catch(error => {
    console.error('❌ libcurl initialization error:', error);
    tunnelStatus = 'disconnected';
    tunnelProxy = 'WISP error';
    updateStatus();
  });