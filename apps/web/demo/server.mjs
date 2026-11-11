// Disclosed local scaffolding for FAC-101: loopback-only static server for the example scene.
// It is not the production stack; it only serves the page, the fixture and one local sample file.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const ROUTES = {
  '/scene': [here('./scene.html'), 'text/html; charset=utf-8'],
  '/scene/example.json': [here('./fixtures/example-scene.json'), 'application/json'],
};

async function send(req, res, file, type) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return void res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  let [start, end] = [0, info.size - 1];
  if (range) {
    start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end;
    if (start > end) return void res.writeHead(416, { 'content-range': `bytes */${info.size}` }).end();
  }
  res.writeHead(range ? 206 : 200, {
    'content-type': type,
    'content-length': end - start + 1,
    'accept-ranges': 'bytes',
    ...(range && { 'content-range': `bytes ${start}-${end}/${info.size}` }),
  });
  createReadStream(file, { start, end }).pipe(res);
}

export function startDemoServer({ port = 4173, mediaDir = here('./media/') } = {}) {
  const routes = { ...ROUTES, '/media/example.mp4': [join(mediaDir, 'example.mp4'), 'video/mp4'] };
  const server = createServer((req, res) => {
    const route = routes[new URL(req.url, 'http://localhost').pathname];
    if (req.method !== 'GET' || !route) return res.writeHead(404).end('Not found');
    send(req, res, ...route).catch(() => res.writeHead(500).end('Server error'));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startDemoServer();
  console.log(`Example scene: http://localhost:${server.address().port}/scene`);
}
