import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startDemoServer } from './server.mjs';

async function withServer(mediaDir, fn) {
  const server = await startDemoServer({ port: 0, mediaDir });
  const base = `http://127.0.0.1:${server.address().port}`;
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
    assert.equal((await fetch(`${base}/media/..%2Fserver.mjs`)).status, 404);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  });
});
