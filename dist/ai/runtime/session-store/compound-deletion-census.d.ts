export declare function createCompoundDeletionBudget(initialBytes?: number): Readonly<{
    visit: (_path: string) => void;
    read(path: string): Buffer<ArrayBufferLike>;
}>;
export type CompoundDeletionBudget = ReturnType<typeof createCompoundDeletionBudget>;
export declare function readCompoundDeletionBytes(file: string, remaining?: number): Buffer;
/** Called under the existing root mutation + target execution guard. Keeps
 * descendant execution guards until the caller's receipt/delete transaction
 * ends. This authenticates no new execution or physical-stop receipt. */
export declare function holdCompoundDeletionCensus(root: string, initial: {
    sessionId: string;
    compoundOperations?: unknown;
    semanticCompaction?: unknown;
}, initialBytes: number, budget?: Readonly<{
    visit: (_path: string) => void;
    read(path: string): Buffer<ArrayBufferLike>;
}>): (() => void) & {
    readonly sessionIds: readonly string[];
};
