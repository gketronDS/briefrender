import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { BatchCreateParams } from '@anthropic-ai/sdk/resources/messages/batches';
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { z } from 'zod';
import { collectBatchCases } from './batch-cases.ts';
import { demonstrationResultSchema } from './demonstration-result.ts';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export async function prepareBatchPreview() {
  const cases = await collectBatchCases();
  const prompt = await readFile(new URL('./demonstration-prompt.txt', import.meta.url), 'utf8');
  // Use the same conversion as ChatAnthropic.withStructuredOutput(method: jsonSchema).
  // A batch needs the wire format itself. Its result field goes to the stored-request validator.
  const envelope = z.strictObject({ result: demonstrationResultSchema });
  const schema = transformJSONSchema(toJsonSchema(envelope));
  const requests: BatchCreateParams.Request[] = [];
  const trials = [];
  const maxTokensPerTrial = 16000;
  const inputBytesPerToken = 4;
  let estimatedInputTokens = 0;

  for (const [caseName, request] of Object.entries(cases)) {
    const params: BatchCreateParams.Request['params'] = {
      model: 'claude-opus-5-5',
      max_tokens: maxTokensPerTrial,
      system: prompt,
      messages: [{ role: 'user', content: JSON.stringify(request) }],
      output_config: { effort: 'high', format: { type: 'json_schema', schema } },
    };
    const json = JSON.stringify(params);
    const paramsHash = sha256(json);
    for (let trial = 1; trial <= 5; trial++) {
      const customId = `${caseName}-${trial}-${paramsHash.slice(0, 20)}`;
      requests.push({ custom_id: customId, params });
      trials.push({ customId, caseName, trial, requestId: request.id, paramsHash });
      estimatedInputTokens += Math.ceil(Buffer.byteLength(json) / inputBytesPerToken);
    }
  }

  // Planning assumptions only. Include schema overhead and allow 2,000 output tokens
  // per trial; the 16,000-token limit also covers thinking. Reprice before approval.
  const estimate = {
    pricingSource: 'https://platform.claude.com/docs/en/about-claude/pricing',
    inputUsdPerMillion: 2, outputUsdPerMillion: 10,
    inputBytesPerToken, estimatedInputTokens, assumedOutputTokensPerTrial: 2000,
  };
  const inputUsd = estimatedInputTokens * estimate.inputUsdPerMillion / 1_000_000;
  const outputUsdPerToken = estimate.outputUsdPerMillion / 1_000_000;
  const outputUsd = requests.length * estimate.assumedOutputTokensPerTrial * outputUsdPerToken;
  const maxOutputUsd = requests.length * maxTokensPerTrial * outputUsdPerToken;
  return {
    promptSha256: sha256(prompt),
    estimate: { ...estimate, totalUsd: inputUsd + outputUsd, maxOutputUsd },
    trials,
    batch: { requests },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const preview = await prepareBatchPreview();
  console.log(JSON.stringify(preview, null, 2));
}
