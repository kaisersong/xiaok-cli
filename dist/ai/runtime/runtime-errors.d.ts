export interface RuntimeErrorShape {
    code: 'model_failed' | 'tool_failed' | 'permission_denied' | 'runtime_aborted';
    message: string;
    retryable: boolean;
}
export declare function normalizeRuntimeError(error: unknown): RuntimeErrorShape;
