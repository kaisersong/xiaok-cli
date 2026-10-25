import { type createInstalledMaintenanceExecution } from './maintenance-execution.js';
import type { Database } from 'better-sqlite3';
import { type createControllerMaterialPipeline } from './material-pipeline.js';
import { type createDockerRunner } from '../isolated-execution/docker-runner.js';
import type { QuiescenceAuthority } from '../isolated-execution/physical-quiescence.js';
/** Host-only factual cleanup of an expired/retired staging copy. It cannot delete
 * original run archives or grant a semantic verdict. No public RPC is installed. */
export declare function createStagingFactualCleanup(input: {
    database: Database;
    materials: ReturnType<typeof createControllerMaterialPipeline>;
    raw: ReturnType<typeof createDockerRunner>;
    assertCurrent(): void;
} & ({
    quiescence: QuiescenceAuthority;
    ensureQualified(signal?: AbortSignal): Promise<void>;
} | {
    maintenance: ReturnType<typeof createInstalledMaintenanceExecution>;
})): Readonly<{
    assertCleanup: (resourceId: string) => void;
    sweepOnce: () => Promise<void>;
    startMaintenance(): void;
    getStatus(): Readonly<{
        started: boolean;
        running: boolean;
        lastOutcome: "deleted" | "idle" | "deferred";
        lastError: string | undefined;
    }>;
    cleanupResource(resourceId: string, signal?: AbortSignal): Promise<void>;
    close(): Promise<void>;
}>;
