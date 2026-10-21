import { type CapturedLoopReference } from './captured-sqlite-loop-row-semantics.js';
import { type CapturedLoopEmbeddedTask } from './captured-sqlite-loop-results.js';
import type { CapturedSqliteCell } from './source-sqlite-cell.js';
type TableCount = Readonly<{
    table: string;
    count: string;
}>;
type SourceCount = Readonly<{
    sourceId: string;
    snapshotHash: string;
    tables: readonly TableCount[];
}>;
export type CapturedLoopStreamEvent = Readonly<{
    kind: 'source-start';
    sourceId: string;
    snapshotHash: string;
}> | Readonly<{
    kind: 'table-start';
    sourceId: string;
    table: string;
    columns: readonly string[];
}> | Readonly<{
    kind: 'row';
    sourceId: string;
    table: string;
    ordinal: string;
    rowid: string;
    cells: Readonly<Record<string, CapturedSqliteCell>>;
    parsed: Readonly<Record<string, unknown>>;
    references: readonly CapturedLoopReference[];
    embeddedTasks: readonly CapturedLoopEmbeddedTask[];
}> | Readonly<{
    kind: 'table-end';
    sourceId: string;
    table: string;
    count: string;
}> | Readonly<SourceCount & {
    kind: 'source-end';
}> | Readonly<{
    kind: 'complete';
    version: 1;
    sources: readonly SourceCount[];
    digest: string;
}>;
/** Full historical declarations only. A prefix is never complete; neither the
 * stream nor its digest grants ownership, custody, or protected write authority. */
export declare function iterateCapturedSQLiteLoopSources(owner: object, token: object): Generator<CapturedLoopStreamEvent, void, unknown>;
export {};
