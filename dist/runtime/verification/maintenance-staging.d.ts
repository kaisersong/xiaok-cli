import { type InstalledControllerLifetime } from './installed-controller-lifetime.js';
import { type createInstalledRootBrokerClient } from './root-broker-client.js';
import { type createInstalledSharedCapacity } from './installed-shared-capacity.js';
import { type MaintenanceEngineAttachment } from './maintenance-engine-attachment.js';
import { type createInstalledMaintenanceExecution } from './maintenance-execution.js';
/** Host-only recovery of the original staging copy. No material authorization,
 * stage/read input, normal quiescence, or execution port escapes this facade. */
export declare function createInstalledMaintenanceStaging(input: {
    lifetime: InstalledControllerLifetime;
    broker: ReturnType<typeof createInstalledRootBrokerClient>;
    sharedCapacity: ReturnType<typeof createInstalledSharedCapacity>;
    attachment: MaintenanceEngineAttachment;
    execution: ReturnType<typeof createInstalledMaintenanceExecution>;
}): Readonly<{
    cleanupResource: (resourceId: string, signal?: AbortSignal) => Promise<void>;
    sweepOnce: () => Promise<void>;
    getStatus: () => Readonly<{
        started: boolean;
        running: boolean;
        lastOutcome: "deleted" | "idle" | "deferred";
        lastError: string | undefined;
    }>;
    close(): Promise<void>;
}>;
