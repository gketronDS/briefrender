// FAC-103: local narrowing of FAC-65 C01 (DecisionRequest/Result, parse/validate) and R04 (DemonstrationDesign) to the
// demonstration_design decision only. Code owns parsing and basis/reference checks; the runtime owns relevance and wording.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Observation } from './contracts.ts';

export type Result<T> = { ok: true; value: T } | { ok: false; findings: string[] };

export interface InvestigationBasis { brief: string; evidence: string }

export interface DemonstrationDecisionRequest {
  id: string;
  kind: 'demonstration_design';
  expectedResult: 'demonstration_design';
  basis: InvestigationBasis;
  objective: string;
  assignment: { goal: string; observations: Observation[]; limits: string[] };
}

const text = z.string().min(1).max(600);
const caseSchema = z.strictObject({
  id: z.string().min(1).max(40), purpose: text, setup: text, actionOrChange: text, resultToShow: text,
  dataOrigin: z.enum(['observed', 'staged', 'mixed', 'unknown']),
  material: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('available'), evidence: z.array(z.string()).min(1).max(10) }),
    z.strictObject({ kind: z.literal('needs_capture'), requirements: z.array(text).min(1).max(5) }),
  ]),
});
const relationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('compare'), cases: z.tuple([z.string(), z.string()]),
    sharedConditions: z.array(text).max(5), relevantDifference: text, relationshipToExplain: text }),
  z.strictObject({ kind: z.literal('boundary'), mainCase: z.string(), boundaryCase: z.string(), limitToExplain: text }),
  z.strictObject({ kind: z.literal('recovery'), failureCase: z.string(), recoveryCase: z.string(), recognitionCue: text }),
]);
export const demonstrationDesignSchema = z.strictObject({
  basis: z.strictObject({ brief: z.string(), evidence: z.string() }),
  cases: z.array(caseSchema).min(1).max(4),
  relations: z.array(relationSchema).max(4),
  qualifications: z.array(text).max(5),
  omissions: z.array(z.strictObject({ topic: text, reason: text })).max(5),
});
export type DemonstrationDesign = z.infer<typeof demonstrationDesignSchema>;

// Result schema per expected result kind: the stored request picks it, never the payload.
export const decisionResultSchemas = {
  demonstration_design: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('proposal'), evidenceRefs: z.array(z.string()).max(20),
      payload: z.strictObject({ kind: z.literal('demonstration_design'), design: demonstrationDesignSchema }) }),
    z.strictObject({ kind: z.literal('needs_evidence'), requirements: z.array(text).min(1).max(5) }),
    z.strictObject({ kind: z.literal('needs_input'), question: text }),
    z.strictObject({ kind: z.literal('unsupported'), gaps: z.array(text).min(1).max(5) }),
  ]),
};
export type DemonstrationDecisionResult = z.infer<typeof decisionResultSchemas.demonstration_design>;

const digest = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

export function prepareDemonstrationDecision(observations: Observation[], goal: string): Result<DemonstrationDecisionRequest> {
  if (observations.length === 0) return { ok: false, findings: ['no_observations'] };
  const basis = { brief: digest(goal), evidence: digest(observations) };
  return { ok: true, value: {
    id: `dd-${basis.evidence.slice(7, 19)}`, kind: 'demonstration_design', expectedResult: 'demonstration_design', basis,
    objective: 'Choose what observed behavior to demonstrate so the viewer understands the goal.',
    assignment: { goal, observations, limits: [
      'Cite only the probeIds listed in observations.',
      'Conclusions apply only to the observed app, roles and action.',
      'If the observations cannot support a useful demonstration, answer needs_evidence.',
    ] },
  } };
}

export function parseDecisionResultFor(request: DemonstrationDecisionRequest, input: unknown): Result<DemonstrationDecisionResult> {
  const parsed = decisionResultSchemas[request.expectedResult].safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data }
    : { ok: false, findings: parsed.error.issues.map((i) => `schema:${i.path.join('.')}:${i.message}`) };
}

export function validateDecisionMeaning(
  request: DemonstrationDecisionRequest, result: DemonstrationDecisionResult,
): Result<DemonstrationDecisionResult> {
  if (result.kind !== 'proposal') return { ok: true, value: result };
  const { design } = result.payload;
  if (design.basis.brief !== request.basis.brief || design.basis.evidence !== request.basis.evidence) {
    return { ok: false, findings: ['basis_mismatch'] };
  }
  const byId = new Map(request.assignment.observations.map((o) => [o.probeId, o]));
  const findings: string[] = [];
  const cited = [...result.evidenceRefs, ...design.cases.flatMap((c) => (c.material.kind === 'available' ? c.material.evidence : []))];
  for (const ref of new Set(cited)) if (!byId.has(ref)) findings.push(`unknown_evidence:${ref}`);
  for (const c of design.cases) {
    if (c.material.kind !== 'available') continue;
    for (const ref of c.material.evidence) if (byId.get(ref)?.outcome?.kind === 'failed') findings.push(`not_observed:${ref}`);
  }
  const ids = new Set<string>();
  for (const c of design.cases) (ids.has(c.id) ? findings.push(`duplicate_case:${c.id}`) : ids.add(c.id));
  for (const r of design.relations) {
    const ends = r.kind === 'compare' ? r.cases : r.kind === 'boundary' ? [r.mainCase, r.boundaryCase] : [r.failureCase, r.recoveryCase];
    for (const end of ends) if (!ids.has(end)) findings.push(`unknown_case:${end}`);
    if (ends[0] === ends[1]) findings.push(`same_case_relation:${ends[0]}`);
  }
  return findings.length ? { ok: false, findings } : { ok: true, value: result };
}

export function collectDemonstrationEvidenceNeeds(design: DemonstrationDesign): string[] {
  return design.cases.flatMap((c) => (c.material.kind === 'needs_capture' ? c.material.requirements : []));
}
