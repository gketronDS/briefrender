import { z } from 'zod';
import type { DemonstrationDecisionRequest } from './decision.ts';

const text = z.string().max(600).regex(/\S/);
const id = z.string().min(1).max(128);
const requirements = z.array(text).min(1).max(5);
const material = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('available'), evidence: z.array(id).min(1).max(10) }),
  z.strictObject({ kind: z.literal('needs_capture'), requirements }),
]);

const demonstrationCase = z.strictObject({
  id, purpose: text, setup: text, actionOrChange: text, resultToShow: text,
  dataOrigin: z.enum(['observed', 'staged', 'mixed', 'unknown']),
  material,
});

const relation = z.discriminatedUnion('kind', [
  z.strictObject({
    // The batch schema converter supports homogeneous arrays; local validation enforces the pair.
    kind: z.literal('compare'), cases: z.array(id).length(2),
    sharedConditions: z.array(text).max(5), relevantDifference: text, relationshipToExplain: text,
  }),
  z.strictObject({ kind: z.literal('boundary'), mainCase: id, boundaryCase: id, limitToExplain: text }),
  z.strictObject({ kind: z.literal('recovery'), failureCase: id, recoveryCase: id, recognitionCue: text }),
]);

const design = z.strictObject({
  basis: z.strictObject({ brief: id, evidence: id }),
  cases: z.array(demonstrationCase).min(1).max(4),
  relations: z.array(relation).max(4),
  qualifications: z.array(text).max(5),
  omissions: z.array(z.strictObject({ topic: text, reason: text })).max(5),
});

const proposal = z.strictObject({
  kind: z.literal('proposal'),
  evidenceRefs: z.array(id).max(20),
  payload: z.strictObject({ kind: z.literal('demonstration_design'), design }),
});

export const demonstrationResultSchema = z.discriminatedUnion('kind', [
  proposal,
  z.strictObject({ kind: z.literal('needs_evidence'), requirements }),
  z.strictObject({ kind: z.literal('needs_input'), question: text }),
  z.strictObject({ kind: z.literal('unsupported'), gaps: requirements }),
]);

type Validation =
  | { ok: true; result: z.infer<typeof demonstrationResultSchema> }
  | { ok: false; reason: string };

function relatedCaseIds(link: z.infer<typeof relation>): string[] {
  switch (link.kind) {
    case 'compare': return link.cases;
    case 'boundary': return [link.mainCase, link.boundaryCase];
    case 'recovery': return [link.failureCase, link.recoveryCase];
  }
}

function checkProposal(request: DemonstrationDecisionRequest, candidate: z.infer<typeof proposal>): string | null {
  const design = candidate.payload.design;
  if (design.basis.brief !== request.basis.brief || design.basis.evidence !== request.basis.evidence) {
    return 'Proposal belongs to a different brief or evidence snapshot.';
  }

  // The stored request is the only source of evidence, even if the creator has
  // since selected more attempts. Failures may explain a gap in the proposal.
  const attempts = request.assignment.observations;
  const byProbeId = new Map(attempts.map((attempt) => [attempt.probeId, attempt]));
  for (const ref of candidate.evidenceRefs) {
    if (!byProbeId.has(ref)) return `Unknown evidence: ${ref}`;
  }

  const caseIds = new Set<string>();
  for (const entry of design.cases) {
    if (caseIds.has(entry.id)) return `Duplicate demonstration case: ${entry.id}`;
    caseIds.add(entry.id);
    if (entry.material.kind === 'needs_capture') continue;
    for (const ref of entry.material.evidence) {
      const attempt = byProbeId.get(ref);
      if (!attempt) return `Unknown evidence: ${ref}`;
      if (attempt.outcome?.kind !== 'observed') return `Material has no observed response: ${ref}`;
    }
  }

  for (const link of design.relations) {
    const [first, second] = relatedCaseIds(link);
    if (first === second) return 'A relation must connect two distinct cases.';
    if (!caseIds.has(first) || !caseIds.has(second)) return 'A relation references an unknown case.';
  }
  return null;
}

// One C01 purpose is registered in this slice. The caller supplies the trusted
// stored request; the submitted payload cannot select a different parser.
export function validateDemonstrationResult(request: DemonstrationDecisionRequest, input: unknown): Validation {
  if (request.expectedResult !== 'demonstration_design') {
    return { ok: false, reason: 'Request expects another result type.' };
  }
  const parsed = demonstrationResultSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: parsed.error.message };
  if (parsed.data.kind === 'proposal') {
    const reason = checkProposal(request, parsed.data);
    if (reason) return { ok: false, reason };
  }
  return { ok: true, result: parsed.data };
}
