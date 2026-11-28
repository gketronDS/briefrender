import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

test('submits only the frozen batch and never retries an uncertain provider response', async () => {
  const run = promisify(execFile);
  const script = fileURLToPath(new URL('./submit-batch.ts', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'fac-103-submit-'));
  const posts: unknown[] = [];
  let status = 200;
  const server = createServer(async (request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/messages/batches');
    let body = '';
    for await (const chunk of request) body += chunk;
    posts.push(JSON.parse(body));
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 'msgbatch_fixture', created_at: '2026-11-28T00:00:00Z' }));
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const batch = { requests: [{ custom_id: 'fixture-1', params: {} }] };
    const preview = JSON.stringify({ batch });
    await mkdir(join(directory, 'frozen'));
    await writeFile(join(directory, 'frozen/preview.json'), preview);
    const env = {
      ANTHROPIC_API_KEY: 'offline-placeholder',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      PREVIEW_RUN: '123',
      APPROVED_SHA256: 'wrong',
      GITHUB_STEP_SUMMARY: join(directory, 'summary'),
    };
    const submit = () => run(process.execPath, [script], { cwd: directory, env });
    await assert.rejects(submit, /differs from the approved preview/);
    assert.deepEqual(posts, []);

    env.APPROVED_SHA256 = createHash('sha256').update(preview).digest('hex');
    await submit();
    const receipt = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'));
    assert.equal(receipt.batchId, 'msgbatch_fixture');
    assert.equal(receipt.previewSha256, env.APPROVED_SHA256);
    assert.deepEqual(posts, [batch]);

    status = 503;
    await assert.rejects(submit, /not confirmed/);
    assert.deepEqual(posts, [batch, batch]);
  } finally {
    await server[Symbol.asyncDispose]();
    await rm(directory, { recursive: true, force: true });
  }
});
