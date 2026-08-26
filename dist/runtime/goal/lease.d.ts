export declare class GoalSessionLease {
    private readonly options;
    private acquired;
    private readonly now;
    private readonly pid;
    private readonly leaseTimeoutMs;
    private readonly isAlive;
    private readonly path;
    constructor(options: {
        rootDir: string;
        sessionId: string;
        instanceId: string;
        pid?: number;
        now?: () => number;
        leaseTimeoutMs?: number;
        isProcessAlive?: (pid: number) => boolean;
    });
    acquire(input?: {
        recoverExpired?: boolean;
    }): void;
    heartbeat(): void;
    assertOwned(): void;
    release(): void;
    private create;
    private read;
}
