import type { HarnessMemoryEvidence } from './types.js';
export declare function evaluateHarnessMemoryPromotion(evidence: HarnessMemoryEvidence[]): {
    status: 'rejected' | 'candidate' | 'active';
    reason: string;
};
