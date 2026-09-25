#!/usr/bin/env python3
# One-shot extraction: inline JS -> script.js, remove CORS fallback, fix rewriteUrls bug.
path = 'PeakxWebsite/index.html'
text = open(path, encoding='utf-8').read()
crlf = '\r\n' in text
s = text.replace('\r\n', '\n')

# --- 1. Extract big inline JS block ---
# It starts at the 2-space-indented '<script>' that is followed by the WISP config comment
# (there is another literal '<script>' inside a template string further down, so rfind on
# the tag alone is unreliable; anchor on the unique comment instead).
anchor = '// ===== WISP Configuration ====='
ai = s.index(anchor)
i0 = s.rfind('  <script>\n', 0, ai)
i1 = s.rfind('\n  </script>')
assert i0 != -1 and i1 > ai, (i0, i1, ai)
js_body = s[i0 + len('  <script>\n'): i1]
j = '\n'.join(ln[2:] if ln.startswith('  ') else ln for ln in js_body.split('\n'))

# index.html: replace block with external script tag
s = s[:i0].rstrip('\n') + '\n\n  <script src="script.js"></script>' + s[i1 + len('\n  </script>'):]

# --- HTML copy cleanup ---
def rep(old, new, label):
    global s
    if old in s:
        s = s.replace(old, new); print('OK  : html -', label)
    else:
        print('MISS: html -', label)

rep('The browser will try each server in order, and fall back to CORS proxy if all fail.',
    'The browser will try each server in order.', 'modal text')

# --- JS edits ---
def r(old, new, label):
    global j
    if old in j:
        j = j.replace(old, new); print('OK  : js -', label)
    else:
        print('MISS: js -', label)

def rlines(start_marker, end_marker, label):
    """Delete from line containing start_marker up to (not incl.) line containing end_marker."""
    global j
    a = j.find(start_marker)
    b = j.find(end_marker, a) if a != -1 else -1
    if a == -1 or b == -1:
        print('MISS: js -', label, (a, b)); return
    la = j.rfind('\n', 0, a) + 1
    removed = j[la:b]
    j = j[:la] + j[b:]
    print('OK  : js -', label, f'({removed.count(chr(10))} lines removed)')

# Remove CORS proxies array + fetchViaCorsProxy function entirely
rlines('// ===== CORS Proxy Configuration =====', 'async function fetchViaWisp', 'CORS block removal')

# useCorsProxy declaration removal (line-based)
lines = j.split('\n')
out = [ln for ln in lines if 'let useCorsProxy' not in ln]
print(('OK  : js - useCorsProxy decl (%d line)' % (len(lines)-len(out))) if len(out)<len(lines) else 'MISS: js - useCorsProxy decl')
j = '\n'.join(out)

# Navigation fallback -> WISP only (line-range based)
a = j.find("console.log('🔍 Starting navigation.")
b = j.find("// Check if content is valid")
assert a != -1 and b != -1 and b > a, (a, b)
la = j.rfind('\n', 0, a) + 1
indent = j[la:j.find('console.log', la)]
new_nav = (indent + "console.log('🔍 Starting navigation via WISP...');\n"
  + indent + "// WISP only - no Service Worker, no CORS proxy fallback\n"
  + indent + "const fetchPromise = fetchViaWisp(normalized);\n"
  + indent + "const timeoutPromise = new Promise((_, reject) =>\n"
  + indent + "  setTimeout(() => reject(new Error('WISP request timeout after 15 seconds')), 15000)\n"
  + indent + ");\n\n"
  + indent + "result = await Promise.race([fetchPromise, timeoutPromise]);\n"
  + indent + "console.log('✅ WISP connection successful');\n")
lb = j.rfind('\n', 0, b) + 1
j = j[:la] + new_nav + j[lb:]
print('OK  : js - nav fallback rewritten')

# result.proxy branch
a = j.find("if (result.proxy) {")
assert a != -1
b = j.find("}", j.find("tunnelProxy = 'WISP';", a))
la = j.rfind('\n', 0, a) + 1
indent = j[la:a]
j = j[:la] + indent + "tunnelStatus = 'connected';\n" + indent + "tunnelProxy = 'WISP';\n" + j[b+1:]
print('OK  : js - result.proxy branch')

r('WISP server may be down. The browser will automatically try CORS proxy as fallback, or you can configure different WISP servers.',
  'WISP server may be down. You can configure different WISP servers in settings.', 'error page text')

r("""<button onclick="useCorsProxy = false; navigateTo('${normalized}')" style="padding:10px 20px;background:#1a1a1a;color:#fff;border:1px solid #333;border-radius:8px;cursor:pointer;font-size:14px;">Force WISP</button>""",
  "", "Force WISP button")

r("const proxyLabel = tunnelProxy.includes('CORS') ? 'Proxy' : 'WISP';",
  "const proxyLabel = 'WISP';", "proxyLabel")

