import { type GoalForkSourceSnapshot } from '../verification/owner-enrollment-review.js';
import { type AtomicWriteFile } from '../../utils/atomic-file.js';
import { type GoalApplicationBinding } from '../verification/goal-application-binding.js';
import { type GoalVerificationDefinition } from './verification-definition.js';
import type { GoalState } from './types.js';
type Status = 'reserved' | 'enrolling' | 'enrolled' | 'binding' | 'ready' | 'applied' | 'retired' | 'stale';
export interface GoalNativeMutation {
    id: string;
    revision: number;
    sessionId: string;
    kind: 'create' | 'replace' | 'fork';
    forkSource?: {
        stateHash: string;
        snapshot: Readonly<GoalForkSourceSnapshot>;
    };
    previous: null | {
        goalId: string;
        epoch: number;
        revision: number;
        createdAt: number;
        forkedFromGoalId: string | null;
        stateHash: string;
    };
    target: Readonly<GoalApplicationBinding>;
    turnLimit: number;
    definition: Readonly<GoalVerificationDefinition>;
    enrollmentRequestId: string;
    applicationRequestId: string;
    status: Status;
    createdAt: number;
    updatedAt: number;
}
export interface GoalNativeMutationUpdate {
    sessionId: string;
    requestSource: 'user' | 'agent' | 'scheduler';
    expectedRevision: number | null;
    next: GoalNativeMutation;
}
export declare function isGoalNativeJournalId(value: unknown): value is string;
export declare function parseGoalNativeMutation(raw: unknown): GoalNativeMutation;
/** Hash exactly the durable Goal JSON, omitting optional undefined fields. */
export declare function goalNativeStateHash(state: GoalState | null): string;
/** Deterministic draft only. Calling this function never activates a Goal. */
export declare function goalNativeCandidate(raw: unknown): GoalState;
/** Main/CLI-owned recovery facts, not authorization. The byte/count bounds are
 * per session, including all terminal records; no whole-profile bound is claimed. */
export declare class FileGoalNativeJournal {
    private readonly rootDir;
    private readonly atomicWrite;
    constructor(rootDir: string, atomicWrite?: AtomicWriteFile);
    load(sessionId: string): GoalNativeMutation[];
    put(raw: GoalNativeMutationUpdate): void;
    private path;
}
/** Original document validation; does not read a journal or issue a receipt. */
export declare function parseGoalNativeJournalDocument(document: unknown, sessionId: string): GoalNativeMutation[];
export {};
