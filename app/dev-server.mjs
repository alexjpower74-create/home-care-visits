// Static server for app/public while the Worker is not merged (pages with ?mock=1). PORT default 7901 (hc2 dev).
// Mirrors wrangler assets: "/x/" serves x/index.html, "/x" redirects to "/x/". /api/* answers 503.
// ROOT may point at a copy (negative controls). Run: node app/dev-server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(process.env.ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), 'public'));
const PORT = Number(process.env.PORT || 7901);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'The dev server has no API. Open the page with ?mock=1.', code: 'server_error' }));
  }
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!url.pathname.endsWith('/')) { res.writeHead(307, { Location: `${url.pathname}/${url.search}` }); return res.end(); }
    file = path.join(file, 'index.html');
  }
  if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`app/public on http://127.0.0.1:${PORT} (root ${path.relative(process.cwd(), ROOT) || '.'})`));
