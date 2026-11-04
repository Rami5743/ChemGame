// Serves the site from disk for the duration of a test run.
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export async function startStatic(root, port) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
    try {
      const body = await readFile(join(root, rel));
      res.writeHead(200, { 'content-type': TYPES[extname(rel)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((res) => server.listen(port, '127.0.0.1', res));
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((res) => server.close(res)),
  };
}
