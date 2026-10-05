import type { MetadataSessionRelationId } from './metadata-session-relation-manifest.js';
import { type createInstalledRootBrokerClient } from './root-broker-client.js';
import type { InstalledControllerLifetime } from './installed-controller-lifetime.js';
import { type ProfileSourceDescriptor } from './profile-source-descriptor.js';
import { type DirectorySourceEntry } from './source-directory-process.js';
import { type SqliteSourceCapture } from './source-sqlite-process.js';
import type { MetadataSessionQueryId } from './metadata-session-query-manifest.js';
import type { LosslessSourceQueryId } from './source-sqlite-process.js';
type WithoutReview<T> = T extends unknown ? Omit<T, 'namespaceId' | 'reviewedSnapshotSha256'> : never;
export type ProfileCaptureSource = WithoutReview<ProfileSourceDescriptor>;
export interface ProfileCaptureFacts {
    readonly uid: number;
    readonly capturedBytes: number;
    readonly physicalFileBytes: string;
    readonly sources: readonly Readonly<{
        source: ProfileCaptureSource;
        snapshotHash: string;
    }>[];
}
/** Actual all-leaf capture owner. This is facts, not an approval, full historical
 * inventory, native-effect drain or capacity issuer. No caller callback can
 * substitute for a child. The root broker must separately bind original review,
 * principal, deadline, full registry membership and writer drain. */
export declare function startProfileSourceCapture(input: {
    uid: number;
    directoryHelper: string;
    sqliteHelper: string;
    sources: readonly ProfileCaptureSource[];
    signal: AbortSignal;
    maximumCaptureBytes?: number;
    maximumMetadataBytes?: number;
}): Promise<Readonly<{
    checkCurrent(): Promise<undefined>;
    capture(): Promise<Readonly<{}>>;
    close: () => Promise<void>;
}>>;
export declare function readProfileSourceCapture(owner: object, token: object): Readonly<ProfileCaptureFacts>;
/** Original factory CHECK only. JSON and caller methods cannot supply currentness. */
export declare function checkProfileSourceCapture(owner: object, token: object): Promise<void>;
export declare function readProfileDirectoryEntries(owner: object, token: object, sourceId: string): readonly Readonly<DirectorySourceEntry>[];
export declare function readProfileDirectoryFile(owner: object, token: object, sourceId: string, entryIndex: number): Buffer<ArrayBufferLike>;
export declare function readProfileDirectoryFileRange(owner: object, token: object, sourceId: string, entryIndex: number, offset: number, length: number): Buffer;
export declare function readProfileSqliteSchema(owner: object, token: object, sourceId: string): readonly Readonly<{
    type: string;
    name: string;
    tbl_name: string;
    sql: string | null;
}>[];
export declare function assertProfileSqliteIntegrity(owner: object, token: object, sourceId: string): void;
export declare function readProfileSqliteLosslessRows(owner: object, token: object, sourceId: string, queryId: LosslessSourceQueryId): Generator<Readonly<{
    rowid: string;
    record: Readonly<Record<string, import("./source-sqlite-cell.js").CapturedSqliteCell>>;
}>, void, unknown>;
export declare function readProfileSqliteRows(owner: object, token: object, sourceId: string, queryId: MetadataSessionQueryId): Generator<Readonly<Record<string, unknown>>, void, unknown>;
export declare function assertProfileSessionFtsIntegrity(owner: object, token: object, sourceId: string): void;
export declare function readProfileSqliteCapture(owner: object, token: object, sourceId: string): Readonly<SqliteSourceCapture>;
export declare function readProfileSqlitePage(owner: object, token: object, sourceId: string, pageNo: number): Buffer;
/** Production remote importer: actual installed lifetime/client/opaque handle
 * only. Plain captured bytes or a callback cannot populate the private brands. */
export declare function startInstalledProfileSourceCapture(lifetime: InstalledControllerLifetime, broker: ReturnType<typeof createInstalledRootBrokerClient>, handle: object, signal: AbortSignal): Promise<Readonly<{
    checkCurrent(): Promise<void>;
    capture(): Promise<object>;
    close(): Promise<void>;
}>>;
export declare function readProfileCaptureMetadataBytes(owner: object, token: object): number;
export interface ProfileSqliteReader {
    readonly __profileSqliteReader?: never;
}
export declare function openProfileSqliteReader(owner: object, token: object, sourceId: string): ProfileSqliteReader;
export declare function closeProfileSqliteReader(reader: ProfileSqliteReader): void;
export declare function readProfileSqliteReaderUserVersion(reader: ProfileSqliteReader): number;
export declare function readProfileSqliteReaderSchema(reader: ProfileSqliteReader): readonly Readonly<{
    type: string;
    name: string;
    tbl_name: string;
    sql: string | null;
}>[];
export declare function iterateProfileSqliteReaderRows(reader: ProfileSqliteReader, queryId: MetadataSessionQueryId): Generator<Readonly<import("./source-sqlite-process.js").CapturedSqliteReaderRow>, void, unknown>;
export declare function iterateProfileSqliteReaderRelation(reader: ProfileSqliteReader, relationId: MetadataSessionRelationId, boundKeys: readonly string[]): Generator<Readonly<import("./source-sqlite-process.js").CapturedSqliteReaderRow>, void, unknown>;
/** Installed provenance facts only. This is never a capacity, write, drain,
 * migration or retirement approval. A synchronous read cannot replace the
 * actual async broker check before and after physical operations. */
export declare function readInstalledProfileSourceCapture(lifetime: InstalledControllerLifetime, owner: object, token: object): Readonly<{
    facts: Readonly<ProfileCaptureFacts>;
    review: Readonly<import("./profile-source-review.js").ProfileSourceReview>;
    manifestHash: string;
    manifestBytes: number;
    capturedBytes: number;
}>;
/** Checks the original handle and deadline, without recapture or renewal. */
export declare function checkInstalledProfileSourceCapture(lifetime: InstalledControllerLifetime, owner: object, token: object): Promise<void>;
export {};
