import { lstatSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function assertNoAdditionalAcl(path: string): void {
  if (process.platform !== 'darwin') return;
  const result = spawnSync('/bin/ls', ['-lde', path], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, timeout: 5000, maxBuffer: 65536 });
  if (result.error || result.status !== 0 || /^\s*\d+:/m.test(result.stdout)) throw Error('controller_unprotected_path');
}
function rootChain(input: string): void {
  let path = resolve(input);
  for (;;) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) throw Error('controller_unprotected_path');
    assertNoAdditionalAcl(path);
    const parent = dirname(path); if (parent === path) break; path = parent;
  }
}
/** Uses real filesystem ownership/ACL facts; this alone is not a whole deployment qualification. */
export function assertRootProtectedExecutable(input: string): void {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') throw Error('controller_posix_identity_unavailable');
  rootChain(input);
  const stat = lstatSync(input);
  if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o111) === 0) throw Error('controller_unprotected_path');
}
export function assertRootProtectedFile(input: string): void {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') throw Error('controller_posix_identity_unavailable');
  rootChain(input);
  const stat = lstatSync(input);
  if (!stat.isFile() || stat.nlink !== 1) throw Error('controller_unprotected_path');
}
export function assertInstalledControllerIdentity(input: { serviceUid: number; interactiveUids: readonly number[]; executable: string; stateRoot: string }): void {
  if (process.platform === 'win32' || typeof process.getuid !== 'function' || typeof process.geteuid !== 'function') throw Error('controller_posix_identity_unavailable');
  if (!Number.isSafeInteger(input.serviceUid) || input.serviceUid <= 0 || !Array.isArray(input.interactiveUids) || !input.interactiveUids.length || input.interactiveUids.some(uid => !Number.isSafeInteger(uid) || uid <= 0) || input.interactiveUids.includes(input.serviceUid) || process.getuid() !== input.serviceUid || process.geteuid() !== input.serviceUid) throw Error('controller_identity_not_separated');
  assertRootProtectedExecutable(input.executable);
  if (realpathSync(process.execPath) !== realpathSync(input.executable)) throw Error('controller_runtime_identity');
  for (const key of Object.keys(process.env)) if (/^(NODE_OPTIONS|NODE_PATH|PYTHONPATH|DYLD_.*|LD_.*|DOCKER_.*|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/i.test(key)) throw Error('controller_inherited_environment');
  const root = resolve(input.stateRoot), stat = lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== input.serviceUid || (stat.mode & 0o077) !== 0) throw Error('controller_state_identity');
  rootChain(dirname(root)); assertNoAdditionalAcl(root);
}
