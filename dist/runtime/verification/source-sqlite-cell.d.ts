/** Exact scalar declarations, not native identities or authorization. */
export type CapturedSqliteCell = Readonly<{
    type: 'null';
} | {
    type: 'integer' | 'real' | 'text' | 'blob';
    value: string;
}>;
export type CapturedSqliteEncoding = 'UTF-8' | 'UTF-16le' | 'UTF-16be';
export declare function capturedSqliteEncoding(value: unknown): CapturedSqliteEncoding;
export declare function encodeCapturedSqliteCell(type: unknown, value: unknown, textBytes: unknown, encoding: CapturedSqliteEncoding): CapturedSqliteCell;
