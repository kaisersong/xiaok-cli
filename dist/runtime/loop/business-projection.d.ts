import type { CurrentLoopPublicationSet } from '../loop/published-set.js';
import type { LoopRunRow, LoopStageRow, AssistantCandidateRow, StoredLoopPublicationCandidate } from './producer-types.js';
import type { LoopPublicationAttempt } from './publication-attempt.js';
import type { TaskSnapshot } from '../task-host/types.js';
export interface LoopProjectionRows {
    run: LoopRunRow;
    stages: LoopStageRow[];
    members: AssistantCandidateRow[];
}
export interface LoopProjectionOrigin {
    before: LoopProjectionRows;
    after: LoopProjectionRows;
}
export interface LoopBusinessProjection {
    runId: string;
    originHash: string;
    origin: LoopProjectionOrigin;
    generation: number;
    previousGenerationHash: string | null;
    generationHash: string;
    observation: Readonly<CurrentLoopPublicationSet>;
}
export interface LoopBusinessProjectionTarget {
    runId: string;
    vector: string;
    rows: LoopProjectionRows;
    candidates: readonly Readonly<StoredLoopPublicationCandidate>[];
    publications: readonly Readonly<LoopPublicationAttempt>[];
    executions: readonly TaskSnapshot[];
    projection: Readonly<LoopBusinessProjection> | null;
}
export declare function loopProjectionHash(value: unknown): string;
export declare function freezeProjection<T>(value: T): Readonly<T>;
export declare function projectedLoopRows(before: LoopProjectionRows, now: number): LoopProjectionRows;
export declare function validateLoopProjectionOrigin(origin: LoopProjectionOrigin): void;
/** Interpret only an exact originally projected row. Decisions may overlay an
 * original member, but can never change its immutable business contents. */
export declare function normalizeLoopProjectionRows(current: LoopProjectionRows, origin: LoopProjectionOrigin): LoopProjectionRows;
/** The exact ordinary decision overlay used by the full projector and captured
 * row reader. It neither mutates the source row nor establishes current proof. */
export declare function assertLoopProjectedMember(current: AssistantCandidateRow, after: AssistantCandidateRow): void;
