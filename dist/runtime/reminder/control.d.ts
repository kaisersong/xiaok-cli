import type { XiaokDaemonStatus } from '../daemon/host.js';
export type ReminderDaemonStatus = XiaokDaemonStatus;
export declare function queryReminderDaemonStatus(socketPath: string): Promise<ReminderDaemonStatus | null>;
export declare function stopReminderDaemon(socketPath: string): Promise<boolean>;
