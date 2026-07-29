import type { Message, UsageStats } from '../../../types.js';
import type { CompactionRecord } from '../session.js';
import type { SessionIntentLedger } from '../../../runtime/intent-delegation/types.js';
import type { SessionSkillEvalState } from '../../../runtime/intent-delegation/skill-eval.js';
import type { SessionSkillExecutionState } from '../../skills/execution-state.js';
export interface PersistedSessionSnapshot {
    sessionId: string;
    cwd: string;
    model?: string;
    createdAt: number;
    updatedAt: number;
    forkedFromSessionId?: string;
    lineage: string[];
    messages: Message[];
    usage: UsageStats;
    compactions: CompactionRecord[];
    promptSnapshotId?: string;
    memoryRefs: string[];
    approvalRefs: string[];
    backgroundJobRefs: string[];
    intentDelegation?: SessionIntentLedger;
    skillEval?: SessionSkillEvalState;
    skillExecution?: SessionSkillExecutionState;
}
export interface SessionListEntry {
    sessionId: string;
    cwd: string;
    updatedAt: number;
    preview: string;
}
export declare const KIMI_K3_DURABLE_RESUME_UNSUPPORTED = "KIMI_K3_DURABLE_RESUME_UNSUPPORTED";
export declare class KimiK3DurableResumeUnsupportedError extends Error {
    readonly code = "KIMI_K3_DURABLE_RESUME_UNSUPPORTED";
    constructor();
}
export declare function isKimiK3DurableModel(model: string | undefined): model is 'k3' | 'k3-256k';
export declare function toDurableSessionSnapshot(snapshot: PersistedSessionSnapshot): PersistedSessionSnapshot;
export declare function assertKimiK3DurableResumeSupported(snapshot: PersistedSessionSnapshot): void;
export declare function assertKimiK3TargetResumeSupported(strictKimiTarget: boolean, snapshot: PersistedSessionSnapshot): void;
export interface SessionStore {
    save(snapshot: PersistedSessionSnapshot): Promise<void>;
    load(sessionId: string): Promise<PersistedSessionSnapshot | null>;
    loadLast(): Promise<PersistedSessionSnapshot | null>;
    list(): Promise<SessionListEntry[]>;
    fork(sessionId: string): Promise<PersistedSessionSnapshot>;
}
