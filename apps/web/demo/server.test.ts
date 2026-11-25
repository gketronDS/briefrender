import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { type DemoServerOptions, startDemoServer } from './server.ts';
import type { AddressInfo } from 'node:net';

async function withServer(mediaDir: string, fn: (base: string) => Promise<void>, opts: DemoServerOptions = {}) {
  const server = await startDemoServer({ port: 0, mediaDir, fault: null, ...opts });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await fn(base); } finally { server.close(); }
}

test('serves the scene page and its labeled example fixture', async () => {
  await withServer(await mkdtemp(join(tmpdir(), 'scene-')), async (base) => {
    const page = await fetch(`${base}/scene`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Preview example/);
    const fixture = await (await fetch(`${base}/scene/example.json`)).json();
    assert.equal(fixture.provenance, 'fixture');
    assert.equal(fixture.renderedArtifact.generated, false);
  });
});

test('streams the sample video, including byte ranges', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scene-'));
  await writeFile(join(dir, 'example.mp4'), Buffer.from('0123456789'));
  await withServer(dir, async (base) => {
    const full = await fetch(`${base}/media/example.mp4`);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'video/mp4');
    const part = await fetch(`${base}/media/example.mp4`, { headers: { range: 'bytes=2-4' } });
    assert.equal(part.status, 206);
    assert.equal(await part.text(), '234');
  });
});

test('missing sample media is a 404, and only declared files are reachable', async () => {
  await withServer(await mkdtemp(join(tmpdir(), 'scene-')), async (base) => {
    const res = await fetch(`${base}/media/example.mp4`);
    assert.equal(res.status, 404);
    assert.notEqual(res.headers.get('content-type'), 'video/mp4');
    assert.equal((await fetch(`${base}/media/..%2Fserver.ts`)).status, 404);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  });
});

const tmp = () => mkdtemp(join(tmpdir(), 'scene-'));
const reset = (base: string, role: string) => fetch(`${base}/app/reset?role=${role}`, { method: 'POST' });
const observed = async (base: string) => (await fetch(`${base}/scene/observations`)).json();

test('a direct viewer request is denied by the server and recorded for that run', async () => {
  await withServer(await tmp(), async (base) => {
    const { run } = await (await reset(base, 'viewer')).json();
    assert.equal((await fetch(`${base}/app/settings`)).status, 403);
    const packet = await observed(base);
    assert.equal(packet.run.id, run.id);
    assert.equal(packet.observations.length, 1);
    const [obs] = packet.observations;
    assert.equal(obs.runId, run.id);
    assert.equal(obs.environment.actorRole, 'viewer');
    assert.deepEqual(obs.outcome.kind, 'observed');
    assert.equal(obs.outcome.response.status, 403);
  });
});

test('reset to editor clears the prior run, and editor is allowed', async () => {
  await withServer(await tmp(), async (base) => {
    await reset(base, 'viewer');
    await fetch(`${base}/app/settings`);
    const { run } = await (await reset(base, 'editor')).json();
    assert.equal((await observed(base)).observations.length, 0);
    const res = await fetch(`${base}/app/settings`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).allowed, true);
    const [obs] = (await observed(base)).observations;
    assert.equal(obs.runId, run.id);
    assert.equal(obs.outcome.response.status, 200);
  });
});

test('an injected app failure is recorded as failed, never as a result', async () => {
  await withServer(await tmp(), async (base) => {
    await reset(base, 'editor');
    assert.equal((await fetch(`${base}/app/settings`)).status, 500);
    const [obs] = (await observed(base)).observations;
    assert.deepEqual(obs.outcome, { kind: 'failed', reason: 'tool_error' });
  }, { fault: 'settings' });
});

test('observations cannot be posted, and nothing is recorded without a run', async () => {
  await withServer(await tmp(), async (base) => {
    assert.equal((await fetch(`${base}/app/settings`)).status, 409);
    const post = await fetch(`${base}/scene/observations`, { method: 'POST', body: '{"observations":[1]}' });
    assert.equal(post.status, 404);
    assert.equal((await reset(base, 'admin')).status, 400);
    assert.deepEqual(await observed(base), { run: null, observations: [] });
  });
});
