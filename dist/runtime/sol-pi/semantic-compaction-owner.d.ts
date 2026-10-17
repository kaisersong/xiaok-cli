import type { ModelAdapter, ToolDefinition } from '../../types.js';
import type { AgentSessionState, CompactionRecord } from '../../ai/runtime/session.js';
import type { SessionExecutionAuthority } from '../../ai/runtime/session-store/execution-authority.js';
import { type SessionStore } from '../../ai/runtime/session-store/store.js';
import { type ProductObservationPolicy } from './product-bootstrap.js';
import { type ObservationSessionOwner } from './observation-session-owner.js';
import { type VerifiedCapacityProfile } from './capacity-admission.js';
export interface SemanticCompactionOutcome {
    status: 'compacted' | 'skipped' | 'failed';
    attempted: boolean;
    reason?: string;
    record?: CompactionRecord;
    economicAdmission: 'not-passed' | 'passed';
}
export interface SemanticCompactionOwner {
    tryCompact(input: {
        invocationId: string;
        sourceRevision: number;
        adapter: ModelAdapter;
        tools: ToolDefinition[];
        systemPrompt: string;
        signal: AbortSignal;
        assertBoundaryCurrent?: () => void;
    }): Promise<SemanticCompactionOutcome>;
    dispose(): Promise<void>;
}
export declare function assertSemanticCompactionOwner(owner: SemanticCompactionOwner, session: AgentSessionState): void;
/** Host bootstrap only; explicit user policy, actual durable store and execution owner are mandatory. */
export declare function createSemanticCompactionOwner(options: {
    policy: ProductObservationPolicy;
    session: AgentSessionState;
    observationOwner: ObservationSessionOwner;
    store: SessionStore;
    authority: SessionExecutionAuthority;
    capacityProfile: VerifiedCapacityProfile;
}): SemanticCompactionOwner | undefined;
