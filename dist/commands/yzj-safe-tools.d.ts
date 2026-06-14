export declare function getYzjSafeDefaultTools(): string[];
export interface ResolveYzjAllowedToolsInput {
    disableSafeDefault?: boolean;
    extraAllowedTools?: string[];
}
export declare function resolveYzjAllowedTools(input: ResolveYzjAllowedToolsInput): string[] | undefined;
