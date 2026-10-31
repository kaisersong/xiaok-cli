export declare function promptAutoContextBudget(readBudget: () => number | undefined): {
    maxChars?: number;
};
export declare function resolveAutoContextMaxChars(maxChars: number | undefined): number;
export declare function truncateContextContent(content: string, maxChars: number): {
    content: string;
    truncated: boolean;
};
