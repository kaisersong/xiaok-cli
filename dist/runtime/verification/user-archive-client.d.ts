import type { AuthenticatedArchiveTransport } from './archive-transport.js';
import { type ArchiveResourceReview } from './archive-operation-review.js';
export interface UserArchiveReadRequest {
    requestSource: 'user' | 'agent' | 'scheduler';
    ownerKind: 'task' | 'goal' | 'intent' | 'project' | 'loop';
    ownerId: string;
    resource: {
        kind: 'transcript' | 'protected-run';
        id: string;
    };
}
/** Explicit host read, never an agent tool. No output is returned until every
 * ordered page and the complete original content hash have been verified. */
export declare function readUserArchive(transport: AuthenticatedArchiveTransport, input: UserArchiveReadRequest, signal: AbortSignal): Promise<Readonly<{
    resource: Readonly<ArchiveResourceReview>;
    streams: Readonly<Record<string, Buffer>>;
}>>;
export interface UserArchiveListRequest {
    requestSource: 'user' | 'agent' | 'scheduler';
    ownerKind: UserArchiveReadRequest['ownerKind'];
    ownerId: string;
    kind: 'transcript' | 'protected-run';
    cursor: string | null;
    limit: number;
}
/** Metadata discovery does not authorize opening a resource. */
export declare function listUserArchives(transport: AuthenticatedArchiveTransport, input: UserArchiveListRequest, signal: AbortSignal): Promise<Readonly<{
    items: readonly Readonly<{
        id: string;
        kind: UserArchiveListRequest["kind"];
        state: string;
    }>[];
    nextCursor: string | null;
}>>;
/** Explicit native-approved deletion. An unknown reply is not automatically retried. */
export declare function deleteUserArchive(transport: AuthenticatedArchiveTransport, input: UserArchiveReadRequest, signal: AbortSignal): Promise<Readonly<{
    deleted: true;
    resource: Readonly<ArchiveResourceReview>;
}>>;
