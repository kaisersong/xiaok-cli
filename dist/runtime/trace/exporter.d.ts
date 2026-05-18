import { type TraceBundleV1 } from './schema.js';
import type { TaskSnapshot } from '../task-host/types.js';
export interface TraceExportOptions {
    now?: () => Date;
    version?: string;
    command?: string;
}
export declare function loadTaskSnapshotsForSession(input: {
    dataRoot: string;
    sessionId: string;
}): TaskSnapshot[];
export declare function buildSessionTraceBundleFromSnapshots(snapshots: TaskSnapshot[], input: {
    sessionId: string;
    dataRoot?: string;
} & TraceExportOptions): TraceBundleV1;
export declare function buildProjectTraceBundleFromKSwarmDetail(detail: unknown, input: {
    projectId: string;
} & TraceExportOptions): TraceBundleV1;
export declare function writeTraceBundleToPath(input: {
    bundle: TraceBundleV1;
    outputPath: string;
    force?: boolean;
}): string;
