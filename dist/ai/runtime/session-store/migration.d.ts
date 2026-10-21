import type { SessionExecutionLease } from './execution-authority.js';
import type { PersistedSessionSnapshot } from './store.js';
export interface SessionMigrationInput {
    sessionId: string;
    expectedSnapshotHash: string;
    expectedStoreRevision: number;
    migrationId: string;
    targetAuthorityId: string;
    targetSessionId: string;
    migrationEpoch: number;
    importReceiptHash: string;
    lease: SessionExecutionLease;
}
export type SessionMigrationMarker = Omit<SessionMigrationInput, 'lease'> & {
    version: 1;
};
export declare function captureMigrationMarker(value: unknown): SessionMigrationMarker;
export declare function migrationMarkerFromInput(input: SessionMigrationInput): SessionMigrationMarker;
/** Canonical full durable snapshot; distinct from provider history digest. */
export declare function computeSessionSnapshotHash(snapshot: PersistedSessionSnapshot): string;
export declare function freezeMigrationSnapshot(snapshot: PersistedSessionSnapshot): PersistedSessionSnapshot;
