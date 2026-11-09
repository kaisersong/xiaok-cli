import { DatabaseSync } from 'node:sqlite';
import {
  constants, existsSync, fstatSync, lstatSync, mkdtempSync, openSync,
  closeSync, readSync, writeSync, rmSync, type BigIntStats,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { versions } from 'node:process';

type RetainedConstruction = Readonly<{ data?: DatabaseSync; owner?: DatabaseSync }>;
interface SnapshotRoot {
  data?: DatabaseSync;
  owner?: DatabaseSync;
  sourceFd?: number;
  copyFd?: number;
  directory?: string;
  unknown: boolean;
}
type FirstFailure = { present: boolean; error: unknown };

// Node enabled SQLITE_OPEN_URI in 22.15.0 and 23.10.0. Keep the existing
// immutable reader on those versions and newer; never infer support from an
// attempted open of a user's database.
export function activitySqliteNeedsOfflineCopy(node: string): boolean {
  const match = /^(\d+)\.(\d+)\./.exec(node);
  if (!match) throw Error('conversation_activity_readonly_runtime_unsupported');
  const major = Number(match[1]), minor = Number(match[2]);
  return major < 22 || (major === 22 && minor < 15) || (major === 23 && minor < 10);
}
export const activityReadonlyNeedsSnapshot = activitySqliteNeedsOfflineCopy(versions.node);

function unchanged(a: BigIntStats, b: BigIntStats): boolean {
  return a.isFile() && b.isFile() && a.nlink === 1n && b.nlink === 1n
    && a.dev === b.dev && a.ino === b.ino && a.size === b.size
    && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
function noSidecars(file: string): void {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (existsSync(file + suffix)) throw Error('conversation_activity_readonly_snapshot_changed');
  }
}
function originalEmptyOwner(file: string): BigIntStats {
  if (!existsSync(file)) throw Error('conversation_activity_readonly_owner_unproved');
  // Known absence/invalid metadata is a logical denial. A thrown metadata SDK
  // value is the original construction failure, including thrown undefined.
  const stat = lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n || stat.size !== 0n) {
    throw Error('conversation_activity_readonly_owner_unproved');
  }
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (existsSync(file + suffix)) throw Error('conversation_activity_readonly_owner_unproved');
  }
  return stat;
}

/**
 * Compatibility for the existing single-writer ActivityStore only. Its writer
 * never writes pages to the empty DELETE owner database and holds EXCLUSIVE
 * before opening the data database. This does not certify older/external writers
 * or filesystem replacement against the same user.
 *
 * Never raw-open/close the owner: a separate POSIX close can cancel SQLite's
 * locks held by another connection in this same process. SQLite manages all
 * owner handles. The source FD is born only after the actual SHARED read lock.
 */
