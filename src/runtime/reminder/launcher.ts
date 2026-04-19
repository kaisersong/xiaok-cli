import { spawnXiaokDaemonDetached, waitForXiaokDaemon } from '../daemon/launcher.js';

export async function spawnReminderDaemonDetached(socketPath: string): Promise<void> {
  await spawnXiaokDaemonDetached(socketPath);
}

export async function waitForReminderDaemon(socketPath: string, timeoutMs = 5_000): Promise<void> {
  await waitForXiaokDaemon(socketPath, timeoutMs);
}
