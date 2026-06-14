export declare const SENSITIVE_BASENAMES: ReadonlySet<string>;
export declare const SENSITIVE_GLOB_EXTENSIONS: readonly string[];
export declare const SENSITIVE_PATH_SEGMENTS: readonly string[];
export declare function isSensitivePath(absPath: string): boolean;
export declare function isSensitiveToolInvocation(toolName: string, input: Record<string, unknown>): boolean;
export declare function isScreenAutomationFallbackInvocation(toolName: string, input: Record<string, unknown>): boolean;
export declare function describeSensitiveTarget(input: Record<string, unknown>): string;
export declare const __TEST_ONLY__: {
    sep: "\\" | "/";
};
