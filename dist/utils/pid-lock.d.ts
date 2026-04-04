/**
 * Lightweight pidfile-based singleton lock for long-running processes.
 * Ensures only one instance of a service (e.g. yzj serve) runs at a time.
 */
export declare class PidLock {
    private readonly pidFile;
    constructor(pidFile: string);
    /**
     * Try to acquire the lock. Returns true if acquired, false if another
     * live process holds it.
     */
    acquire(): {
        acquired: boolean;
        existingPid?: number;
    };
    release(): void;
    private isProcessAlive;
}
