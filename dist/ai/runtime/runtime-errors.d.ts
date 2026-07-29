export interface RuntimeErrorShape {
    code: 'model_failed' | 'tool_failed' | 'permission_denied' | 'runtime_aborted' | 'kimi_k3_durable_resume_unsupported';
    message: string;
    retryable: boolean;
}
export declare function normalizeRuntimeError(error: unknown): RuntimeErrorShape;
