import type { CapturedSqliteCell } from './source-sqlite-cell.js';
import type { ArtifactWorkspaceQueryId } from './artifact-workspace-source-schema.js';
export type Domain = 'conversation' | 'workspace-root' | 'workspace' | 'node' | 'lineage' | 'version' | 'generation-request' | 'task' | 'artifact' | 'evidence' | 'agent' | 'external-task' | 'version-file-ref' | 'package-entry-ref' | 'package-manifest-ref' | 'staging-file-ref' | 'staging' | 'request-correlation' | 'actor-user' | 'actor-agent' | 'actor-scheduler' | 'actor-system-reconcile';
export interface ArtifactWorkspaceReference {
    readonly column: string;
    readonly domain: Domain;
    readonly targetTable?: ArtifactWorkspaceQueryId;
    readonly value: CapturedSqliteCell;
    readonly relation: 'foreign-key' | 'declared';
    readonly referenceState: 'declared' | 'uninterpreted';
}
export type ArtifactWorkspaceMetadata = Readonly<{
    classification: 'scalar-map';
    value: Readonly<Record<string, string | number | boolean | null>>;
} | {
    classification: 'uninterpreted-json';
    raw: string;
}>;
export type ArtifactWorkspaceCounts = Readonly<Record<ArtifactWorkspaceQueryId, number>>;
export interface ArtifactWorkspaceSourceSummary {
    readonly sourceId: string;
    readonly snapshotHash: string;
    readonly counts: ArtifactWorkspaceCounts;
}
export type ArtifactWorkspaceSourceEvent = Readonly<{
    kind: 'source-start';
    sourceId: string;
    snapshotHash: string;
    format: 'artifact-workspace-sqlite-v1';
}> | Readonly<{
    kind: 'row';
    sourceId: string;
    table: ArtifactWorkspaceQueryId;
    rowid: string;
    record: Readonly<Record<string, CapturedSqliteCell>>;
    parsedMetadata: ArtifactWorkspaceMetadata | null;
    references: readonly Readonly<ArtifactWorkspaceReference>[];
}> | Readonly<{
    kind: 'source-end';
    sourceId: string;
    counts: ArtifactWorkspaceCounts;
}> | Readonly<{
    kind: 'complete';
    sources: readonly Readonly<ArtifactWorkspaceSourceSummary>[];
    digest: string;
}>;
