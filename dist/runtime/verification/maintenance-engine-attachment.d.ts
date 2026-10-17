import { type InstalledControllerLifetime } from './installed-controller-lifetime.js';
declare const attachmentBrand: unique symbol;
export interface MaintenanceEngineAttachment {
    readonly [attachmentBrand]: true;
    inspect(): Promise<void>;
    close(): Promise<void>;
}
type Facts = Readonly<{
    hostSocket: string;
    imageDigest: string;
    engineBinding: Readonly<{
        engineId: string;
        incarnation: string;
        epoch: 1;
    }>;
}>;
export declare function readMaintenanceEngineAttachment(handle: MaintenanceEngineAttachment, lifetime: InstalledControllerLifetime): Facts;
/** Fixed, read-only attachment. No normal installed-engine registration is made,
 * and no create/start/load/qualification port is reachable from this factory. */
export declare function attachInstalledMacEngineForMaintenance(input: {
    lifetime: InstalledControllerLifetime;
    signal?: AbortSignal;
}): Promise<MaintenanceEngineAttachment>;
export {};
