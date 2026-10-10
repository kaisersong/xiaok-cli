export interface ActivityOwnerRetirementStatus {
    pid?: unknown;
    ownerEpoch?: unknown;
    rootHash?: unknown;
}
export type PendingTasks = 'none' | 'pending' | 'unknown';
export type OwnerRetirementOutcome = 'retired' | 'kept_pending' | 'kept_unknown' | 'kept_unverified';
export interface OwnerRetirementDependencies {
    readPendingTasks(dataRoot: string): Promise<PendingTasks>;
    platform: NodeJS.Platform;
    currentPid: number;
    currentUid: number | undefined;
    readStatusFile(path: string): Promise<ActivityOwnerRetirementStatus>;
    readCmdline(pid: number): Promise<string[] | string>;
    readUid(pid: number): Promise<number>;
    kill(pid: number, signal: 'SIGTERM'): void;
    isAlive(pid: number): Promise<boolean>;
    sleep(ms: number): Promise<void>;
}
/** Isolate synchronous SQLite work so even a blocked read has a hard deadline. */
export declare function readPendingTasks(dataRoot: string): Promise<PendingTasks>;
/** Retire only an authenticated, independently verified owner; never its children. */
export declare function retireOutdatedOwner(dataRoot: string, status: ActivityOwnerRetirementStatus, dependencies?: Partial<OwnerRetirementDependencies>): Promise<OwnerRetirementOutcome>;
