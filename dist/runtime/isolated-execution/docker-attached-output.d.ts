export interface AttachedOutputResult {
    readonly complete: boolean;
    readonly truncated: boolean;
    readonly reason?: 'deadline' | 'aborted' | 'transport' | 'frame' | 'limit' | 'stdin';
    readonly stdout: Buffer;
    readonly stderr: Buffer;
}
export interface AttachedOutputCapture {
    readonly completed: Promise<AttachedOutputResult>;
    cancel(): void;
}
/** Raw untrusted output only. EOF is not a physical tree receipt. */
export declare function attachDockerOutput(socketPath: string, id: string, options?: {
    timeoutMs?: number;
    maximumBytes?: number;
    signal?: AbortSignal;
    stdin?: Buffer;
}): Promise<AttachedOutputCapture>;
