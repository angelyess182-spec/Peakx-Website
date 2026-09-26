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
  
  // ===== Blacklist =====
  let BLACKLIST = [];
  async function loadBlacklist() {
    try {
      const res = await fetch('config/blacklist.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      BLACKLIST = Array.isArray(data.domains || data.blacklist || data) ? (data.domains || data.blacklist || data) : [];
      console.log('🚫 Blacklist loaded:', BLACKLIST.length, 'domains');
    } catch (e) {
      console.warn('Blacklist file not available, using defaults:', e.message);
      BLACKLIST = [
        'roblox.com', 'discord.com', 'discord.gg', 'discordapp.com',
        'youtube.com', 'netflix.com', 'twitch.tv', 'instagram.com',
        'facebook.com', 'tiktok.com', 'snapchat.com', 'spotify.com'
      ];
    }
  }
  function isBlacklisted(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      return BLACKLIST.some(d => host === d || host.endsWith('.' + d));
    } catch { return false; }
  }

  // ===== State =====
  let tabs = [{ id: genId(), url: '', title: 'New Tab', isActive: true, isLoading: false, history: [], historyIndex: -1, muted: false, pinned: false, contentCache: {} }];
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
    let url = (input || '').trim();
    // Bare IP address (e.g. "104.18.34.148" or "104.18.34.148/path") -> treat as host, not search
    if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(url)) return 'https://' + url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      // If it looks like a hostname (no spaces, first label has no dots/protocol junk), keep it
      const firstToken = url.split(/[/?#]/)[0];
      const looksLikeHost = !url.includes(' ') && /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(firstToken) && firstToken.includes('.');
      if (!looksLikeHost) return 'https://www.google.com/search?q=' + encodeURIComponent(url);
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
      
      const reqHeaders = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache'
      };
      try {
        const ck = cookieHeaderFor(new URL(url).hostname);
        if (ck) reqHeaders['Cookie'] = ck;
      } catch (e) {}
      const response = await libcurl.fetch(url, {
        method: 'GET',
        headers: reqHeaders
      });
      try {
        const h = response.headers || {};
        const sc = (h.get && h.get('set-cookie')) || h['set-cookie'] || h['Set-Cookie'];
        storeCookies(Array.isArray(sc) ? sc : (sc ? [sc] : null), new URL(url).hostname);
      } catch (e) {}
      
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
      throw new Error(`Failed to connect to any WISP server. Last attempted: ${currentServer}. Error: ${errorMessage}. Try checking your internet connection.`);
    }
  }

  // ===== Sub-resource fetching via WISP (with cache) =====
  const resourceCache = new Map(); // absoluteUrl -> Promise<{content, contentType}>
  async function fetchResourceViaWisp(absUrl) {
    if (resourceCache.has(absUrl)) return resourceCache.get(absUrl);
    const promise = (async () => {
      if (!libcurlReady) throw new Error('libcurl not ready');
      libcurl.set_websocket(WISP_SERVER);
      const resHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
      try { const ck = cookieHeaderFor(new URL(absUrl).hostname); if (ck) resHeaders['Cookie'] = ck; } catch (e) {}
      const resp = await libcurl.fetch(absUrl, { headers: resHeaders });
      const ct = (resp.headers && (resp.headers['content-type'] || resp.headers['Content-Type'])) || '';
      let content;
      if (/text|json|xml|javascript|css|html|svg/i.test(ct) || !ct) {
        content = await resp.text();
      } else {
        const buf = await resp.arrayBuffer();
        // convert binary to data URL
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        content = 'data:' + (ct || 'application/octet-stream') + ';base64,' + btoa(bin);
      }
      return { content, contentType: ct, status: resp.status, setCookies: resp.headersSet ? resp.headersSet.get('set-cookie') : (resp.headers['set-cookie'] ? [resp.headers['set-cookie']] : null) };
    })();
    resourceCache.set(absUrl, promise);
    promise.catch(() => resourceCache.delete(absUrl)); // don't cache failures
    return promise;
  }

  // ===== Cookie jar (per host) so logins/sessions survive across page+asset requests =====
  const cookieJar = {}; // hostname -> { name: value }
  function storeCookies(setCookieHeaders, host) {
    if (!setCookieHeaders || !setCookieHeaders.length) return;
    const jar = cookieJar[host] = cookieJar[host] || {};
    setCookieHeaders.forEach(sc => {
      const pair = String(sc).split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    });
  }
  function cookieHeaderFor(host) {
    const jar = cookieJar[host];
    if (!jar) return null;
    const s = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
    return s || null;
  }

  // ===== URL Rewriter =====
  function rewriteUrls(html, baseUrl) {
    try {
      const base = new URL(baseUrl);

      // Resolve any URL against the page's base and route it through the proxy runtime
      const proxify = (rawUrl) => {
        if (/^(javascript:|mailto:|tel:|data:|blob:|about:|#)/i.test(rawUrl)) return null;
        try {
          const abs = new URL(rawUrl, base).href;
          if (!/^https?:\/\//i.test(abs)) return null;
          return "window.__PEAKX_URL__('" + abs.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "')";
        } catch {
          return null;
        }
      };

      // Rewrite src/href of resource tags to go through the WISP runtime loader
      // <script src="..."> -> <script src="javascript:void(0)" data-peakx-src="...">
      html = html.replace(/<script\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (match, url) => {
        const target = (() => {
          if (/^(javascript:|data:|blob:|#)/i.test(url)) return url;
          try { return new URL(url, base).href; } catch { return url; }
        })();
        const attrs = match.match(/^<script\b([^>]*)>/i);
        let extra = attrs ? attrs[1].replace(/\s*\b(src|type)=["'][^"']*["']/gi, '') : '';
        // preserve type="module" by converting to classic load via import fallback
        return `<script${extra} data-peakx-src="${target}"><\/script>`;
      });

      html = html.replace(/<(link|img|source|video|audio|iframe|embed|track)\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>/gi,
        (match, tag, pre, url, post) => {
          const fullAttrs = pre + 'src="' + url + '"' + post;
          if (tag === 'iframe' || tag === 'embed') {
            // iframes/embeds get loaded as proxied documents by runtime
            const t = (() => { try { return new URL(url, base).href; } catch { return url; } })();
            return `<${tag}${pre}data-peakx-src="${t}" src="about:blank"${post}></${tag}>`;
          }
          const t = (() => { try { return new URL(url, base).href; } catch { return url; } })();
          return `<${tag}${pre}data-peakx-src="${t}" src="about:blank"${post}>`;
        });

      // <link href="..."> for stylesheets/icons
      html = html.replace(/<link\b([^>]*?)\bhref=["']([^"']+)["']([^>]*)>/gi, (match, pre, url, post) => {
        if (/^(javascript:|data:|#)/i.test(url)) return match;
        let t; try { t = new URL(url, base).href; } catch { return match; }
        return `<link${pre}data-peakx-href="${t}" href="about:blank"${post}>`;
      });

      // <link rel="preload"> for fonts/scripts/styles: convert to data-peakx-href so the
      // runtime fetches them through WISP instead of failing cross-origin.
      html = html.replace(/<link\b([^>]*?)\brel=["'](?:preload|modulepreload)["']([^>]*)>/gi, (match, pre, post) => {
        const asMatch = (pre + post).match(/\bas=["'](\w+)["']/i);
        const as = asMatch ? asMatch[1].toLowerCase() : '';
        if (as === 'font' || as === 'script' || as === 'style') {
          return match.replace(/\bhref=(["'])([^"']+)\1/i, (m2, q, u) => {
            let t; try { t = new URL(u, base).href; } catch { return m2; }
            return `data-peakx-preload="${as}" data-peakx-href=${q}${t}${q} href=""`;
          });
        }
        return match;
      });

      // <a href> / <form action>: keep absolute URLs (runtime intercepts clicks/submits)
      const navAttrs = ['href', 'action', 'poster', 'data-src', 'data-href'];
      navAttrs.forEach(attr => {
        const regex = new RegExp(`\\b${attr}=["']([^"']+)["']`, 'gi');
        html = html.replace(regex, (match, url) => {
          if (/^(javascript:|mailto:|tel:|data:|blob:|#)/i.test(url)) return match;
          try { return match.replace(url, new URL(url, base).href); } catch { return match; }
        });
      });

      // Inline <style> blocks and style attr url(): replace with a placeholder token that the
      // runtime resolves to a blob: object URL fetched through WISP (fixes broken backgrounds/icons).
      html = html.replace(/url\((['"])([^'"]+)\1\)|url\(([^)]*)\)/gi, (match, q1, uq, unq) => {
        const url = (uq !== undefined ? uq : unq || '').trim();
        if (!url || /^(data:|about:|javascript:|#)/i.test(url)) return match;
        let abs; try { abs = new URL(url, base).href; } catch { return match; }
        return 'url("___PEAKXURL___' + abs.replace(/["')\\]/g, encodeURIComponent) + '___")';
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
        // PEAKX Runtime - full interception + WISP sub-resource loader
        (function() {
          const PAGE_URL = "${escapedUrl}";

          function resolve(u) { try { return new URL(u, PAGE_URL).href; } catch { return u; } }

          function notifyParent(msg) { try { window.parent.postMessage(msg, '*'); } catch(e){} }

          // ---- Resource loader via parent WISP fetch ----
          let reqId = 0;
          const pendingReqs = {};
          function wispFetch(url) {
            return new Promise((resolveP, rejectP) => {
              const id = ++reqId;
              pendingReqs[id] = { resolve: resolveP, reject: rejectP };
              notifyParent({ type: 'peakx-fetch', id: id, url: url });
              setTimeout(() => { if (pendingReqs[id]) { delete pendingReqs[id]; rejectP(new Error('fetch timeout')); } }, 20000);
            });
          }
          window.addEventListener('message', (e) => {
            const d = e.data;
            if (!d || !d.__peakxResp) return;
            if (typeof d.id === 'string' && d.id[0] === 'u' && pendingObjReqs[d.id]) {
              const p = pendingObjReqs[d.id];
              delete pendingObjReqs[d.id];
              p(d.ok && d.objUrl ? d.objUrl : null);
              return;
            }
            const p = pendingReqs[d.id];
            if (!p) return;
            delete pendingReqs[d.id];
            if (d.ok) p.resolve(d); else p.reject(new Error(d.error || 'WISP fetch failed'));
          });

          // Object-URL request (for CSS url() values): returns a Promise<blobUrl|originalUrl>
          let objReqId = 0;
          const pendingObjReqs = {};
          function wispObjUrl(url) {
            return new Promise((resolveP) => {
              const id = 'u' + (++objReqId);
              pendingObjReqs[id] = resolveP;
              notifyParent({ type: 'peakx-url', id: id, url: url });
              setTimeout(() => { if (pendingObjReqs[id]) { delete pendingObjReqs[id]; resolveP(url); } }, 20000);
            });
          }
          window.__PEAKX_URL_OBJ__ = wispObjUrl;
          window.__PEAKX_URL__ = function(u) {
            // Synchronous contexts (JS-assigned URLs): kick off async swap on next element style use.
            // Returns the absolute URL directly; elements are handled by processNode/observers instead.
            return u;
          };

          async function loadScript(el) {
            const src = el.getAttribute('data-peakx-src');
            if (!src) return;
            try {
              const r = await wispFetch(src);
              const s = document.createElement('script');
              s.textContent = r.content;
              if (el.defer) s.defer = true;
              document.head.appendChild(s);
            } catch (err) { console.warn('PEAKX: failed to load script', src, err); }
          }

          let fontId = 0;
          async function loadLink(el) {
            const href = el.getAttribute('data-peakx-href');
            if (!href) return;
            const rel = (el.getAttribute('rel') || '').toLowerCase();
            const preloadAs = (el.getAttribute('data-peakx-preload') || '').toLowerCase();
            if (rel.includes('stylesheet') || preloadAs === 'style' || preloadAs === 'script') {
              try {
                const r = await wispFetch(href);
                let css = r.content;
                // Rewrite CSS url(...) references through the WISP loader (fixes missing backgrounds/icons/fonts)
                css = css.replace(/url\\((["']?)([^"')]+)\\1\\)/gi, (m, q, u) => {
                  if (/^(data:|#|about:|javascript:)/i.test(u)) return m;
                  let abs; try { abs = new URL(u, href).href; } catch { return m; }
                  return 'url("' + window.__PEAKX_URL__(abs) + '")';
                });
                const st = document.createElement('style');
                st.textContent = css;
                document.head.appendChild(st);
              } catch (err) { console.warn('PEAKX: failed to load stylesheet', href, err); }
            } else if (preloadAs === 'font') {
              try {
                const r = await wispFetch(href);
                const dataUrl = r.dataUrl || ('data:' + (r.contentType || 'font/woff2') + ';base64,' + r.base64);
                const fs = new FontFace('peakx-font-' + (++fontId), 'url("' + dataUrl + '")');
                await fs.load();
                document.fonts.add(fs);
              } catch (err) { console.warn('PEAKX: failed to load preloaded font', href, err); }
            } else if (rel.includes('icon')) {
              el.href = href; // favicons can load directly
            } else {
              el.href = href;
            }
          }

          async function loadImage(el) {
            const src = el.getAttribute('data-peakx-src');
            if (!src) return;
            try {
              const r = await wispFetch(src);
              el.src = r.dataUrl || ('data:' + (r.contentType || 'image/png') + ';base64,' + r.base64);
            } catch (err) {
              // fallback: direct URL (may work if not blocked)
              el.src = resolve(src);
            }
          }

          function processNode(node) {
            if (!node || node.nodeType !== 1) return;
            if (node.tagName === 'SCRIPT' && node.hasAttribute('data-peakx-src')) loadScript(node);
            else if (node.tagName === 'LINK' && node.hasAttribute('data-peakx-href')) loadLink(node);
            else if (node.tagName === 'IMG' && node.hasAttribute('data-peakx-src')) loadImage(node);
            else if (node.hasAttribute('data-peakx-src')) {
              const t = node.getAttribute('data-peakx-src');
              if (node.tagName === 'IFRAME' || node.tagName === 'EMBED' || node.tagName === 'SOURCE' || node.tagName === 'TRACK' || node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
                node.src = resolve(t); // media/iframes: best-effort direct
              }
            }
            const styleAttr = node.getAttribute && node.getAttribute('style');
            if (styleAttr && /url\\(/i.test(styleAttr)) {
              node.setAttribute('style', styleAttr.replace(/url\\((["']?)([^"')]+)\\1\\)/gi, (m, q, u) => /^(data:|#)/i.test(u) ? m : 'url("' + resolve(u) + '")'));
            }
          }

          const observer = new MutationObserver((muts) => {
            muts.forEach(m => {
              m.addedNodes.forEach(n => {
                processNode(n);
                if (n.querySelectorAll) n.querySelectorAll('[data-peakx-src],[data-peakx-href]').forEach(processNode);
                if (n.nodeType === 1) {
                  if ((n.getAttribute && n.getAttribute('style') || '').includes('___PEAKXURL___')) resolveStyleTokens(n);
                  if (n.tagName === 'STYLE' && (n.textContent || '').includes('___PEAKXURL___')) {
                    replaceCssTokens(n.textContent, PAGE_URL).then(out => { n.textContent = out; });
                  }
                }
              });
            });
          });

          function boot() {
            observer.observe(document.documentElement, { childList: true, subtree: true });
            document.querySelectorAll('script[data-peakx-src],link[data-peakx-href],img[data-peakx-src],[data-peakx-src]').forEach(processNode);
            resolveStyleTokens(document.documentElement);
            // Also fix url() tokens inside <style> blocks by replacing them with fetched blob URLs
            document.querySelectorAll('style').forEach(async (st) => {
              const t = st.textContent || '';
              if (!t.includes('___PEAKXURL___')) return;
              const out = await replaceCssTokens(t, PAGE_URL);
              st.textContent = out;
            });
          }

          async function replaceCssTokens(cssText, cssUrl) {
            const matches = cssText.match(/url\("___PEAKXURL___[^_]*___"\)/g) || [];
            let out = cssText;
            for (const m of matches) {
              const raw = m.slice(m.indexOf('___PEAKXURL___') + 14, m.lastIndexOf('___'));
              let abs; try { abs = decodeURIComponent(raw); } catch { continue; }
              const objUrl = await window.__PEAKX_URL_OBJ__(abs);
              out = out.split(m).join('url("' + (objUrl || abs) + '")');
            }
            return out;
          }
          if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

          // ---- Title reporting ----
          function reportTitle() {
            if (document.title) notifyParent({ type: 'peakx-title', url: PAGE_URL, title: document.title });
          }
          new MutationObserver(reportTitle).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
          window.addEventListener('load', reportTitle);
          setTimeout(reportTitle, 500);

          // ---- Navigation interception ----
          document.addEventListener('click', function(e) {
            const link = e.target.closest && e.target.closest('a');
            if (link && link.href && !/^javascript:/i.test(link.href)) {
              if (link.target === '_blank') { /* let postMessage handle as new tab nav */ }
              e.preventDefault();
              e.stopPropagation();
              notifyParent({ type: 'navigate', url: link.href });
            }
          }, true);

          document.addEventListener('submit', function(e) {
            const form = e.target;
            if (form && form.tagName === 'FORM') {
              e.preventDefault();
              e.stopPropagation();
              const method = (form.method || 'GET').toUpperCase();
              if (method === 'GET') {
                const params = new URLSearchParams(new FormData(form)).toString();
                const base = resolve(form.action || PAGE_URL).split('#')[0];
                notifyParent({ type: 'navigate', url: base + (params ? (base.includes('?') ? '&' : '?') + params : '') });
              } else {
                notifyParent({ type: 'form-submit', url: resolve(form.action || PAGE_URL), method: method, body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
              }
            }
          }, true);

          // ---- location.href / assign / replace interception ----
          try {
            const navTo = (u) => notifyParent({ type: 'navigate', url: resolve(u) });
            window.location.assign = function(u) { navTo(u); };
            window.location.replace = function(u) { navTo(u); };
            // window.open -> navigate in same tab context
            const originalOpen = window.open;
            window.open = function(url) {
              if (url && !/^javascript:/i.test(url)) { navTo(url); return null; }
              return originalOpen.apply(this, arguments);
            };
          } catch (e) { console.warn('PEAKX: location hook limited', e); }

          // ---- fetch / XMLHttpRequest interception via WISP ----
          const origFetch = window.fetch.bind(window);
          window.fetch = function(input, init) {
            try {
              const u = typeof input === 'string' ? input : (input && input.url) || String(input);
              const abs = resolve(u);
              if (/^https?:/i.test(abs)) {
                return wispFetch(abs).then(r => new Response(
                (typeof r.content === 'string') ? r.content : (r.binaryBase64 ? Uint8Array.from(atob(r.binaryBase64), c => c.charCodeAt(0)) : ''),
                { status: r.status || 200, headers: { 'Content-Type': r.contentType || 'text/plain' } }
              )).catch(() => origFetch(input, init));
              }
            } catch (e) {}
            return origFetch(input, init);
          };

          const OrigXHR = window.XMLHttpRequest;
          window.XMLHttpRequest = function() {
            const xhr = new OrigXHR();
            const origOpen = xhr.open;
            let targetUrl = '';
            xhr.open = function(method, url) {
              targetUrl = resolve(url);
              return origOpen.apply(xhr, [method, 'data:,']); // avoid direct network
            };
            const origSend = xhr.send;
            xhr.send = function(body) {
              wispFetch(targetUrl).then(r => {
                Object.defineProperty(xhr, 'status', { get: () => r.status || 200 });
                Object.defineProperty(xhr, 'readyState', { get: () => 4 });
                Object.defineProperty(xhr, 'responseText', { get: () => r.content });
                Object.defineProperty(xhr, 'response', { get: () => r.content });
                xhr.onreadystatechange && xhr.onreadystatechange();
                xhr.onload && xhr.onload();
                xhr.onloadend && xhr.onloadend();
              }).catch(err => { xhr.onerror && xhr.onerror(err); });
            };
            return xhr;
          };

          // ---- meta refresh interception ----
          const meta = document.querySelector('meta[http-equiv="refresh" i]');
          if (meta) {
            const c = meta.getAttribute('content') || '';
            const m = c.match(/url=(.*)$/i);
            if (m) { meta.remove(); notifyParent({ type: 'navigate', url: resolve(m[1].trim().replace(/^["']|["']$/g, '')) }); }
          }

          // ---- Resolve ___PEAKXURL___...___ tokens in inline styles: fetch via WISP -> blob URL ----
          async function resolveStyleTokens(root) {
            const nodes = [(root || document.documentElement)];
            if (root && root.querySelectorAll) nodes.push(...root.querySelectorAll('[style*="___PEAKXURL___"]'));
            for (const n of nodes) {
              const st = n.getAttribute && n.getAttribute('style');
              if (st && st.includes('___PEAKXURL___')) {
                let out = st;
                const matches = out.match(/___PEAKXURL___([^_]*)___/g) || [];
                for (const m of matches) {
                  const raw = m.slice('___PEAKXURL___'.length, -3);
                  let abs; try { abs = decodeURIComponent(raw); } catch { continue; }
                  const objUrl = await window.__PEAKX_URL_OBJ__(abs);
                  out = out.replace(m, objUrl || abs);
                }
                n.setAttribute('style', out);
              }
            }
          }

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
    tabs.push({ id: genId(), url: '', title: 'New Tab', isActive: true, isLoading: false, history: [], historyIndex: -1, muted: false, pinned: false, contentCache: {} });
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
      tabs.push({ id: genId(), url: '', title: 'New Tab', isActive: true, isLoading: false, history: [], historyIndex: -1, muted: false, pinned: false, contentCache: {} });
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
      
      // Update URL bar
      document.getElementById('navUrl').value = active.url;
      document.getElementById('homeNavInput').value = active.url;
      document.getElementById('currentUrl').textContent = active.url;
      updateNavButtons();
      
      // Keep the live iframe if it belongs to this tab (preserves session/scroll/state).
      // Only recreate from cache if the current iframe is missing or belongs to another URL.
      const existing = contentArea.querySelector('iframe');
      if (existing && existing.getAttribute('data-peakx-url') === active.url) {
        // nothing to do: live DOM restored as-is
      } else if (active.contentCache && active.contentCache[active.url]) {
        const cached = active.contentCache[active.url];
        const iframe = document.createElement('iframe');
        iframe.className = 'content-iframe';
        iframe.setAttribute('data-peakx-url', active.url);
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups' + (active.muted ? '' : ' allow-autoplay'));
        iframe.srcdoc = cached.html;
        contentArea.innerHTML = '';
        contentArea.appendChild(iframe);
      } else {
        // No cache for this tab yet -> load it
        navigateTo(active.url, active.id);
      }
    } else {
      showHome();
      // Clear content area (contentArea already declared above)
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

    // Blacklist check
    if (isBlacklisted(normalized)) {
      showBrowser();
      document.getElementById('loadingBar').classList.remove('active');
      const contentArea = document.getElementById('contentArea');
      contentArea.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;background:#0a0a0a;color:#fff;font-family:sans-serif;padding:40px;text-align:center;">
          <h1 style="font-size:48px;margin:0 0 16px;">🚫</h1>
          <p style="color:#fff;font-size:18px;font-weight:600;">Site blocked by PeakX blacklist</p>
          <p style="color:#555;font-size:12px;margin-top:12px;word-break:break-all;max-width:400px;">${normalized}</p>
        </div>
      `;
      return;
    }

    // Tab content cache: instant restore when revisiting a known URL
    if (tab.contentCache && tab.contentCache[normalized]) {
      const cached = tab.contentCache[normalized];
      const live = document.getElementById('contentArea').querySelector('iframe');
      if (live && live.getAttribute('data-peakx-url') === normalized) {
        // Live iframe already showing this page in this tab: reuse it, no reload
        tab.url = normalized;
        tab.title = cached.title || getPageTitle(normalized);
        const idxL = tab.history.indexOf(normalized);
        if (idxL >= 0) { tab.historyIndex = idxL; } else {
          tab.history = tab.history.slice(0, tab.historyIndex + 1).concat([normalized]);
          tab.historyIndex = tab.history.length - 1;
        }
        renderTabs();
        showBrowser();
        document.getElementById('navUrl').value = normalized;
        document.getElementById('homeNavInput').value = normalized;
        document.getElementById('currentUrl').textContent = normalized;
        updateNavButtons();
        return;
      }
      tab.url = normalized;
      tab.title = cached.title || getPageTitle(normalized);
      const idx = tab.history.indexOf(normalized);
      if (idx >= 0) { tab.historyIndex = idx; } else {
        tab.history = tab.history.slice(0, tab.historyIndex + 1).concat([normalized]);
        tab.historyIndex = tab.history.length - 1;
      }
      renderTabs();
      showBrowser();
      document.getElementById('navUrl').value = normalized;
      document.getElementById('homeNavInput').value = normalized;
      document.getElementById('currentUrl').textContent = normalized;
      updateNavButtons();
      const contentArea = document.getElementById('contentArea');
      const iframe = document.createElement('iframe');
      iframe.className = 'content-iframe';
      iframe.setAttribute('data-peakx-url', normalized);
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups' + (tab.muted ? '' : ' allow-autoplay'));
      iframe.srcdoc = cached.html;
      contentArea.innerHTML = '';
      contentArea.appendChild(iframe);
      return;
    }

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
      
      // Extract real <title> from proxied page (fallback to hostname until runtime reports it)
      const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (titleMatch && titleMatch[1].trim()) {
        tab.title = titleMatch[1].trim().slice(0, 60);
        renderTabs();
      }

      // Cache rendered HTML per tab so switching tabs / back-forward is instant
      tab.contentCache = tab.contentCache || {};
      tab.contentCache[normalized] = { html: content, title: tab.title };

      // Create iframe with srcdoc
      const iframe = document.createElement('iframe');
      iframe.className = 'content-iframe';
      iframe.setAttribute('data-peakx-url', normalized);
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
          <p style="color:#555;font-size:12px;margin-top:12px;">WISP server may be down. Check your connection and try again.</p>
          <div style="display:flex;gap:10px;margin-top:20px;">
            <button onclick="navigateTo('${normalized}')" style="padding:10px 20px;background:#6366f1;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;">Retry</button>
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
    tabs.push({ id: genId(), url: '', title: 'New Tab', isActive: true, isLoading: false, history: [], historyIndex: -1, muted: false, pinned: false, contentCache: {} });
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

  // ===== Object-URL cache: turn WISP-fetched resources into blob URLs (for CSS url(), <link>, etc.) =====
  const objUrlCache = new Map(); // absUrl -> Promise<blobUrl or null>
  async function getObjUrl(absUrl) {
    if (objUrlCache.has(absUrl)) return objUrlCache.get(absUrl);
    const p = (async () => {
      try {
        const r = await fetchResourceViaWisp(absUrl);
        let blob;
        if (typeof r.content === 'string' && r.content.startsWith('data:')) {
          const res = await fetch(r.content); // data URL decode (same-origin, safe)
          blob = await res.blob();
        } else if (typeof r.content === 'string') {
          blob = new Blob([r.content], { type: r.contentType || 'text/plain' });
        } else {
          blob = r.content instanceof Blob ? r.content : new Blob([r.content]);
        }
        return URL.createObjectURL(blob);
      } catch (e) {
        console.warn('PEAKX: object URL failed for', absUrl, e.message);
        return null;
      }
    })();
    objUrlCache.set(absUrl, p);
    p.then(v => { if (v === null) objUrlCache.delete(absUrl); });
    return p;
  }

  async function handlePeakxUrl(event, d) {
    const respond = (payload) => { try { event.source.postMessage({ __peakxResp: true, id: d.id, ...payload }, '*'); } catch (e) {} };
    try {
      const iframe = event.source && event.source.frameElement;
      const pageUrl = iframe && iframe.getAttribute('data-peakx-url');
      if (!pageUrl || !d.url) throw new Error('no context');
      const abs = new URL(d.url, pageUrl).href;
      if (isBlacklisted(abs)) throw new Error('blocked');
      const objUrl = await getObjUrl(abs);
      if (!objUrl) throw new Error('fetch failed');
      respond({ ok: true, objUrl: objUrl });
    } catch (err) {
      respond({ ok: false, error: err.message });
    }
  }

  // ===== Bridge: answer sub-resource fetch requests coming from proxied iframes =====
  async function handlePeakxFetch(event, d) {
    const iframe = event.source && event.source.frameElement;
    const pageUrl = iframe && iframe.getAttribute('data-peakx-url');
    const respond = (payload) => { try { event.source.postMessage({ __peakxResp: true, id: d.id, ...payload }, '*'); } catch (e) {} };
    try {
      if (!pageUrl || !d.url) throw new Error('no context');
      const abs = new URL(d.url, pageUrl).href;
      if (isBlacklisted(abs)) throw new Error('blocked');
      const r = await fetchResourceViaWisp(abs);
      try { storeCookies(r.setCookies, new URL(abs).hostname); } catch (e) {}
      if (typeof r.content === 'string') {
        respond({ ok: true, content: r.content, contentType: r.contentType, status: r.status || 200 });
      } else {
        // Binary resource: pass raw bytes as base64 too (for fetch()/XHR consumers)
        let b64 = '';
        try {
          const blob = r.content instanceof Blob ? r.content : null;
          if (blob) {
            const buf = new Uint8Array(await blob.arrayBuffer());
            let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
            b64 = btoa(bin);
          }
        } catch (e) {}
        respond({ ok: true, dataUrl: r.content, binaryBase64: b64, contentType: r.contentType, status: r.status || 200 });
      }
    } catch (err) {
      respond({ ok: false, error: err.message });
    }
  }

  // Listen for messages from iframe
  window.addEventListener('message', (event) => {
    const d = event.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'navigate' && d.url) {
      navigateTo(d.url);
    } else if (d.type === 'form-submit') {
      navigateTo(d.url);
    } else if (d.type === 'peakx-title' && d.title) {
      const tab = getActiveTab();
      if (tab && tab.url === d.url) {
        tab.title = String(d.title).slice(0, 60);
        if (tab.contentCache && tab.contentCache[d.url]) tab.contentCache[d.url].title = tab.title;
        renderTabs();
      }
    } else if (d.type === 'peakx-fetch' && d.id) {
      handlePeakxFetch(event, d);
    } else if (d.type === 'peakx-url' && d.id) {
      handlePeakxUrl(event, d);
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
    loadBlacklist(); // async; uses hardcoded fallback if file missing (e.g. opened via file://)
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
