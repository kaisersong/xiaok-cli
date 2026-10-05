import { type CapturedGroupsReference } from './captured-sqlite-groups-references.js';
import type { CapturedSqliteCell } from './source-sqlite-cell.js';
type Count = Readonly<{
    table: string;
    count: string;
}>;
type Source = Readonly<{
    sourceId: string;
    snapshotHash: string;
    tables: readonly Count[];
}>;
export type CapturedGroupsStreamEvent = Readonly<{
    kind: 'source-start';
    sourceId: string;
    snapshotHash: string;
    userVersion: 1 | 2 | 3;
}> | Readonly<{
    kind: 'table-start';
    sourceId: string;
    table: string;
    columns: readonly string[];
}> | Readonly<{
    kind: 'row';
    sourceId: string;
    table: string;
    rowid: string;
    ordinal: string;
    cells: Readonly<Record<string, CapturedSqliteCell>>;
    parsed: Readonly<Record<string, unknown>>;
    references: readonly CapturedGroupsReference[];
    unmapped: readonly string[];
    observationDeclarations: readonly Readonly<{
        path: string;
        reference: unknown;
    }>[];
}> | Readonly<{
    kind: 'table-end';
    sourceId: string;
    table: string;
    count: string;
}> | Readonly<Source & {
    kind: 'source-end';
}> | Readonly<{
    kind: 'complete';
    version: 1;
    sources: readonly Source[];
    digest: string;
}>;
/** Complete internal capture declarations; neither these rows nor the final
 * digest are an authorization, source lock, read grant, or import capability. */
export declare function iterateCapturedSQLiteGroupsSources(owner: object, token: object): Generator<CapturedGroupsStreamEvent, void, unknown>;
export {};
