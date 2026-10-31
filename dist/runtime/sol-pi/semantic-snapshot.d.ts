import type { Message } from '../../types.js';
import type { CompactionPlan } from '../../ai/runtime/usage.js';
import type { PersistedSessionSnapshot, StoredSessionSnapshot } from '../../ai/runtime/session-store/store.js';
import { type ObservationSessionOwner } from './observation-session-owner.js';
export interface SemanticSnapshotCandidate {
    status: 'compacted';
    snapshot: PersistedSessionSnapshot;
    anchorDigest: string;
}
export interface StoredSemanticSnapshotCandidate extends Omit<SemanticSnapshotCandidate, 'snapshot'> {
    snapshot: StoredSessionSnapshot;
}
export declare function readSemanticSnapshotCandidate(candidate: SemanticSnapshotCandidate): {
    snapshot: PersistedSessionSnapshot;
    anchorDigest: string;
    sourceHistoryDigest: string;
};
export declare function readSemanticSnapshotCandidate(candidate: StoredSemanticSnapshotCandidate): {
    snapshot: StoredSessionSnapshot;
    anchorDigest: string;
    sourceHistoryDigest: string;
};
export declare function buildStrictSemanticSnapshot(input: {
    sourceSnapshot: PersistedSessionSnapshot;
    plan: CompactionPlan;
    summaryText: string;
    observationOwner: ObservationSessionOwner;
    measureInputTokens(messages: Message[]): number;
}): {
    status: 'no_gain';
} | SemanticSnapshotCandidate;
export declare function buildStrictSemanticSnapshot(input: {
    sourceSnapshot: StoredSessionSnapshot;
    plan: CompactionPlan;
    summaryText: string;
    observationOwner: ObservationSessionOwner;
    measureInputTokens(messages: Message[]): number;
}): {
    status: 'no_gain';
} | StoredSemanticSnapshotCandidate;
