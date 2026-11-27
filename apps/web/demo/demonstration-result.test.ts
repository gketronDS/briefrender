import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Observation } from './contracts.ts';
import { prepareDemonstrationDecision } from './decision.ts';
import { validateDemonstrationResult } from './demonstration-result.ts';

const viewer: Observation = {
  probeId: 'run-1/obs-1', runId: 'run-1', at: '2026-11-27T12:00:00Z',
  environment: { app: 'controlled-settings-app@1', actorRole: 'viewer' },
  action: 'open_workspace_settings',
  outcome: { kind: 'observed', response: { status: 403, body: { allowed: false, reason: 'Viewer access' } } },
};
const request = prepareDemonstrationDecision([viewer], 'Explain viewer access.');
assert.ok(request);

const viewerCase = {
  id: 'viewer', purpose: 'Show the access limit', setup: 'Viewer role',
  actionOrChange: 'Open workspace settings', resultToShow: 'Access denied', dataOrigin: 'observed',
  material: { kind: 'available', evidence: [viewer.probeId] },
};
const design = { basis: request.basis, cases: [viewerCase], relations: [], qualifications: [], omissions: [] };
function proposal(candidate: unknown, evidenceRefs = [viewer.probeId]) {
  return { kind: 'proposal', evidenceRefs, payload: { kind: 'demonstration_design', design: candidate } };
}

test('accepts a grounded case and an honest request for missing evidence', () => {
  assert.ok(validateDemonstrationResult(request, proposal(design)).ok);
  const missing = { kind: 'needs_evidence', requirements: ['Observe Editor opening settings'] };
  assert.deepEqual(validateDemonstrationResult(request, missing), { ok: true, result: missing });
});

test('rejects a stale basis, another purpose, and invented evidence at either level', () => {
  const stale = { ...design, basis: { ...design.basis, brief: 'another brief' } };
  const wrongPurpose = { ...proposal(design), payload: { kind: 'narration', design } };
  const invented = { ...viewerCase, material: { kind: 'available', evidence: ['absent'] } };
  const invalidResults = [
    proposal(stale),
    proposal({ ...design, basis: { ...design.basis, evidence: 'another snapshot' } }),
    wrongPurpose,
    proposal(design, ['absent']),
    proposal({ ...design, cases: [invented] }),
    proposal({ ...design, narration: 'Editorial output belongs to another purpose.' }),
  ];
  for (const invalid of invalidResults) {
    assert.equal(validateDemonstrationResult(request, invalid).ok, false);
  }
});

test('failed and unfinished attempts cannot serve as available material', () => {
  for (const outcome of [undefined, { kind: 'failed', reason: 'tool_error' }] as const) {
    const failed = prepareDemonstrationDecision([{ ...viewer, outcome }], request.assignment.goal);
    assert.ok(failed);
    const candidate = proposal({ ...design, basis: failed.basis });
    const result = validateDemonstrationResult(failed, candidate);
    assert.deepEqual(result, { ok: false, reason: 'Material has no observed response: run-1/obs-1' });
  }
});

test('relations connect distinct existing cases with unique IDs', () => {
  const second = { ...viewerCase, id: 'second', material: { kind: 'needs_capture', requirements: ['Editor view'] } };
  const cases = [viewerCase, second];
  const relation = { kind: 'boundary', mainCase: 'viewer', boundaryCase: 'second', limitToExplain: 'Role' };
  for (const [boundaryCase, valid] of [['second', true], ['viewer', false], ['missing', false]] as const) {
    const candidate = proposal({ ...design, cases, relations: [{ ...relation, boundaryCase }] });
    assert.equal(validateDemonstrationResult(request, candidate).ok, valid);
  }
  const duplicate = proposal({ ...design, cases: [viewerCase, viewerCase] });
  assert.equal(validateDemonstrationResult(request, duplicate).ok, false);
});
