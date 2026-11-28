import type { AddressInfo } from 'node:net';
import type { FixtureRole, ObservationPacket } from './contracts.ts';
import type { DemonstrationDecisionRequest } from './decision.ts';
import { startDemoServer } from './server.ts';

async function demoResponse(base: string, path: string, method = 'GET', expectedStatus = 200) {
  const response = await fetch(base + path, { method });
  if (response.status !== expectedStatus) {
    throw new Error(`${method} ${path}: expected ${expectedStatus}, received ${response.status}`);
  }
  return response.json();
}

async function keepAttempt(base: string, role: FixtureRole, expectedStatus: number) {
  await demoResponse(base, `/app/reset?role=${role}`, 'POST');
  await demoResponse(base, '/app/settings', 'GET', expectedStatus);
  const packet: ObservationPacket = await demoResponse(base, '/scene/observations');
  const [attempt] = packet.observations;
  const identity = new URLSearchParams({ probeId: attempt.probeId, at: attempt.at });
  await demoResponse(base, `/scene/selected-observations?${identity}`, 'POST');
}

function prepare(base: string): Promise<DemonstrationDecisionRequest> {
  return demoResponse(base, '/scene/demonstration-request', 'POST');
}

export async function collectBatchCases() {
  const server = await startDemoServer({ port: 0, fault: null });
  let viewerOnly: DemonstrationDecisionRequest;
  let bothRoles: DemonstrationDecisionRequest;
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await keepAttempt(base, 'viewer', 403);
    viewerOnly = await prepare(base);
    await keepAttempt(base, 'editor', 200);
    bothRoles = await prepare(base);
  } finally {
    await server[Symbol.asyncDispose]();
  }
  // Isolate the failed probe so this case cannot inherit either successful selection.
  const faultServer = await startDemoServer({ port: 0, fault: 'settings' });
  try {
    const base = `http://127.0.0.1:${(faultServer.address() as AddressInfo).port}`;
    await keepAttempt(base, 'viewer', 500);
    const failed = await prepare(base);
    return { bothRoles, viewerOnly, failed };
  } finally {
    await faultServer[Symbol.asyncDispose]();
  }
}
