import type { XiaokDaemonStatus } from './host.js';
export declare function queryXiaokDaemonStatus(socketPath: string): Promise<XiaokDaemonStatus | null>;
export declare function stopXiaokDaemon(socketPath: string): Promise<boolean>;
