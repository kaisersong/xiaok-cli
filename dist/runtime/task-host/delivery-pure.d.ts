import type { TaskSnapshot } from './types.js';
import type { CompletionEvidenceRecord, CompletionExpectation } from '../guards/completion-evidence.js';
export declare function collectArtifactEvidence(snapshot: TaskSnapshot): unknown[];
interface CompletionEvidenceContext {
    expectation?: CompletionExpectation;
    evidence: CompletionEvidenceRecord[];
}
export declare function buildCompletionEvidenceContext(taskId: string, snapshot: TaskSnapshot): CompletionEvidenceContext;
export declare function evidenceForExpectation(expectation: CompletionExpectation, evidence: CompletionEvidenceRecord[]): CompletionEvidenceRecord[];
export declare function shouldRequireArtifactEvidence(snapshot: TaskSnapshot): boolean;
export declare function hasClarificationResult(snapshot: TaskSnapshot): boolean;
export declare function isEmptyDelivery(snapshot: TaskSnapshot): boolean;
export {};
