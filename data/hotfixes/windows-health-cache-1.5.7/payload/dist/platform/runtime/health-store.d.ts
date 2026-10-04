import type { PlatformCapabilityHealth } from './context.js';
export interface CapabilityHealthSnapshot {
    updatedAt: number;
    summary: string;
    capabilities: PlatformCapabilityHealth[];
}
export declare class FileCapabilityHealthStore {
    private readonly filePath;
    private readonly entries;
    constructor(filePath: string);
    get(cwd: string): CapabilityHealthSnapshot | undefined;
    /** Updates live state even when the optional disk cache cannot be saved. */
    set(cwd: string, snapshot: CapabilityHealthSnapshot): boolean;
    private load;
    private persist;
}
