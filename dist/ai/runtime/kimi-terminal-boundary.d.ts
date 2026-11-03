export declare const KIMI_TERMINAL_BOUNDARY_CODE = "KIMI_REASONING_TERMINAL_BOUNDARY_REQUIRED";
/** Protocol facts only: never attach provider content or tool argument fragments. */
export declare function createKimiTerminalBoundaryError(facts: {
    boundaryKind: 'missing_finish' | 'invalid_tool_call';
    sawOfficialReasoning: boolean;
    toolCallCount: number;
}): Error & {
    code: string;
    retryable: boolean;
};
export declare function isKimiTerminalBoundaryError(error: unknown): boolean;
export declare function getKimiTerminalBoundaryDiagnostic(error: unknown): {
    code: string;
    boundaryKind: string;
    sawOfficialReasoning: boolean;
    toolCallCount: number;
} | undefined;
