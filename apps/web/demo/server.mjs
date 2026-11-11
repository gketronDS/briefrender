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
  '/app': [here('./app.html'), 'text/html; charset=utf-8'],
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

// Controlled source app (synthetic settings app with seeded fixture roles, not Briefrender accounts).
// The server, not the page, enforces the role and records each attempt. Observations map to the
// FAC-65 R04 ProbeResult shape: a returned response is "observed"; an app error is "failed".
const APP = 'controlled-settings-app@1';
const json = (res, status, body) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

export function startDemoServer({ port = 4173, mediaDir = here('./media/'), fault = process.env.DEMO_FAULT } = {}) {
  const routes = { ...ROUTES, '/media/example.mp4': [join(mediaDir, 'example.mp4'), 'video/mp4'] };
  let run = null;
  let runCount = 0;
  const api = {
    'POST /app/reset': (url, res) => {
      const role = url.searchParams.get('role');
      if (!['viewer', 'editor'].includes(role)) return json(res, 400, { error: 'role must be viewer or editor' });
      run = { id: `run-${++runCount}`, role, observations: [] };
      json(res, 200, { run: { id: run.id, role } });
    },
    'GET /app/settings': (url, res) => {
      if (!run) return json(res, 409, { error: 'No run. Reset with a role first.' });
      const obs = {
        probeId: `${run.id}/obs-${run.observations.length + 1}`, runId: run.id, at: new Date().toISOString(),
        environment: { app: APP, actorRole: run.role }, action: 'open_workspace_settings',
      };
      run.observations.push(obs);
      if (fault === 'settings') {
        obs.outcome = { kind: 'failed', reason: 'tool_error' };
        return json(res, 500, { error: 'Injected settings failure' });
      }
      const body = run.role === 'editor'
        ? { allowed: true, control: 'Workspace name can be edited.' }
        : { allowed: false, reason: 'Viewers cannot open workspace settings.' };
      const status = body.allowed ? 200 : 403;
      obs.outcome = { kind: 'observed', response: { status, body } };
      json(res, status, body);
    },
    'GET /scene/observations': (url, res) =>
      json(res, 200, { run: run && { id: run.id, role: run.role }, observations: run?.observations ?? [] }),
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const handler = api[`${req.method} ${url.pathname}`];
    if (handler) return handler(url, res);
    const route = routes[url.pathname];
    if (req.method !== 'GET' || !route) return res.writeHead(404).end('Not found');
    send(req, res, ...route).catch(() => res.writeHead(500).end('Server error'));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startDemoServer();
  console.log(`Example scene: http://localhost:${server.address().port}/scene`);
}
