// CSV import page. From import-web: node serve.js
// Serves this folder on port 5501. Leave the admin page on port 5500 alone.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5501;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function fileFor(pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^[/\\]+/, '');
  const full = path.resolve(ROOT, ...rel.split(/[/\\]/));
  const relative = path.relative(ROOT, full);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return full;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    res.end('Method not allowed');
    return;
  }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const file = fileFor(decodeURIComponent(url.pathname));
  if (!file) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad path');
    return;
  }
  fs.readFile(file, (err, body) => {
    if (err) {
      const missing = err.code === 'ENOENT' || err.code === 'EISDIR';
      res.writeHead(missing ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(missing ? 'Not found' : 'Server error');
      return;
    }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') res.end();
    else res.end(body);
  });
});

server.listen(PORT, () => {
  console.log(`CSV import page at http://localhost:${PORT}`);
});