export function createActivityReadonlySnapshot(
  file: string,
  maximumBytes: number,
  retained: Set<RetainedConstruction>,
  reportCleanup: () => void,
): Readonly<{ db: DatabaseSync; close(): void }> {
  const root: SnapshotRoot = { unknown: false };
  retained.add(root); // Before the first SDK invocation, not after its return.
  const failure: { first: FirstFailure } = { first: { present: false, error: undefined } };
  const fail = (error: unknown) => {
    if (!failure.first.present) failure.first = { present: true, error };

  };
  const unknown = (error: unknown) => {
    root.unknown = true; fail(error);
    try { reportCleanup(); } catch { /* Diagnostics cannot replace the first error. */ }
  };
  const removeDirectory = () => {
    if (root.unknown) return;
    if (root.directory !== undefined) {
      try { rmSync(root.directory, { recursive: true }); root.directory = undefined; }
      catch (error) { unknown(error); }
    }
    if (!root.unknown) retained.delete(root);
  };
  try {
    const ownerFile = file + '.owner.sqlite';
    const beforeOwner = originalEmptyOwner(ownerFile);
    try { root.owner = new DatabaseSync(ownerFile, { readOnly: true }); }
    catch (error) { root.unknown = true; throw error; }
    root.owner.exec('PRAGMA busy_timeout=0; BEGIN; SELECT name FROM sqlite_schema');
    if (!unchanged(beforeOwner, originalEmptyOwner(ownerFile))) {
      throw Error('conversation_activity_readonly_snapshot_changed');
    }
    noSidecars(file);
    const before = lstatSync(file, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 100n || before.size > BigInt(maximumBytes)) {
      throw Error('conversation_activity_readonly_snapshot_invalid');
    }
    const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
    try { root.sourceFd = openSync(file, flags); }
    catch (error) { root.unknown = true; throw error; }
    if (!unchanged(before, fstatSync(root.sourceFd, { bigint: true }))) {
      throw Error('conversation_activity_readonly_snapshot_changed');
    }
    const header = Buffer.alloc(100);
    if (readSync(root.sourceFd, header, 0, 100, 0) !== 100
      || header.subarray(0, 16).toString('binary') !== 'SQLite format 3\0'
      || !((header[18] === 1 && header[19] === 1) || (header[18] === 2 && header[19] === 2))) {
      throw Error('conversation_activity_readonly_snapshot_invalid');
    }
    // mkdtemp creates a new private directory, without chmod of any shared root.
    try { root.directory = mkdtempSync(join(tmpdir(), 'xiaok-activity-readonly-')); }
    catch (error) { root.unknown = true; throw error; }
    const destination = join(root.directory, 'activity.sqlite');
    try { root.copyFd = openSync(destination, 'wx+', 0o600); }
    catch (error) { root.unknown = true; throw error; }
    const buffer = Buffer.alloc(64 * 1024), size = Number(before.size);
    const sourceHash = createHash('sha256');
    const readHash = (copy: boolean, fd = root.sourceFd!): string => {
      const hash = copy ? sourceHash : createHash('sha256');
      for (let position = 0; position < size;) {
        const wanted = Math.min(buffer.length, size - position);
        const count = readSync(fd, buffer, 0, wanted, position);
        if (!Number.isSafeInteger(count) || count <= 0 || count > wanted) {
          throw Error('conversation_activity_readonly_snapshot_changed');
        }
        hash.update(buffer.subarray(0, count));
        if (copy) for (let written = 0; written < count;) {
          const n = writeSync(root.copyFd!, buffer, written, count - written, position + written);
          if (!Number.isSafeInteger(n) || n <= 0 || n > count - written) {
            throw Error('conversation_activity_readonly_snapshot_write_failed');
          }
          written += n;
        }
        position += count;
      }
      return hash.digest('hex');
    };
    const copiedHash = readHash(true);
    if (copiedHash !== readHash(false) || copiedHash !== readHash(false, root.copyFd)
      || !unchanged(before, fstatSync(root.sourceFd, { bigint: true }))
      || !unchanged(before, lstatSync(file, { bigint: true }))
      || fstatSync(root.copyFd, { bigint: true }).size !== before.size
      || !unchanged(beforeOwner, originalEmptyOwner(ownerFile))) {
      throw Error('conversation_activity_readonly_snapshot_changed');
    }
    noSidecars(file);
  } catch (error) { fail(error); }

  // Independent resources: a close failure is unknown, never an instruction to
  // skip the other entered resources or to delete a possibly-held directory.
  for (const key of ['sourceFd', 'copyFd'] as const) {
    const fd = root[key];
    if (fd !== undefined) {
      try { closeSync(fd); root[key] = undefined; } catch (error) { unknown(error); }
    }
  }
  if (root.owner !== undefined) {
    try { root.owner.close(); root.owner = undefined; } catch (error) { unknown(error); }
  }
  if (failure.first.present) { removeDirectory(); throw failure.first.error; }
  // No data SQLite connection exists until the source/fence closes are known.
  try { root.data = new DatabaseSync(join(root.directory!, 'activity.sqlite'), { readOnly: true }); }
  catch (error) {
    // A constructor throw supplies no handle/physical-close acknowledgement.
    root.unknown = true; throw error;
  }
  const db = root.data;
  let closeAttempted = false;
  return Object.freeze({ db, close() {
    if (closeAttempted) {
      if (root.unknown) throw Error('conversation_activity_readonly_close_unconfirmed');
      return;
    }
    closeAttempted = true;
    failure.first = { present: false, error: undefined };
    try { db.close(); root.data = undefined; } catch (error) { unknown(error); }
    removeDirectory();
    if (failure.first.present) throw failure.first.error;
  } });
}
