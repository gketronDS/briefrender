import Anthropic from '@anthropic-ai/sdk';
import type { MessageBatchIndividualResponse } from '@anthropic-ai/sdk/resources/messages/batches';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { prepareBatchPreview } from './batch-preview.ts';
import type { DemonstrationDecisionRequest } from './decision.ts';
import { validateDemonstrationResult } from './demonstration-result.ts';

type Preview = Awaited<ReturnType<typeof prepareBatchPreview>>;

function csvCell(value: string | number) {
  let text = String(value);
  // Spreadsheet apps can execute formulas even inside quoted CSV cells.
  if (/^\s*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

function assess(request: DemonstrationDecisionRequest, reply: MessageBatchIndividualResponse['result']) {
  if (reply.type === 'errored') return ['provider error', reply.error.error.message];
  if (reply.type !== 'succeeded') return [reply.type, ''];
  const message = reply.message;
  const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('');
  if (message.stop_reason !== 'end_turn') return [`Stopped: ${message.stop_reason}`, text];
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    return ['Invalid JSON', text];
  }
  const checked = validateDemonstrationResult(request, envelope?.result);
  if (!checked.ok) return [checked.reason, text];
  const result = checked.result;
  switch (result.kind) {
    case 'proposal': {
      const cases = result.payload.design.cases.map(item => `${item.actionOrChange} → ${item.resultToShow}`);
      return ['valid proposal', cases.join('\n')];
    }
    case 'needs_evidence': return [result.kind, result.requirements.join('\n')];
    case 'needs_input': return [result.kind, result.question];
    case 'unsupported': return [result.kind, result.gaps.join('\n')];
  }
}

export function makeScorecard(preview: Preview, replies: MessageBatchIndividualResponse[]) {
  // Batch output can arrive out of order. Reject an incomplete or unrelated download
  // before publishing any rows; reviewers must see all trials for the chosen preview.
  const results = new Map(replies.map(reply => [reply.custom_id, reply.result]));
  if (results.size !== replies.length || results.size !== preview.trials.length) {
    throw new Error('Batch result count or unique trial count differs from the frozen preview.');
  }
  const requests = new Map(preview.batch.requests.map(item => [item.custom_id, item.params]));
  const rows: (string | number)[][] = [[
    'Trial ID', 'Case', 'Goal', 'Evidence', 'Validation / status', 'Demonstration or issue',
    'Reported model', 'Input tokens', 'Output tokens', 'Estimated USD', 'Would you use it? Why?',
  ]];
  for (const trial of preview.trials) {
    const params = requests.get(trial.customId);
    const result = results.get(trial.customId);
    const content = params?.messages[0]?.content;
    if (!result || typeof content !== 'string') throw new Error('Trial ID or stored input mismatch.');
    const request: DemonstrationDecisionRequest = JSON.parse(content);
    const evidence = request.assignment.observations.map(item =>
      `${item.probeId} ${item.environment.actorRole} ${item.action}: ${JSON.stringify(item.outcome)}`);
    const [status, explanation] = assess(request, result);
    const message = result.type === 'succeeded' ? result.message : undefined;
    let cost = '';
    if (message) {
      const { input_tokens, output_tokens } = message.usage;
      const rates = preview.estimate;
      cost = ((input_tokens * rates.inputUsdPerMillion + output_tokens * rates.outputUsdPerMillion) / 1_000_000).toFixed(6);
    }
    rows.push([trial.customId, trial.caseName, request.assignment.goal, evidence.join('\n'), status,
      explanation, message?.model ?? '', message?.usage.input_tokens ?? '', message?.usage.output_tokens ?? '', cost, '']);
  }
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

async function collect() {
  const id = process.env.BATCH_ID ?? '';
  if (!/^msgbatch_[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Enter the provider Message Batch ID.');
  const preview: Preview = JSON.parse(await readFile('frozen/preview.json', 'utf8'));
  const batches = new Anthropic().messages.batches;
  const batch = await batches.retrieve(id);
  if (batch.processing_status !== 'ended') throw new Error('Batch still processing. Collect again after it ends.');
  const replies: MessageBatchIndividualResponse[] = [];
  const remaining = new Set(preview.trials.map(trial => trial.customId));
  for await (const reply of await batches.results(id)) {
    if (!remaining.delete(reply.custom_id)) throw new Error('Unexpected or repeated trial in batch.');
    replies.push(reply);
  }
  const csv = makeScorecard(preview, replies);
  await mkdir('scorecard', { recursive: true });
  await writeFile('scorecard/scorecard.csv', csv);
  await writeFile('scorecard/results.json', JSON.stringify({ batchId: id, replies }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await collect();
