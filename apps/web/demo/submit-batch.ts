import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import type { prepareBatchPreview } from './batch-preview.ts';

const bytes = await readFile('frozen/preview.json');
const digest = createHash('sha256').update(bytes).digest('hex');
if (digest !== process.env.APPROVED_SHA256) throw new Error('Frozen file differs from the approved preview.');
const preview: Awaited<ReturnType<typeof prepareBatchPreview>> = JSON.parse(bytes.toString('utf8'));

// The workflow has reserved this digest. A timeout can follow a successful
// creation at Anthropic, so neither the SDK nor the workflow may blindly retry.
const client = new Anthropic({ maxRetries: 0 });
let batch;
try {
  batch = await client.messages.batches.create(preview.batch);
} catch (error) {
  const status = error instanceof Anthropic.APIError ? error.status : undefined;
  throw new Error(`Batch creation was not confirmed (HTTP ${status ?? 'unknown'}). Check Anthropic's batch history before retrying.`);
}
console.log(`Submitted Anthropic batch ${batch.id}`);
const previewRun = process.env.PREVIEW_RUN;
const receipt = { previewRun, previewSha256: digest, batchId: batch.id, submittedAt: batch.created_at };
await writeFile('receipt.json', JSON.stringify(receipt, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `For **collect**, use preview run **${previewRun}** and batch ID **${batch.id}**.\n`);
}
