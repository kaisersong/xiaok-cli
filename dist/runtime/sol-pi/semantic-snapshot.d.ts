import type { Message } from '../../types.js';
import type { CompactionPlan } from '../../ai/runtime/usage.js';
import type { PersistedSessionSnapshot } from '../../ai/runtime/session-store/store.js';
import { type ObservationSessionOwner } from './observation-session-owner.js';
export interface SemanticSnapshotCandidate {
    status: 'compacted';
    snapshot: PersistedSessionSnapshot;
    anchorDigest: string;
}
export declare function readSemanticSnapshotCandidate(candidate: SemanticSnapshotCandidate): {
    snapshot: PersistedSessionSnapshot;
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
