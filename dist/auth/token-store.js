import { readFileSync, writeFileSync, chmodSync, existsSync, rmSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from '../utils/config.js';
function getCredentialsPath() {
    return join(getConfigDir(), 'credentials.json');
}
/** Rename path to path+'.bak', removing any stale .bak first (Windows EPERM guard). */
function backupAndRemove(path) {
    const bak = path + '.bak';
    if (existsSync(bak))
        rmSync(bak, { force: true });
    renameSync(path, bak);
}
export async function loadCredentials() {
    const path = getCredentialsPath();
    if (!existsSync(path))
        return null;
    try {
        const raw = readFileSync(path, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.schemaVersion !== 1) {
            // 未知版本：备份后返回 null，触发重新登录
            backupAndRemove(path);
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
export async function saveCredentials(creds) {
    const dir = getConfigDir();
    mkdirSync(dir, { recursive: true });
    const path = getCredentialsPath();
    writeFileSync(path, JSON.stringify(creds, null, 2), 'utf-8');
    if (process.platform !== 'win32') {
        chmodSync(path, 0o600);
    }
}
export async function clearCredentials() {
    const path = getCredentialsPath();
    if (existsSync(path))
        rmSync(path);
}
