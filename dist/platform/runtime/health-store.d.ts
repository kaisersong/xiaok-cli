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
    set(cwd: string, snapshot: CapabilityHealthSnapshot): void;
    private load;
    private persist;
}
