import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, realpathSync, readFileSync, openSync, writeFileSync, closeSync, statSync, fsyncSync, linkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const ACTIVITY_OWNER_PROTOCOL = 1;
export const ACTIVITY_REQUEST_BYTES = 256 * 1024;
export const ACTIVITY_RESPONSE_BYTES = 4 * 1024 * 1024;
export type ActivityClientRole = 'user' | 'producer';
export interface ActivityOwnerCredentials { version: 1; rootHash: string; user: string; producer: string }
export interface ActivityOwnerAddress { dataRoot: string; rootHash: string; socketPath: string; credentialsPath: string }

/** A new per-root protocol; never reuses the legacy reminder daemon socket. */
export function activityOwnerAddress(dataRoot: string): ActivityOwnerAddress {
  mkdirSync(dataRoot, { recursive: true }); dataRoot = realpathSync(dataRoot);
  const uid = process.getuid?.() ?? 'windows-user';
  const rootHash = createHash('sha256').update(`${uid}:${dataRoot}`).digest('hex');
  const socketDir = join(tmpdir(), `xa-${uid}-${rootHash.slice(0, 12)}`);
  if (process.platform !== 'win32') {
    mkdirSync(socketDir, { recursive: true, mode: 0o700 });
    const state = statSync(socketDir);
    if (state.uid !== uid || (state.mode & 0o077) !== 0) throw new Error('activity_socket_directory_not_private');
  }
  return { dataRoot, rootHash, credentialsPath: join(dataRoot, 'activity-owner.credentials.json'),
    socketPath: process.platform === 'win32' ? `\\\\.\\pipe\\xiaok-activity-${rootHash.slice(0, 24)}` : join(socketDir, 's') };
}

export function readActivityOwnerCredentials(address: ActivityOwnerAddress): ActivityOwnerCredentials {
  const state = statSync(address.credentialsPath);
  if (state.size > 4096 || process.platform !== 'win32' && (state.uid !== process.getuid?.() || (state.mode & 0o077) !== 0)) throw new Error('activity_credentials_not_private');
  const value = JSON.parse(readFileSync(address.credentialsPath, 'utf8')) as ActivityOwnerCredentials;
  if (value.version !== 1 || value.rootHash !== address.rootHash || !/^[a-f0-9]{64}$/.test(value.user) || !/^[a-f0-9]{64}$/.test(value.producer)) throw new Error('invalid_activity_credentials');
  return value;
}

/** Only initial bootstrap creates credentials. Existing tokens never rotate
 * silently and are never overwritten by a competing startup. */
export function createActivityOwnerCredentials(address: ActivityOwnerAddress): ActivityOwnerCredentials {
  const temporary = `${address.credentialsPath}.${randomBytes(12).toString('hex')}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  const value: ActivityOwnerCredentials = { version: 1, rootHash: address.rootHash, user: randomBytes(32).toString('hex'), producer: randomBytes(32).toString('hex') };
  try {
    writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd);
  } finally { closeSync(fd); }
  try { linkSync(temporary, address.credentialsPath); return value; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return readActivityOwnerCredentials(address); throw error; }
  finally { unlinkSync(temporary); }
}

export function authenticateActivityClient(credentials: ActivityOwnerCredentials, hello: unknown): ActivityClientRole {
  if (!hello || typeof hello !== 'object' || Array.isArray(hello)) throw new Error('activity_authentication_failed');
  const value = hello as Record<string, unknown>;
  if (Object.keys(value).some(key => !['type','protocol','rootHash','role','token','instanceId'].includes(key)) || value.type !== 'hello'
    || value.protocol !== ACTIVITY_OWNER_PROTOCOL || value.rootHash !== credentials.rootHash || !['user','producer'].includes(String(value.role))
    || typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token)
    || value.instanceId !== undefined && (typeof value.instanceId !== 'string' || value.instanceId.length > 256 || !value.instanceId)) throw new Error('activity_authentication_failed');
  const role = value.role as ActivityClientRole;
  if (!timingSafeEqual(Buffer.from(value.token, 'hex'), Buffer.from(credentials[role], 'hex'))) throw new Error('activity_authentication_failed');
  return role;
}
