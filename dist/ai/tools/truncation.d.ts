export interface PaginationResult<T> {
    items: T[];
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
    nextOffset: number | null;
}
export interface TruncationResult {
    text: string;
    truncated: boolean;
}
export declare function paginateItems<T>(items: T[], offset?: number, limit?: number): PaginationResult<T>;
export declare function truncateText(text: string, maxChars?: number, notice?: string): TruncationResult;
export declare function appendPaginationNotice(text: string, nextOffset: number | null): string;
