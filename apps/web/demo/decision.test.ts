import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Observation } from './contracts.ts';
import {
  collectDemonstrationEvidenceNeeds, parseDecisionResultFor, prepareDemonstrationDecision, validateDecisionMeaning,
} from './decision.ts';

const obs = (probeId: string, role: 'viewer' | 'editor', status: 403 | 200 | null): Observation => ({
  probeId, runId: probeId.split('/')[0], at: '2026-11-26T00:00:00Z', action: 'open_workspace_settings',
  environment: { app: 'controlled-settings-app@1', actorRole: role },
  outcome: status === null ? { kind: 'failed', reason: 'tool_error' }
    : { kind: 'observed', response: { status, body: status === 200
      ? { allowed: true, control: 'Workspace name can be edited.' }
      : { allowed: false, reason: 'Viewers cannot open workspace settings.' } } },
});
const GOAL = 'Show a teammate what changes when they have viewer access.';
const prepared = prepareDemonstrationDecision([obs('run-1/obs-1', 'viewer', 403), obs('run-2/obs-1', 'editor', 200)], GOAL);
assert.ok(prepared.ok);
const request = prepared.value;
const theCase = (id: string, ref: string) => ({
  id, purpose: 'p', setup: 's', actionOrChange: 'Open workspace settings', resultToShow: 'r',
  dataOrigin: 'observed', material: { kind: 'available', evidence: [ref] },
});
const proposal = (overrides: Record<string, unknown> = {}) => ({
  kind: 'proposal', evidenceRefs: ['run-1/obs-1', 'run-2/obs-1'],
  payload: { kind: 'demonstration_design', design: {
    basis: request.basis, cases: [theCase('viewer', 'run-1/obs-1'), theCase('editor', 'run-2/obs-1')],
    relations: [{ kind: 'compare', cases: ['viewer', 'editor'], sharedConditions: [], relevantDifference: 'role',
      relationshipToExplain: 'x' }],
    qualifications: [], omissions: [], ...overrides } },
});
const check = (input: unknown) => {
  const parsed = parseDecisionResultFor(request, input);
  return parsed.ok ? validateDecisionMeaning(request, parsed.value) : parsed;
};

test('prepare binds the request to the exact observations and inlines them', () => {
  assert.equal(request.kind, 'demonstration_design');
  assert.equal(request.expectedResult, 'demonstration_design');
  assert.equal(request.assignment.goal, GOAL);
  assert.deepEqual(request.assignment.observations.map((o) => o.probeId), ['run-1/obs-1', 'run-2/obs-1']);
  const other = prepareDemonstrationDecision([obs('run-1/obs-1', 'viewer', 403)], GOAL);
  assert.ok(other.ok && other.value.basis.evidence !== request.basis.evidence);
  assert.deepEqual(prepareDemonstrationDecision([], GOAL), { ok: false, findings: ['no_observations'] });
});

test('a design grounded in the observed evidence is accepted', () => {
  const result = check(proposal());
  assert.ok(result.ok, JSON.stringify(result));
});

test('fabricated or absent evidence references are rejected', () => {
  const fake = proposal({ cases: [theCase('viewer', 'run-9/obs-1')], relations: [] });
  assert.deepEqual(check(fake), { ok: false, findings: ['unknown_evidence:run-9/obs-1'] });
  assert.deepEqual(check({ ...proposal(), evidenceRefs: ['run-1/obs-7'] }),
    { ok: false, findings: ['unknown_evidence:run-1/obs-7'] });
});

test('a failed attempt cannot be shown as available material', () => {
  const failedReq = prepareDemonstrationDecision([obs('run-3/obs-1', 'editor', null)], GOAL);
  assert.ok(failedReq.ok);
  const input = { kind: 'proposal', evidenceRefs: [], payload: { kind: 'demonstration_design', design: {
    basis: failedReq.value.basis, cases: [theCase('editor', 'run-3/obs-1')], relations: [], qualifications: [],
    omissions: [] } } };
  const parsed = parseDecisionResultFor(failedReq.value, input);
  assert.ok(parsed.ok);
  assert.deepEqual(validateDecisionMeaning(failedReq.value, parsed.value),
    { ok: false, findings: ['not_observed:run-3/obs-1'] });
});

test('wrong basis, wrong purpose and malformed results are rejected', () => {
  const stale = proposal({ basis: { ...request.basis, evidence: 'sha256:other' } });
  assert.deepEqual(check(stale), { ok: false, findings: ['basis_mismatch'] });
  assert.equal(check({ kind: 'proposal', evidenceRefs: [], payload: { kind: 'story_proposal' } }).ok, false);
  assert.equal(check({ kind: 'proposal', payload: 'anything' }).ok, false);
  assert.equal(check({ ...proposal(), extra: true }).ok, false);
});

test('relations must name distinct existing cases, and case IDs must be unique', () => {
  const dangling = proposal({ relations: [{ kind: 'boundary', mainCase: 'viewer', boundaryCase: 'nope', limitToExplain: 'x' }] });
  assert.deepEqual(check(dangling), { ok: false, findings: ['unknown_case:nope'] });
  const dup = proposal({ cases: [theCase('a', 'run-1/obs-1'), theCase('a', 'run-2/obs-1')], relations: [] });
  assert.deepEqual(check(dup), { ok: false, findings: ['duplicate_case:a'] });
});

test('needs_evidence is a valid answer, and capture needs are collected from the design', () => {
  assert.ok(check({ kind: 'needs_evidence', requirements: ['Editor attempt on the same action'] }).ok);
  const capture = { ...theCase('editor', ''), material: { kind: 'needs_capture', requirements: ['Editor view'] } };
  const result = check(proposal({ cases: [theCase('viewer', 'run-1/obs-1'), capture] }));
  assert.ok(result.ok && result.value.kind === 'proposal');
  assert.deepEqual(collectDemonstrationEvidenceNeeds(result.value.payload.design), ['Editor view']);
});
