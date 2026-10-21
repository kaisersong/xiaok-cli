import { type MetadataSessionRelationId } from './metadata-session-relation-manifest.js';
import type { CapturedSqliteCell } from './source-sqlite-cell.js';
export interface CapturedLoopRow {
    readonly table: string;
    readonly rowid: string;
    readonly cells: Readonly<Record<string, CapturedSqliteCell>>;
    readonly value: Readonly<Record<string, unknown>>;
    readonly json: Readonly<Record<string, unknown>>;
}
/** Internal read-only semantic view of one already captured source. The actual
 * parser lifetime remains with the original profile reader; no caller SQL or
 * cached complete table is introduced here. */
export declare class CapturedLoopSourceReader {
    private readonly owner;
    private readonly token;
    readonly tables: readonly string[];
    private readonly reader;
    private closed;
    constructor(owner: object, token: object, sourceId: string);
    private current;
    close(): void;
    private parse;
    rows(table: string): Generator<CapturedLoopRow, void, unknown>;
    related(relation: MetadataSessionRelationId, key: string): Generator<CapturedLoopRow, void, unknown>;
    one(relation: MetadataSessionRelationId, key: unknown, required?: boolean): CapturedLoopRow | undefined;
}
