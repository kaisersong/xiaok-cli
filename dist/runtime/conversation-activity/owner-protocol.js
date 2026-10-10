import { chmodPrivateActivityFile } from './storage-permissions.js';
import { ACTIVITY_STORAGE_NAMES } from './storage-permissions.js';
import { createPrivateActivityDirectory } from './storage-permissions.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, realpathSync, readFileSync, openSync, writeFileSync, closeSync, statSync, fsyncSync, linkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
export const ACTIVITY_OWNER_PROTOCOL = 1;
export const ACTIVITY_OWNER_GENERATION = 2;
export const ACTIVITY_REQUEST_BYTES = 256 * 1024;
export const ACTIVITY_RESPONSE_BYTES = 4 * 1024 * 1024;
/** A new per-root protocol; never reuses the legacy reminder daemon socket. */
export function activityOwnerAddress(dataRoot) {
    createPrivateActivityDirectory(dataRoot);
    dataRoot = realpathSync(dataRoot);
    const uid = process.getuid?.() ?? 'windows-user';
    const rootHash = createHash('sha256').update(`${uid}:${dataRoot}`).digest('hex');
    const socketDir = join(tmpdir(), `xa-${uid}-${rootHash.slice(0, 12)}`);
    if (process.platform !== 'win32') {
        try {
            mkdirSync(socketDir, { mode: 0o700 });
            chmodSync(socketDir, 0o700);
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
        }
        const state = lstatSync(socketDir);
        if (!state.isDirectory() || state.isSymbolicLink() || state.uid !== uid || (state.mode & 0o077) !== 0)
            throw new Error('activity_socket_directory_not_private');
    }
    return { dataRoot, rootHash, credentialsPath: join(dataRoot, ACTIVITY_STORAGE_NAMES.credentials),
        socketPath: process.platform === 'win32' ? `\\\\.\\pipe\\xiaok-activity-${rootHash.slice(0, 24)}` : join(socketDir, 's') };
}
export function readActivityOwnerCredentials(address) {
    const state = statSync(address.credentialsPath);
    if (state.size > 4096 || process.platform !== 'win32' && (state.uid !== process.getuid?.() || (state.mode & 0o077) !== 0))
        throw new Error('activity_credentials_not_private');
    const value = JSON.parse(readFileSync(address.credentialsPath, 'utf8'));
    if (value.version !== 1 || value.rootHash !== address.rootHash || !/^[a-f0-9]{64}$/.test(value.user) || !/^[a-f0-9]{64}$/.test(value.producer))
        throw new Error('invalid_activity_credentials');
    return value;
}
/** Only initial bootstrap creates credentials. Existing tokens never rotate
 * silently and are never overwritten by a competing startup. */
export function createActivityOwnerCredentials(address) {
    const temporary = `${address.credentialsPath}.${randomBytes(12).toString('hex')}.tmp`;
    const fd = openSync(temporary, 'wx', 0o600);
    const value = { version: 1, rootHash: address.rootHash, user: randomBytes(32).toString('hex'), producer: randomBytes(32).toString('hex') };
    try {
        chmodPrivateActivityFile(temporary);
        writeFileSync(fd, JSON.stringify(value));
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
    try {
        linkSync(temporary, address.credentialsPath);
        return value;
    }
    catch (error) {
        if (error.code === 'EEXIST')
            return readActivityOwnerCredentials(address);
        throw error;
    }
    finally {
        unlinkSync(temporary);
    }
}
export function authenticateActivityClient(credentials, hello) {
    if (!hello || typeof hello !== 'object' || Array.isArray(hello))
        throw new Error('activity_authentication_failed');
    const value = hello;
    if (Object.keys(value).some(key => !['type', 'protocol', 'rootHash', 'role', 'token', 'instanceId'].includes(key)) || value.type !== 'hello'
        || value.protocol !== ACTIVITY_OWNER_PROTOCOL || value.rootHash !== credentials.rootHash || !['user', 'producer'].includes(String(value.role))
        || typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token)
        || value.instanceId !== undefined && (typeof value.instanceId !== 'string' || value.instanceId.length > 256 || !value.instanceId))
        throw new Error('activity_authentication_failed');
    const role = value.role;
    if (!timingSafeEqual(Buffer.from(value.token, 'hex'), Buffer.from(credentials[role], 'hex')))
        throw new Error('activity_authentication_failed');
    return role;
}
