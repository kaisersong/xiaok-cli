import type { CapturedSqliteCell } from './source-sqlite-cell.js';
export interface CapturedGroupsRow {
    readonly table: string;
    readonly rowid: string;
    readonly cells: Readonly<Record<string, CapturedSqliteCell>>;
    readonly json: Readonly<Record<string, unknown>>;
}
export declare function groupsObject(value: unknown): Record<string, unknown>;
export declare function readCapturedGroupsRow(table: string, row: Readonly<{
    rowid: string;
    record: Readonly<Record<string, CapturedSqliteCell>>;
}>): CapturedGroupsRow;
