import type { ProfileSourceDirectory } from './profile-source-descriptor.js';
/** Ordinary host discovery only. No snapshot hash, completeness, quota grant,
 * custody or activation capability can be obtained from this registry. */
export type OrdinaryProfileSourceInput = {
    kind: 'session-root' | 'task-root' | 'goal-file-root' | 'session-alias-holder';
    directory: string;
} | {
    kind: 'sqlite-db';
    directory: string;
    databaseBasename: string;
    snapshotFormat: 'session-sqlite-v1' | 'loop-sqlite-v1' | 'goal-sqlite-v1' | 'codex-native-sqlite-v1' | 'codex-routes-sqlite-v1' | 'artifact-workspace-sqlite-v1' | 'kswarm-state-sqlite-v1' | 'multi-agent-groups-sqlite-v1';
};
export type OrdinarySQLiteComponent = 'loop' | 'completion' | 'artifactScanner' | 'healthScanner';
export interface OrdinarySQLiteLayout {
    readonly version: 1;
    readonly components: readonly OrdinarySQLiteComponent[];
    readonly layoutRevision: number;
    readonly layoutHash: string;
}
export interface OrdinarySQLiteComponentHistory {
    readonly historyUnknown: true;
    readonly components: readonly OrdinarySQLiteComponent[];
    readonly observations: readonly OrdinarySQLiteLayout[];
}
export interface OrdinaryProfileSource {
    readonly componentHistory?: Readonly<OrdinarySQLiteComponentHistory>;
    readonly sourceId: string;
    readonly namespaceId: string;
    readonly kind: OrdinaryProfileSourceInput['kind'];
    readonly directory: Readonly<ProfileSourceDirectory>;
    readonly snapshotFormat: string;
    readonly database?: Readonly<{
        basename: string;
        device: string;
        inode: string;
    }>;
}
export interface OrdinaryProfileSources {
    readonly version: 1 | 2;
    readonly uid: number;
    readonly generation: string;
    readonly legacyInventoryRequired: true;
    readonly sources: readonly Readonly<OrdinaryProfileSource>[];
}
export declare function parseOrdinaryProfileSources(raw: unknown, uid: number): Readonly<OrdinaryProfileSources>;
export declare function readOrdinaryProfileSources(): Readonly<OrdinaryProfileSources> | undefined;
export declare function registerOrdinaryProfileSource(input: OrdinaryProfileSourceInput): void;
/** Discovery observations only: these never clear legacy/unknown history or grant custody. */
export declare function registerOrdinarySQLiteLayout(input: Extract<OrdinaryProfileSourceInput, {
    kind: 'sqlite-db';
}>, layout: OrdinarySQLiteLayout, expectedPhysicalIdentity?: string): void;
