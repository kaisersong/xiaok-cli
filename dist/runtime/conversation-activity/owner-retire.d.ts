export interface ActivityOwnerRetirementStatus {
    pid?: unknown;
    ownerEpoch?: unknown;
    rootHash?: unknown;
}
export interface OwnerRetirementDependencies {
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
/** Retire only an authenticated, independently verified owner; never its children. */
export declare function retireOutdatedOwner(dataRoot: string, status: ActivityOwnerRetirementStatus, dependencies?: Partial<OwnerRetirementDependencies>): Promise<boolean>;
