import { readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { ACTIVITY_STORAGE_NAMES } from './storage-permissions.js';

export interface ActivityOwnerRetirementStatus { pid?: unknown; ownerEpoch?: unknown; rootHash?: unknown }
export interface OwnerRetirementDependencies {
  platform: NodeJS.Platform; currentPid: number; currentUid: number | undefined;
  readStatusFile(path: string): Promise<ActivityOwnerRetirementStatus>;
  readCmdline(pid: number): Promise<string[] | string>;
  readUid(pid: number): Promise<number>;
  kill(pid: number, signal: 'SIGTERM'): void;
  isAlive(pid: number): Promise<boolean>;
  sleep(ms: number): Promise<void>;
}
const execute = promisify(execFile);
const ps = async (pid: number, field: string) => (await execute('ps', ['-p', String(pid), '-o', `${field}=`], { timeout: 1000, maxBuffer: 256 * 1024 })).stdout.trim();
function defaults(): OwnerRetirementDependencies {
  return {
    platform: process.platform, currentPid: process.pid, currentUid: process.getuid?.(),
    readStatusFile: async path => JSON.parse(await readFile(path, 'utf8')) as ActivityOwnerRetirementStatus,
    readCmdline: async pid => process.platform === 'linux' ? (await readFile(join('/proc', String(pid), 'cmdline'), 'utf8')).split('\0').filter(Boolean) : ps(pid, 'command'),
    readUid: async pid => {
      if (process.platform === 'linux') return (await stat(join('/proc', String(pid)))).uid;
      const uid = await ps(pid, 'uid');
      return /^\d+$/.test(uid) ? Number(uid) : NaN;
    },
    kill: (pid, signal) => { process.kill(pid, signal); },
    isAlive: async pid => { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; } },
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  };
}
function matchesCommand(command: string[] | string, configPath: string): boolean {
  if (Array.isArray(command)) return command.some(arg => arg.includes('owner-entry')) && command.includes(configPath);
  // ps renders argv as a single string; require complete argument boundaries.
  const escaped = configPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return command.includes('owner-entry') && new RegExp(`(?:^|\\s)(?:${escaped}|"${escaped}"|'${escaped}')(?:\\s|$)`).test(command);
}
/** Retire only an authenticated, independently verified owner; never its children. */
export async function retireOutdatedOwner(dataRoot: string, status: ActivityOwnerRetirementStatus, dependencies: Partial<OwnerRetirementDependencies> = {}): Promise<boolean> {
  const deps = { ...defaults(), ...dependencies };
  if (!['linux', 'darwin'].includes(deps.platform)) return false;
  const pid = status.pid;
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0 || pid === deps.currentPid
    || typeof status.ownerEpoch !== 'string' || !status.ownerEpoch || typeof status.rootHash !== 'string' || !status.rootHash
    || !Number.isSafeInteger(deps.currentUid)) return false;
  try {
    const disk = await deps.readStatusFile(join(dataRoot, ACTIVITY_STORAGE_NAMES.status));
    if (disk.pid !== pid || disk.ownerEpoch !== status.ownerEpoch || disk.rootHash !== status.rootHash) return false;
    if (!matchesCommand(await deps.readCmdline(pid), join(dataRoot, ACTIVITY_STORAGE_NAMES.config))) return false;
    if (await deps.readUid(pid) !== deps.currentUid) return false;
    try { deps.kill(pid, 'SIGTERM'); } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
    for (let elapsed = 0; elapsed < 3000; elapsed += 50) {
      if (!await deps.isAlive(pid)) return true;
      await deps.sleep(50);
    }
    return !await deps.isAlive(pid);
  } catch { return false; }
}
