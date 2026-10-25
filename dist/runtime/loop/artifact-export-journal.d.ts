import type { LoopArtifactDescriptor } from '../verification/loop-application-binding.js';
import type { ArtifactExportFileIdentity, ArtifactExportOutcome } from './producer-types.js';
export interface LoopArtifactExportPreparation {
    id: string;
    requestSource: 'user' | 'agent' | 'scheduler';
    now: number;
    source: {
        loopId: string;
        runId: string;
        candidateId: string;
        candidateRevision: number;
        payloadHash: string;
        vectorHash: string;
        descriptor: LoopArtifactDescriptor;
    };
    destination: {
        parent: string;
        parentIdentity: ArtifactExportFileIdentity;
        temporaryName: string;
        targetName: string;
        ownershipToken: string;
    };
}
export type LoopArtifactExportEvent = {
    kind: 'created';
    fileIdentity: ArtifactExportFileIdentity;
} | {
    kind: 'staged';
    fileIdentity: ArtifactExportFileIdentity;
    sha256: string;
    size: number;
} | {
    kind: 'committing';
} | {
    kind: 'interrupted';
} | {
    kind: 'settled';
    outcome: ArtifactExportOutcome;
} | {
    kind: 'recovered';
    fileIdentity: ArtifactExportFileIdentity;
};
/** Historical facts only. Neither a read nor an exact retry authorizes I/O. */
export interface LoopArtifactExportRecord extends Omit<LoopArtifactExportPreparation, 'now' | 'requestSource'> {
    requestSource: 'user';
    sequence: number;
    revision: number;
    createdAt: number;
    updatedAt: number;
    progress: 'prepared' | 'created' | 'staged' | 'committing';
    state: 'pending' | 'unknown' | 'settled';
    fileIdentity: ArtifactExportFileIdentity | null;
    outcome: ArtifactExportOutcome | null;
    lastEvent: LoopArtifactExportEvent | null;
}
export interface LoopArtifactExportUpdate {
    id: string;
    expectedRevision: number;
    requestSource: 'user' | 'agent' | 'scheduler';
    now: number;
    event: LoopArtifactExportEvent;
}
export interface LoopArtifactExportRow {
    sequence: number;
    id: string;
    revision: number;
    parent_device: string;
    parent_inode: string;
    temporary_name: string;
    record_json: string;
    record_hash: string;
}
export declare function parseLoopArtifactExportPreparation(raw: LoopArtifactExportPreparation): LoopArtifactExportPreparation;
export declare function parseLoopArtifactExportRecord(raw: LoopArtifactExportRecord): Readonly<LoopArtifactExportRecord>;
export declare function createLoopArtifactExportRecord(p: LoopArtifactExportPreparation, sequence: number): Readonly<LoopArtifactExportRecord>;
export declare function parseLoopArtifactExportUpdate(raw: LoopArtifactExportUpdate): LoopArtifactExportUpdate;
export declare function advanceLoopArtifactExport(old: Readonly<LoopArtifactExportRecord>, u: LoopArtifactExportUpdate): Readonly<LoopArtifactExportRecord>;
/** Pure crash classification for the private lifecycle owner. This preserves
 * the historical user request; it does not fabricate a new user update, grant
 * an installed writer, perform cleanup, or authorize replay of C/W/K. */
export declare function interruptPendingLoopArtifactExport(raw: Readonly<LoopArtifactExportRecord>, now: number): Readonly<LoopArtifactExportRecord>;
export declare function loopArtifactExportHash(encoded: string): string;
export declare function readLoopArtifactExportRow(row: LoopArtifactExportRow): Readonly<LoopArtifactExportRecord>;
