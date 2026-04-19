import type { XiaokDaemonStatus } from '../daemon/host.js';
import { queryXiaokDaemonStatus, stopXiaokDaemon } from '../daemon/control.js';

export type ReminderDaemonStatus = XiaokDaemonStatus;

export async function queryReminderDaemonStatus(socketPath: string): Promise<ReminderDaemonStatus | null> {
  return await queryXiaokDaemonStatus(socketPath);
}

export async function stopReminderDaemon(socketPath: string): Promise<boolean> {
  return await stopXiaokDaemon(socketPath);
}
