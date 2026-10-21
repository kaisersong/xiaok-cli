import type { Database } from 'better-sqlite3';
export interface ExecutionWriteContext {
    readonly __executionWriteContext?: never;
}
export declare function inspectExecutionPreparationCommand(command: object, raw: object, database: Database): void;
export declare function executeExecutionPreparationCommand(command: object, context: ExecutionWriteContext): void;
