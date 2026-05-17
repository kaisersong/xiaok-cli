import { spawnXiaokDaemonDetached, waitForXiaokDaemon } from '../daemon/launcher.js';
export async function spawnReminderDaemonDetached(socketPath) {
    await spawnXiaokDaemonDetached(socketPath);
}
export async function waitForReminderDaemon(socketPath, timeoutMs = 5_000) {
    await waitForXiaokDaemon(socketPath, timeoutMs);
}
