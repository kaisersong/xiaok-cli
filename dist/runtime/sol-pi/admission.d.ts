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
export declare function evaluateSolPiAdmission(input: SolPiAdmissionInput): SolPiAdmissionDecision;
