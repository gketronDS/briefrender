// Local FAC-65 C01 request for the demonstration decision in this scene.
import { createHash } from 'node:crypto';
import type { Observation } from './contracts.ts';

export interface DemonstrationDecisionRequest {
  id: string;
  kind: 'demonstration_design';
  expectedResult: 'demonstration_design';
  basis: { brief: string; evidence: string };
  objective: string;
  assignment: {
    goal: string;
    observations: Observation[];
    limits: string[];
  };
}

function digest(value: unknown): string {
  const serialized = JSON.stringify(value);
  const hash = createHash('sha256').update(serialized).digest('hex');
  return `sha256:${hash}`;
}

export function prepareDemonstrationDecision(
  selectedAttempts: Observation[],
  goal: string,
): DemonstrationDecisionRequest | null {
  if (selectedAttempts.length === 0) return null;

  // Hash and send the same snapshot, including failed outcomes. A later change to
  // the selection must never change the evidence under a prepared request.
  const observations = structuredClone(selectedAttempts);
  const basis = { brief: digest(goal), evidence: digest(observations) };
  const kind = 'demonstration_design';
  const objective = 'Choose what observed behavior to demonstrate so the viewer understands the goal.';
  const limits = [
    'Cite only the probeIds listed in observations.',
    'Conclusions apply only to the observed app, roles and action.',
    'If the observations cannot support a useful demonstration, answer needs_evidence.',
  ];
  const assignment = { goal, observations, limits };
  const id = digest({ kind, basis, objective, limits });
  return { id, kind, expectedResult: kind, basis, objective, assignment };
}
