import type { CapturedLoopRow, CapturedLoopSourceReader } from './captured-sqlite-loop-reader.js';
export interface CapturedLoopReference {
    namespace: string;
    relation: string;
    id: string;
    record: string;
}
export declare function loopSemanticFailure(reason: string): never;
export declare function loopObject(value: unknown): Record<string, unknown>;
export declare function loopArray(value: unknown): unknown[];
export declare function loopChoice(value: unknown, values: readonly unknown[]): void;
export declare function loopIds(value: unknown): string[];
/** Ordinary own-row declarations and constant-parent lookups. Run-scoped
 * publication/hash/history validation is a separate pass, never inferred here. */
export declare function validateCapturedLoopOrdinaryRow(reader: CapturedLoopSourceReader, item: CapturedLoopRow): CapturedLoopReference[];
/** One visit per outgoing edge; IDs only, never retained rule/body rows. */
export declare function validateCapturedLoopConstraintChains(reader: CapturedLoopSourceReader): void;
