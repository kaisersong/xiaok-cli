import { type InstalledControllerLifetime } from './installed-controller-lifetime.js';
import { type createInstalledRootBrokerClient } from './root-broker-client.js';
import { type createInstalledSharedCapacity } from './installed-shared-capacity.js';
import { type MaintenanceEngineAttachment } from './maintenance-engine-attachment.js';
import { type createInstalledMaintenanceExecution } from './maintenance-execution.js';
export declare function assertMaintenanceStagingConstruction(value: object, materials: object, construction: object, database: import('better-sqlite3').Database): void;
export declare function activateInstalledMaintenanceStaging(value: object, construction: object): void;
export declare function createInstalledMaintenanceStaging(input: {
    lifetime: InstalledControllerLifetime;
    broker: ReturnType<typeof createInstalledRootBrokerClient>;
    sharedCapacity: ReturnType<typeof createInstalledSharedCapacity>;
    attachment: MaintenanceEngineAttachment;
    execution: ReturnType<typeof createInstalledMaintenanceExecution>;
    construction?: object;
}): Readonly<{
    cleanupResource(resourceId: string, signal?: AbortSignal): Promise<void>;
    sweepOnce(): Promise<void>;
    getStatus(): Readonly<{
        started: boolean;
        running: boolean;
        lastOutcome: "deleted" | "idle" | "deferred";
        lastError: string | undefined;
    }>;
    close(): Promise<void>;
}>;
