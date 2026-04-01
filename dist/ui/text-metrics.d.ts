export declare function stripAnsi(text: string): string;
export declare function splitSymbols(text: string): string[];
export declare function clampOffset(text: string, offset: number): number;
export declare function getDisplayWidth(text: string): number;
export declare function moveOffsetLeft(text: string, offset: number): number;
export declare function moveOffsetRight(text: string, offset: number): number;
export declare function offsetToDisplayColumn(text: string, offset: number): number;
export declare function sliceByDisplayColumns(text: string, start: number, width: number): string;
