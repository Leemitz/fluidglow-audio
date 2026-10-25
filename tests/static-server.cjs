// Test-only static host with MP3 byte ranges and a Pages-style project prefix.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
exports.serveProject = async (root, prefix = '') => {
  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400); return res.end(); }
    if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (prefix && !pathname.startsWith(prefix + '/')) { res.writeHead(404); return res.end(); }
    pathname = pathname.slice(prefix.length);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); return res.end();
    }
    const size = fs.statSync(file).size;
    res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
      '.css':'text/css; charset=utf-8', '.mp3':'audio/mpeg'})[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    let start = 0, end = size - 1;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) { res.writeHead(416); return res.end(); }
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
      if (start >= size || end < start) {
        res.setHeader('Content-Range', `bytes */${size}`); res.writeHead(416); return res.end();
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.setHeader('Content-Length', end - start + 1);
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file, {start, end});
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
};
