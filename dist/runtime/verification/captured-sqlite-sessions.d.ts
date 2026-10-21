import { readCapturedSessionDocument } from '../../ai/runtime/session-store/file-store.js';
import { type SessionMigrationMarker } from '../../ai/runtime/session-store/migration.js';
type Declaration = ReturnType<typeof readCapturedSessionDocument>;
interface CapturedSessionSource {
    readonly sourceId: string;
    readonly snapshotHash: string;
    readonly sessions: readonly Declaration[];
    readonly migrations: readonly SessionMigrationMarker[];
    readonly lastSessionReference: string | null;
}
/** All Session SQLite sources in the original branded capture. These are
 * declarations, not the complete profile attribution or capacity owners. */
export declare function readCapturedSQLiteSessionSources(owner: object, token: object): Readonly<{
    kind: "captured-sqlite-session-declarations";
    sources: CapturedSessionSource[];
}>;
export {};
