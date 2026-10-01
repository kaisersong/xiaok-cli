export type TableAlignment = 'left' | 'right' | 'center';
export interface MarkdownTable {
    header: string[];
    alignment: TableAlignment[];
    rows: string[][];
}
/** Split only structural pipes; matched code spans and escaped pipes are data. */
export declare function splitTableRow(line: string): string[] | null;
export declare function tableAlignment(line: string, columns: number): TableAlignment[] | null;
export declare function tableDisplayWidth(text: string): number;
export declare function renderMarkdownTable(table: MarkdownTable, columns: number, inline: (text: string) => string, forceRecords?: boolean): string[];
