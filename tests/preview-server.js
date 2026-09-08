'use strict';
// Local-only review harness. No preview code is included in the extension manifest.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file;
  try { file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/tests/workbench-preview.html' : url.pathname)); }
  catch (_) { res.writeHead(400); res.end(); return; }
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, buffer) => {
    if (error) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(file);
    let body = buffer;
    if (ext === '.html' && url.searchParams.has('preview')) {
      body = buffer.toString('utf8').replace('<head>', '<head><script src="/tests/preview-runtime.js"></script>');
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  });
}).listen(4173, '127.0.0.1', () => console.log('Local review: http://127.0.0.1:4173'));
