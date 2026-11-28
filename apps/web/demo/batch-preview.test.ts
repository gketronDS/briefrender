import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { ChatAnthropic } from '@langchain/anthropic';
import { prepareBatchPreview } from './batch-preview.ts';
import type { DemonstrationDecisionRequest } from './decision.ts';
import { demonstrationResultSchema } from './demonstration-result.ts';

test('builds five traceable trials for each saved evidence case', async () => {
  const preview = await prepareBatchPreview();
  const requests = preview.batch.requests;
  assert.equal(requests.length, 15);
  const byId = new Map(requests.map((item) => [item.custom_id, item.params]));
  assert.equal(byId.size, 15);
  const counts = new Map<string, number>();
  const expected: Record<string, (number | string)[]> = {
    bothRoles: [403, 200], viewerOnly: [403], failed: ['failed'],
  };
  for (const trial of preview.trials) {
    const params = byId.get(trial.customId);
    assert.ok(params);
    const hash = createHash('sha256').update(JSON.stringify(params)).digest('hex');
    assert.equal(hash, trial.paramsHash);
    assert.equal(params.model, 'claude-opus-5-5');
    assert.equal(params.output_config?.effort, 'high');
    assert.equal(params.max_tokens, 16000);
    assert.equal(params.output_config?.format?.schema.type, 'object');
    const content = params.messages[0].content;
    assert.ok(typeof content === 'string');
    const request: DemonstrationDecisionRequest = JSON.parse(content);
    assert.equal(request.id, trial.requestId);
    const outcomes = request.assignment.observations.map(({ outcome }) => {
      if (outcome?.kind === 'observed') return outcome.response.status;
      return outcome?.kind;
    });
    assert.deepEqual(outcomes, expected[trial.caseName]);
    counts.set(trial.caseName, (counts.get(trial.caseName) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(counts), { bothRoles: 5, viewerOnly: 5, failed: 5 });
});

test('pinned LangChain can construct the structured result parser offline', () => {
  const model = new ChatAnthropic({ model: 'claude-opus-5-5', apiKey: 'offline-placeholder' });
  model.withStructuredOutput(demonstrationResultSchema, { method: 'jsonSchema' });
});
