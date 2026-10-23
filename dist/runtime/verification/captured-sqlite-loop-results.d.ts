import type { CapturedLoopRow, CapturedLoopSourceReader } from './captured-sqlite-loop-reader.js';
import { type CapturedLoopRunBasis } from './captured-sqlite-loop-publication.js';
import { type LoopProjectionOrigin } from '../loop/business-projection.js';
import { readCapturedTaskDeclarations } from '../task-host/snapshot-store.js';
type Row = Readonly<Record<string, unknown>>;
export interface CapturedLoopEmbeddedTask {
    stageId: string;
    declaration: ReturnType<typeof readCapturedTaskDeclarations>;
    completionObservation: unknown;
}
/** Only this run's original single JSON row and ID indices are retained. */
export declare class CapturedLoopRunProjection {
    private readonly reader;
    readonly run: CapturedLoopRow;
    readonly origin: LoopProjectionOrigin | null;
    private readonly beforeStages;
    constructor(reader: CapturedLoopSourceReader, run: CapturedLoopRow);
    stagedMembers(): Generator<Row>;
    hasExecution(stageId: string): boolean;
    stage(stageId: unknown): Row;
}
export declare function parseCapturedLoopEmbeddedTask(row: CapturedLoopRow): CapturedLoopEmbeddedTask;
export declare function validateCapturedLoopResult(item: CapturedLoopRow, run: CapturedLoopRow, basis: CapturedLoopRunBasis, projection: CapturedLoopRunProjection): Readonly<import("./loop-application-binding.js").LoopCandidateBody>;
/** Original canonical vector bytes, without accumulating the membership array. */
export declare function validateCapturedLoopCandidateVector(reader: CapturedLoopSourceReader, candidate: CapturedLoopRow, run: CapturedLoopRow, basis: CapturedLoopRunBasis, projection: CapturedLoopRunProjection): void;
export declare function validateCapturedLoopProjectionHistory(reader: CapturedLoopSourceReader, run: CapturedLoopRow, basis: CapturedLoopRunBasis | undefined, projection: CapturedLoopRunProjection): void;
export {};
