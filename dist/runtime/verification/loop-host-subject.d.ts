export interface LoopHostSubject {
    kind: 'loop-run';
    loopId: string;
    runId: string;
    stage: Readonly<{
        stageId: string;
        stageKind: 'scan' | 'execute' | 'verify';
    }> | null;
}
/** Immutable host identity only. A Loop run is not a chat session, an execution
 * invocation, native approval, or a completion projection capability. */
export declare function parseLoopHostSubject(raw: unknown): Readonly<LoopHostSubject>;
export declare function loopHostSubjectHash(raw: unknown): string;
/** Shared exact identity mapping; this does not register the owner. */
export declare function loopHostSubjectOwner(raw: unknown): Pick<import("./proof-authority.js").VerificationOwner, "ownerId" | "ownerKind">;
