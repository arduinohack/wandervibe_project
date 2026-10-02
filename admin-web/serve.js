// Local admin page. From admin-web: node serve.js
// Serves this folder on port 5500. r or R reloads open admin tabs. q quits.
// Does not watch the filesystem. npx --yes serve -l 5500 remains a fallback.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5500;
const ROOT = __dirname;
const clients = new Set();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const RELOAD_LISTENER = '<script>(function(){var source=new EventSource("/__reload");source.onmessage=function(){location.reload();};})();</script>';

function fileFor(pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^[/\\]+/, '');
  const full = path.resolve(ROOT, ...rel.split(/[/\\]/));
  const relative = path.relative(ROOT, full);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return full;
}

function withReload(html) {
  const close = html.match(/<\/body>/i);
  if (!close) return html + RELOAD_LISTENER;
  return html.slice(0, close.index) + RELOAD_LISTENER + html.slice(close.index);
}

function reloadClients() {
  const payload = 'data: reload\n\n';
  let sent = 0;
  for (const res of clients) {
    try {
      res.write(payload);
      sent += 1;
    } catch (err) {
      clients.delete(res);
    }
  }
  console.log(`reload ${sent}`);
}

function sendFile(req, res, file, inject) {
  fs.readFile(file, (err, body) => {
    if (err) {
      const status = err.code === 'ENOENT' || err.code === 'EISDIR' ? 404 : 500;
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(status === 404 ? 'Not found' : 'Server error');
      return;
    }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    let payload = body;
    if (inject) payload = Buffer.from(withReload(body.toString('utf8')), 'utf8');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Length': payload.length });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(payload);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    res.end('Method not allowed');
    return;
  }

  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  if (pathname === '/__reload') {
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  const file = fileFor(pathname);
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const inject = pathname === '/' || pathname.toLowerCase() === '/index.html';
  sendFile(req, res, file, inject);
});

function shutdown() {
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(false); } catch (err) { /* already closed */ }
  }
  for (const res of clients) {
    try { res.end(); } catch (err) { /* already closed */ }
  }
  server.close();
  process.exit(0);
}

server.on('error', (err) => {
  console.error(err && err.code ? err.code : 'error');
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`admin-web http://localhost:${PORT}`);
  console.log('r reloads open tabs. q quits.');
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (key) => {
    if (key === 'r' || key === 'R') reloadClients();
    else if (key === 'q' || key === '\u0003') shutdown();
  });
});
