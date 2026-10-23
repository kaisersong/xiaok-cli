import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { lstatSync, readFileSync, existsSync, unlinkSync, openSync, closeSync, writeFileSync, fsyncSync, linkSync } from 'node:fs';
const requireOptional = createRequire(import.meta.url);
interface SaveLockMarker { version: 1; pid: number; hostname: string; nonce: string }
function readSaveLock(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2048) throw new Error('session_save_locked');
  const bytes = readFileSync(path, 'utf8');
  const marker = JSON.parse(bytes) as SaveLockMarker;
  if (!marker || Object.keys(marker).sort().join(',') !== 'hostname,nonce,pid,version'
    || marker.version !== 1 || !Number.isSafeInteger(marker.pid) || marker.pid < 1
    || marker.hostname !== hostname() || typeof marker.nonce !== 'string'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(marker.nonce)) throw new Error('session_save_locked');
  return { stat, bytes, marker };
}
function clearDeadSaveLock(path: string) {
  // Optional only for stale-lock recovery. Fresh ordinary saves remain pure JS.
  let database: import('better-sqlite3').Database | undefined;
  try {
    const Database = requireOptional('better-sqlite3') as typeof import('better-sqlite3');
    const cleanupPath = `${path}.cleanup.sqlite`;
    if (existsSync(cleanupPath) && lstatSync(cleanupPath).isSymbolicLink()) throw new Error('session_save_locked');
    database = new Database(cleanupPath, { timeout: 0 }); database.exec('BEGIN EXCLUSIVE');
    const previous = readSaveLock(path);
    try { process.kill(previous.marker.pid, 0); throw new Error('session_save_locked'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    const current = readSaveLock(path);
    if (current.stat.ino !== previous.stat.ino || current.stat.dev !== previous.stat.dev || current.bytes !== previous.bytes) throw new Error('session_save_locked');
    unlinkSync(path);
  } finally { database?.close(); }
}
export function acquireSaveLock(path: string): () => void {
  const nonce = randomUUID(); const temp = `${path}.${nonce}.tmp`;
  const marker: SaveLockMarker = { version: 1, pid: process.pid, hostname: hostname(), nonce };
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temp, 'wx', 0o600);
    writeFileSync(descriptor, JSON.stringify(marker), 'utf8'); fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
    try { linkSync(temp, path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try { clearDeadSaveLock(path); }
      catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') throw cleanupError;
      }
      try { linkSync(temp, path); }
      catch (retryError) {
        if ((retryError as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('session_save_locked');
        throw retryError;
      }
    }
    const owned = readSaveLock(path);
    return () => {
      // Never unlink a replacement lock, including after a failed save.
      if (!existsSync(path)) return;
      const current = readSaveLock(path);
      if (current.marker.nonce === nonce && current.stat.ino === owned.stat.ino && current.stat.dev === owned.stat.dev && current.bytes === owned.bytes) unlinkSync(path);
    };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temp)) unlinkSync(temp);
  }
}
