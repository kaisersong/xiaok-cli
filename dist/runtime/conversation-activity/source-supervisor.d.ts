export interface ActivityManagedSource {
    name: 'kswarm' | 'broker';
    executable: string;
    entryPath: string;
    cwd: string;
    env: Record<string, string>;
    healthUrl: string;
    healthHeaders?: Record<string, string>;
    args?: string[];
    expectedHealth: Record<string, string | number | boolean>;
}
export interface SourceReceipt {
    name: string;
    pid: number;
    birth: string;
    entryHash: string;
    ownerEpoch: string;
    external: boolean;
    instanceId?: string;
}
/** Supervision is independent of UI lifetime. No unknown PID is killed or
 * taken over; durable receipts bind process birth and exact entry identity. */
export declare class ActivitySourceSupervisor {
    private readonly root;
    readonly ownerEpoch: string;
    private readonly children;
    private readonly receipts;
    private readonly pending;
    constructor(root: string, ownerEpoch: string);
    private save;
    private healthy;
    private alive;
    ensure(source: ActivityManagedSource): Promise<SourceReceipt>;
    private ensureSource;
    protectedPid(pid: number): Promise<boolean>;
    stopOwned(name: string, expectedOwnerEpoch: string): Promise<void>;
}