# Test handler failure branch: rebuild the else-block line-wise
lines = j.split('\n')
ai_ = next(i for i, ln in enumerate(lines) if 'alert(`✅ WISP Connection successful!' in ln)
bi_ = next(i for i, ln in enumerate(lines) if ai_ < i and '❌ WISP Connection failed!' in ln)
else_line_i = next(i for i in range(bi_, len(lines)) if lines[i].strip().startswith('} else {'))
base_indent = len(lines[else_line_i]) - len(lines[else_line_i].lstrip())
end_i = next(i for i in range(else_line_i+1, len(lines)) if lines[i].strip() == '}' and (len(lines[i])-len(lines[i].lstrip())) == base_indent)
new_else = ['      } else {',
            '        alert(`❌ WISP Connection failed!\\n\\nAll servers failed to connect.\\n\\nTry:\\n1. Check your internet connection\\n2. Add different WISP servers\\n3. Check if any servers are temporarily down\\n\\nResults:\\n${result.results.map(r => `${r.server.split(\'/\')[2]}: ${r.message}`).join(\'\\n\')}`);',
            "        tunnelStatus = 'disconnected';",
            "        tunnelProxy = 'WISP unavailable';",
            '        updateStatus();',
            '      }']
lines = lines[:else_line_i] + new_else + lines[end_i+1:]
j = '\n'.join(lines)
print('OK  : js - test handler failure branch')

# Init chain: remove useCorsProxy assignments & CORS statuses (line-wise targeted)
lines = j.split('\n')
out = []
i = 0
while i < len(lines):
    ln = lines[i]
    if 'useCorsProxy = false; // Use WISP if it works' in ln:
        i += 1; continue
    if 'will use CORS proxy fallback' in ln:
        out.append("          console.warn('⚠️ PEAKX initialized but WISP connection test failed');")
        out.append("          tunnelStatus = 'disconnected';")
        out.append("          tunnelProxy = 'WISP unavailable';")
        out.append('          updateStatus();')
        i += 1
        while i < len(lines) and any(k in lines[i] for k in ('useCorsProxy = true', "tunnelStatus = 'connected'", 'tunnelProxy = ', 'updateStatus();')):
            i += 1
        continue
    if 'using CORS proxy' in ln or 'mark as connected with warning and use CORS proxy' in ln:
        out.append("      console.warn('⚠️ libcurl initialization returned false - WISP unavailable');")
        out.append("      tunnelStatus = 'disconnected';")
        out.append("      tunnelProxy = 'WISP unavailable';")
        out.append('      updateStatus();')
        i += 1
        while i < len(lines) and any(k in lines[i] for k in ('useCorsProxy = true', "tunnelStatus = 'connected'", 'tunnelProxy = ', 'updateStatus();', 'PEAKX initialized with CORS proxy fallback')):
            i += 1
        continue
    if 'libcurl initialization error' in ln:
        out.append(ln)
        i += 1
        while i < len(lines) and any(k in lines[i] for k in ('useCorsProxy = true', "tunnelStatus = 'connected'", 'tunnelProxy = ', 'updateStatus();')):
            l = lines[i]
            if 'useCorsProxy' in l or 'initialized with CORS' in l:
                i += 1; continue
            ind = l[:len(l)-len(l.lstrip())]
            if "tunnelStatus = 'connected'" in l:
                out.append(ind + "tunnelStatus = 'disconnected';")
            elif 'tunnelProxy = ' in l:
                out.append(ind + "tunnelProxy = 'WISP error';")
            else:
                out.append(l)
            i += 1
        continue
    out.append(ln)
    i += 1
j = '\n'.join(out)
print('OK  : js - init chain cleaned')

# rewriteUrls bug fix (line-based)
lines = j.split('\n')
out = []
i = 0
fixed = 0
while i < len(lines):
    ln = lines[i]
    if "url.startsWith('')" in ln:
        ind = ln[:len(ln)-len(ln.lstrip())]
        if 'javascript:' in ln:
            while i < len(lines) and 'blob:' not in lines[i]:
                i += 1
            out.append(ind + "if (/^(javascript:|mailto:|tel:|data:|blob:|#)/i.test(url)) {")
            fixed += 1; i += 1
            continue
        else:
            out.append(ind + "if (/^(data:|#)/i.test(url)) {")
            fixed += 1; i += 1
            continue
    out.append(ln)
    i += 1
j = '\n'.join(out)
print('OK  : js - rewriteUrls bug fixes applied:', fixed)

open('PeakxWebsite/script.js', 'w', encoding='utf-8', newline='\n').write(j)
open(path, 'w', encoding='utf-8', newline='\r\n' if crlf else '\n').write(s)
print('DONE | index.html bytes:', len(s), '| script.js bytes:', len(j))
