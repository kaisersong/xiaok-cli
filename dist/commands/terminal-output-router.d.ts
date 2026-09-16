export type TerminalStream = 'stdout' | 'stderr';
type Writer = (...args: Parameters<NodeJS.WriteStream['write']>) => boolean;
/** A failed terminal stream is never retried within this session. */
export declare function createTerminalOutputRouter(options: {
    stdout: Writer;
    stderr: Writer;
    onFailure: (stream: TerminalStream, error: unknown, fallback: TerminalStream | null) => void;
}): {
    fail: (stream: TerminalStream, error: unknown) => void;
    write: (stream: TerminalStream, str: string | Uint8Array<ArrayBufferLike>, encoding?: BufferEncoding | undefined, cb?: ((err?: Error | null) => void) | undefined) => boolean;
    hasOutput: () => boolean;
};
export {};
