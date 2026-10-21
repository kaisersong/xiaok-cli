/** Diagnostic experiment gates only: no authority, proof issuance or feature enablement. */
export type SolPiCandidate = 'P3-R' | 'P3-C';
export type AdmissionGate = 'capability' | 'efficiency' | 'cost' | 'experience' | 'mechanism';
export type AdmissionGateStatus = 'passed' | 'failed' | 'inconclusive';
export interface SolPiAdmissionInput {
  candidate: SolPiCandidate;
  gates: Partial<Record<AdmissionGate, AdmissionGateStatus>>;
}
export interface SolPiAdmissionDecision {
  candidate: SolPiCandidate;
  status: 'no-go' | 'inconclusive' | 'eligible-for-experiment';
  reasons: string[];
  enableByDefault: false;
}
const GATES: readonly AdmissionGate[] = ['capability', 'efficiency', 'cost', 'experience', 'mechanism'];

export function evaluateSolPiAdmission(input: SolPiAdmissionInput): SolPiAdmissionDecision {
  const result = (status: SolPiAdmissionDecision['status'], reasons: string[]): SolPiAdmissionDecision =>
    ({ candidate: input.candidate, status, reasons, enableByDefault: false });
  if (input.candidate !== 'P3-R' && input.candidate !== 'P3-C') return result('no-go', ['unsupported_candidate']);
  // No qualified isolated adapter/control plane exists in this implementation.
  // Caller supplied claims must never confer trusted receipt capability.
  if (input.candidate === 'P3-R') return result('no-go', ['trusted_receipt_unavailable']);
  const failed = GATES.filter(gate => input.gates?.[gate] === 'failed');
  if (failed.length) return result('no-go', failed.map(gate => `${gate}_failed`));
  const unknown = GATES.filter(gate => input.gates?.[gate] !== 'passed');
  if (unknown.length) return result('inconclusive', unknown.map(gate => `${gate}_inconclusive`));
  return result('eligible-for-experiment', []);
}
