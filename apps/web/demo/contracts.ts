// Local leaf types for the demo slice. They follow the FAC-65 contract reference (R04 ProbeResult /
// ProbeOutcome) for the narrow cases this controlled app produces; they are not the canonical owners.

export type FixtureRole = 'viewer' | 'editor';

export type SettingsResponse =
  | { allowed: true; control: string }
  | { allowed: false; reason: string };

// R04 ProbeOutcome subset: a response the app returned is "observed"; an app error is "failed".
export type ProbeOutcome =
  | { kind: 'observed'; response: { status: number; body: SettingsResponse } }
  | { kind: 'failed'; reason: 'tool_error' };

export interface Observation {
  probeId: string;
  runId: string;
  at: string;
  environment: { app: string; actorRole: FixtureRole };
  action: 'open_workspace_settings';
  outcome?: ProbeOutcome;
}

export interface ObservationPacket {
  run: { id: string; role: FixtureRole } | null;
  observations: Observation[];
}
