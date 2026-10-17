import { type KSwarmStateQueryId } from './kswarm-state-source-schema.js';
export type LosslessSourceQueryId = ArtifactWorkspaceQueryId | KSwarmStateQueryId;
import { type MetadataSessionRelationId } from './metadata-session-relation-manifest.js';
import { type createInstalledRootBrokerClient } from './root-broker-client.js';
import type { InstalledControllerLifetime } from './installed-controller-lifetime.js';
import { type MetadataSessionQueryId } from './metadata-session-query-manifest.js';
import { type ArtifactWorkspaceQueryId } from './artifact-workspace-source-schema.js';
import { type CapturedSqliteCell } from './source-sqlite-cell.js';
export interface SqliteCustodySource {
    readonly snapshotFormat: 'session-sqlite-v1' | 'loop-sqlite-v1' | 'goal-sqlite-v1' | 'writer-lock-sqlite-v1' | 'codex-native-sqlite-v1' | 'codex-routes-sqlite-v1' | 'artifact-workspace-sqlite-v1' | 'kswarm-state-sqlite-v1' | 'multi-agent-groups-sqlite-v1';
    readonly directory: Readonly<{
        canonicalPath: string;
        device: string;
        inode: string;
    }>;
    readonly database: Readonly<{
        basename: string;
        device: string;
        inode: string;
    }>;
    readonly sidecars: Readonly<{
        journal: string;
        wal: string;
        shm: string;
    }>;
}
export interface SqliteSourcePhysicalFile {
    readonly suffix: '' | '-journal' | '-wal' | '-shm';
    readonly device: string;
    readonly inode: string;
    readonly byteLength: string;
}
export interface SqliteSourceCapture {
    source: Readonly<SqliteCustodySource>;
    pageSize: number;
    pageCount: number;
    byteLength: number;
    sha256: string;
    physicalFiles: readonly Readonly<SqliteSourcePhysicalFile>[];
}
/** This is a private native-process driver, not an authorization or full-set
 * issuer. The installed broker supplies its pinned helper and approved sources.
 * Only the full broker composition may turn actual captures into an import cap. */
export declare function startSqliteSourceCustody(input: {
    executable: string;
    uid: number;
    sources: readonly SqliteCustodySource[];
    signal: AbortSignal;
}): Promise<Readonly<{
    checkCurrent(): Promise<void>;
    capture(maximumBytes?: number): Promise<Readonly<{}>>;
    close: () => Promise<void>;
}>>;
export declare function readSqliteSourceCapture(owner: object, token: object): readonly Readonly<SqliteSourceCapture>[];
export declare function readSqliteSourceSchema(owner: object, token: object, index: number): readonly Readonly<{
    type: string;
    name: string;
    tbl_name: string;
    sql: string | null;
}>[];
export declare function assertSqliteSourceIntegrity(owner: object, token: object, index: number): void;
/** Separate lossless ABI; existing number-based readers remain unchanged. */
export declare function readSqliteSourceLosslessRows(owner: object, token: object, index: number, queryId: LosslessSourceQueryId): Generator<Readonly<{
    rowid: string;
    record: Readonly<Record<string, CapturedSqliteCell>>;
}>, void, unknown>;
/** Fixed original columns only; never caller SQL or a user-defined view. Layout
 * completeness and all-source/session closure are the collector's separate job. */
export declare function readSqliteSourceRows(owner: object, token: object, index: number, queryId: MetadataSessionQueryId): Generator<Readonly<Record<string, unknown>>, void, unknown>;
/** Fixed built-in FTS operation on a disposable parsing copy only. The original
 * captured pages and held source never receive a write and no SQL port escapes. */
export declare function assertSqliteSessionFtsIntegrity(owner: object, token: object, index: number): void;
/** Fixed original pager export for the installed root transport. It exposes no
 * SQL or mutable database and remains bound to the actual held capture. */
export declare function readSqliteSourcePage(owner: object, token: object, index: number, pageNo: number): Buffer;
export declare function captureInstalledSqliteSource(lifetime: InstalledControllerLifetime, broker: ReturnType<typeof createInstalledRootBrokerClient>, handle: object, sourceId: string, signal: AbortSignal): Promise<Readonly<{
    owner: Readonly<{
        checkCurrent(): Promise<void>;
        close(): Promise<void>;
    }>;
    token: Readonly<{}>;
}>>;
export interface CapturedSqliteReader {
    readonly __capturedSqliteReader?: never;
}
export interface CapturedSqliteReaderRow {
    readonly rowid: string;
    readonly record: Readonly<Record<string, CapturedSqliteCell>>;
}
/** Original capture and fixed catalogue only; no caller database or SQL port. */
export declare function openSqliteSourceReader(owner: object, token: object, index: number): CapturedSqliteReader;
export declare function closeSqliteSourceReader(reader: CapturedSqliteReader): void;
/** Schema facts from the very same parser connection used for all row/relationship
 * checks. No second parsing copy or mutable handle is returned. */
export declare function readSqliteSourceReaderSchema(reader: CapturedSqliteReader): readonly Readonly<{
    type: string;
    name: string;
    tbl_name: string;
    sql: string | null;
}>[];
/** Fixed metadata read on the original parser connection; not a schema capability. */
export declare function readSqliteSourceReaderUserVersion(reader: CapturedSqliteReader): number;
export declare function iterateSqliteSourceReaderRows(reader: CapturedSqliteReader, queryId: MetadataSessionQueryId): Generator<Readonly<CapturedSqliteReaderRow>, void, unknown>;
export declare function iterateSqliteSourceReaderRelation(reader: CapturedSqliteReader, relationId: MetadataSessionRelationId, boundKeys: readonly string[]): Generator<Readonly<CapturedSqliteReaderRow>, void, unknown>;
/** Private factual occupancy only; this does not read source bytes or grant use. */
export declare function hasSqliteSourceParser(owner: object, token: object): boolean;
