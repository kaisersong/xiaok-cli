import { type KSwarmStateQueryId as Table } from './kswarm-state-source-schema.js';
import type { CapturedSqliteCell as Cell } from './source-sqlite-cell.js';
type Counts = Readonly<Record<Table, number>>;
type Summary = Readonly<{
    sourceId: string;
    snapshotHash: string;
    counts: Counts;
}>;
type Reference = Readonly<{
    column: 'entity_key' | 'project_id';
    domain: string;
    value: Cell;
    referenceState: 'declared' | 'uninterpreted';
}>;
export type KSwarmStateSourceEvent = Readonly<{
    kind: 'source-start';
    sourceId: string;
    snapshotHash: string;
    format: 'kswarm-state-sqlite-v1';
}> | Readonly<{
    kind: 'row';
    sourceId: string;
    table: Table;
    rowid: string;
    record: Readonly<Record<string, Cell>>;
    references: readonly Reference[];
}> | Readonly<{
    kind: 'source-end';
    sourceId: string;
    counts: Counts;
}> | Readonly<{
    kind: 'complete';
    sources: readonly Summary[];
    digest: string;
}>;
/** Complete means all rows of supplied captures, never a full-profile grant. */
export declare function iterateCapturedSQLiteKSwarmStateSources(owner: object, token: object): Generator<KSwarmStateSourceEvent, void, unknown>;
export {};
