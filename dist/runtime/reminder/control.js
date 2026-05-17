import { queryXiaokDaemonStatus, stopXiaokDaemon } from '../daemon/control.js';
export async function queryReminderDaemonStatus(socketPath) {
    return await queryXiaokDaemonStatus(socketPath);
}
export async function stopReminderDaemon(socketPath) {
    return await stopXiaokDaemon(socketPath);
}
