import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareBatchPreview } from './batch-preview.ts';
import { makeScorecard } from './scorecard.ts';

test('keeps provider failures in frozen trial order and rejects incomplete or mismatched batches', async () => {
  const preview = await prepareBatchPreview();
  const replies = preview.trials.map(trial => ({
    custom_id: trial.customId, result: { type: 'expired' as const },
  }));
  const csv = makeScorecard(preview, replies.toReversed());
  const firstRow = csv.indexOf(preview.trials[0].customId);
  assert.ok(firstRow >= 0);
  assert.ok(csv.indexOf(preview.trials[1].customId) > firstRow);
  assert.equal(csv.match(/"expired"/g)?.length, 15);
  assert.throws(() => makeScorecard(preview, replies.slice(1)), /count/);
  const duplicate = [...replies.slice(1), replies[1]];
  assert.throws(() => makeScorecard(preview, duplicate), /unique/);
  const unrelated = [...replies.slice(1), { ...replies[0], custom_id: 'different-preview' }];
  assert.throws(() => makeScorecard(preview, unrelated), /mismatch/);
});
