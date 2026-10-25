/*  Tiny zero-dependency static server for the game.
 *  usage:  node serve.js  [port]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2] || 5173);
const root = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.join(root, path.normalize(urlPath).replace(/^([/\\])+/, ''));
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        console.log('404', urlPath);
        res.writeHead(404, { 'content-type': 'text/plain' }).end('404 ' + urlPath);
        return;
      }
      console.log('200', urlPath, data.length);
      res.writeHead(200, {
        'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'content-length': data.length,
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      });
      res.end(data);
    });
  })
  .listen(port, () => {
    console.log(`cozy room → http://localhost:${port}`);
  });
