import type { Command } from 'commander';
import type { UserArchiveReadRequest, UserArchiveListRequest } from '../runtime/verification/user-archive-client.js';
/** Explicit user command; source bodies are never printed to terminal/model logs. */
export declare function exportProtectedArchive(input: UserArchiveReadRequest & {
    output: string;
}, signal: AbortSignal): Promise<{
    path: string;
    kind: string;
    bytes: number;
}>;
export declare function registerProtectedArchiveCommands(program: Command): void;
export declare function discoverProtectedArchives(input: UserArchiveListRequest, signal: AbortSignal): Promise<Readonly<{
    items: readonly Readonly<{
        id: string;
        kind: UserArchiveListRequest["kind"];
        state: string;
    }>[];
    nextCursor: string | null;
}>>;
export declare function removeProtectedArchive(input: UserArchiveReadRequest, signal: AbortSignal): Promise<Readonly<{
    deleted: true;
    resource: Readonly<import("../runtime/verification/archive-operation-review.js").ArchiveResourceReview>;
}>>;
