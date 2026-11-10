import { randomBytes } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, fchmodSync, lstatSync, readSync, writeFileSync, fsyncSync, linkSync, unlinkSync, type BigIntStats } from 'node:fs';
import { join } from 'node:path';
import type { ActivityOwnerAddress } from './owner-protocol.js';
import { ACTIVITY_STORAGE_NAMES } from './storage-permissions.js';

export type NativeSourceCredential = Readonly<{ version: 1; rootHash: string; token: string }>;
export const nativeSourceCredentialPath = (address: ActivityOwnerAddress): string => join(address.dataRoot, ACTIVITY_STORAGE_NAMES.nativeSourceCredential);
function supported(): void {
  // Windows needs an actual private ACL/reparse-point qualification. Ordinary
  // activity remains available; POSIX mode bits are not that qualification.
  if (process.platform === 'win32') throw Error('activity_native_source_credentials_platform_unsupported');
}
function verifyFile(state: BigIntStats): void {
  if (!state.isFile() || state.isSymbolicLink() || state.uid !== BigInt(process.getuid?.() ?? -1)
    || (state.mode & 0o077n) !== 0n || state.nlink !== 1n || state.size > 4096n) throw Error('activity_native_source_credentials_not_private');
}
const sameFile = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino;

/** Main reads only this independent, fixed private-root credential. */
export function readNativeSourceCredential(address: ActivityOwnerAddress): NativeSourceCredential {
  supported();
  const path = nativeSourceCredentialPath(address), before = lstatSync(path, { bigint: true }); verifyFile(before);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let result: NativeSourceCredential | undefined, primary: unknown;
  try {
    const opened = fstatSync(fd, { bigint: true }); verifyFile(opened);
    if (!sameFile(before, opened)) throw Error('activity_native_source_credentials_changed');
    const buffer = Buffer.alloc(4097); let count = 0;
    while (count < buffer.length) { const size = readSync(fd, buffer, count, buffer.length - count, count); if (!size) break; count += size; }
    if (count > 4096) throw Error('activity_native_source_credentials_invalid');
    const after = fstatSync(fd, { bigint: true }), current = lstatSync(path, { bigint: true }); verifyFile(after); verifyFile(current);
    if (!sameFile(opened, after) || !sameFile(after, current) || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) throw Error('activity_native_source_credentials_changed');
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count))); }
    catch { throw Error('activity_native_source_credentials_invalid'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('activity_native_source_credentials_invalid');
    const data = value as Record<string, unknown>;
    if (Object.keys(data).sort().join(',') !== 'rootHash,token,version' || data.version !== 1 || data.rootHash !== address.rootHash || typeof data.token !== 'string' || !/^[a-f0-9]{64}$/.test(data.token)) throw Error('activity_native_source_credentials_invalid');
    result = Object.freeze({ version: 1, rootHash: address.rootHash, token: data.token });
  } catch (error) { primary = error; }
  try { closeSync(fd); } catch (error) { if (primary !== undefined) throw new AggregateError([primary, error], 'activity_native_source_credentials_close_failed'); throw error; }
  if (primary !== undefined) throw primary;
  return result!;
}

/** Only the original host, after acquiring its original writer lock, creates
 * this file. Existing user/producer credentials and Native tokens never rotate. */
export function createNativeSourceCredential(address: ActivityOwnerAddress): NativeSourceCredential {
  supported();
  const path = nativeSourceCredentialPath(address);
  try { lstatSync(path); return readNativeSourceCredential(address); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temporary = `${path}.${randomBytes(12).toString('hex')}.tmp`;
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const value = Object.freeze({ version: 1 as const, rootHash: address.rootHash, token: randomBytes(32).toString('hex') });
  let primary: unknown, result: NativeSourceCredential | undefined;
  try { fchmodSync(fd, 0o600); writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } catch (error) { primary = error; }
  try { closeSync(fd); } catch (error) { primary = primary === undefined ? error : new AggregateError([primary, error], 'activity_native_source_credentials_close_failed'); }
  if (primary === undefined) try { linkSync(temporary, path); result = value; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      try { result = readNativeSourceCredential(address); } catch (readError) { primary = readError; }
    } else primary = error;
  }
  try { unlinkSync(temporary); } catch (error) { primary = primary === undefined ? error : new AggregateError([primary, error], 'activity_native_source_credentials_cleanup_failed'); }
  if (primary !== undefined) throw primary;
  return result!;
}
