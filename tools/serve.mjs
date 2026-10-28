// Static file server for the offline mirror.
// Usage: node tools/serve.mjs [port] [document-root]
// Binds 127.0.0.1 only, serves the repo root by default, no SPA fallback.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] || 8080);
const ROOT = path.resolve(
  process.argv[3] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.bin': 'application/octet-stream',
  '.dat': 'application/octet-stream',
  '.hdr': 'application/octet-stream',
  '.ktx2': 'application/octet-stream',
  '.br': 'application/octet-stream',
  '.bundle': 'application/octet-stream'
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  } catch {
    console.log(`${req.method} ${req.url} -> 400`);
    res.writeHead(400).end('Bad Request');
    return;
  }

  const filePath = path.resolve(ROOT, '.' + path.posix.normalize(urlPath));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    console.log(`${req.method} ${urlPath} -> 403`);
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    let target = filePath;
    if (!err && stat.isDirectory()) target = path.join(filePath, 'index.html');
    fs.stat(target, (err2, st) => {
      if (err2 || !st.isFile()) {
        console.log(`${req.method} ${urlPath} -> 404`);
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
        return;
      }
      const base = path.basename(target).toLowerCase();
      const type = base.endsWith('.wasm.br')
        ? 'application/wasm'
        : base.endsWith('.js.br')
          ? 'text/javascript; charset=utf-8'
          : TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
      console.log(`${req.method} ${urlPath} -> 200 (${st.size})`);
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': st.size,
        'Cache-Control': 'no-store'
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(target).pipe(res);
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}/`);
});
