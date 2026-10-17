/** Only fixed, installed native broker helpers, never project workers. These helpers
 * cannot spawn descendants. Caller abort is not completion: await close before releasing admission. */
export declare function runBrokerHelper(input: {
    executable: string;
    args: readonly string[];
    stdin?: Buffer;
    maximumOutput: number;
    timeoutMs: number;
    signal: AbortSignal;
}): Promise<Buffer>;
