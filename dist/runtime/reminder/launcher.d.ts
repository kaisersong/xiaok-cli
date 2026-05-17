export declare function spawnReminderDaemonDetached(socketPath: string): Promise<void>;
export declare function waitForReminderDaemon(socketPath: string, timeoutMs?: number): Promise<void>;
