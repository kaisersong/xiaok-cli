import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
export const XIAOK_DAEMON_PROTOCOL_VERSION = 1;
export function createXiaokDaemonRpcId() {
    return randomUUID();
}
export function resolveXiaokDaemonSocketPath(label) {
    const base = label ?? `${os.userInfo().username}:${os.homedir()}`;
    const id = createHash('sha256').update(base).digest('hex').slice(0, 16);
    if (process.platform === 'win32') {
        return `\\\\.\\pipe\\xiaok-daemon-${id}`;
    }
    return path.join(os.tmpdir(), `xiaok-daemon-${id}.sock`);
}
