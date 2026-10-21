import type { readProfileSqliteReaderSchema } from './profile-source-capture.js';
import type { CapturedSqliteCell } from './source-sqlite-cell.js';
export declare function isOrdinaryLoopNumber(table: string, column: string): boolean;
/** Semantic temporary values only. Consumers must retain original tagged cells
 * in declarations, including REAL -0/subnormal and integers beyond JS precision. */
export declare function decodeCapturedLoopRow(table: string, cells: Readonly<Record<string, CapturedSqliteCell>>): Readonly<Record<string, unknown>>;
export declare function readCapturedLoopSchema(actual: ReturnType<typeof readProfileSqliteReaderSchema>): string[];
export declare function parseCapturedLoopSemanticRow(table: string, row: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
