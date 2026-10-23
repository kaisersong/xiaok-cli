/** Complete sqlite_master reference from the actual SqliteGoalStore constructor.
 * This is comparison data, never SQL to execute. Schema changes require a new
 * explicit format review rather than accepting a matching table-name subset. */
export declare const GOAL_SOURCE_SCHEMA: readonly Readonly<{
    type: string;
    name: string;
    tbl_name: string;
    sql: string;
} | {
    type: string;
    name: string;
    tbl_name: string;
    sql: null;
}>[];
