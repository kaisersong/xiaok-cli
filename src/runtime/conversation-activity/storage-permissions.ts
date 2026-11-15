import { chmodSync, lstatSync, readdirSync, mkdirSync, writeFileSync,openSync,closeSync } from 'node:fs';
import { basename, dirname, resolve, parse, join } from 'node:path';
import {inspectWindowsOwnerPath,protectWindowsOwnerDirectory,createWindowsPrivateDirectory,protectWindowsOwnerFile,writeWindowsPrivateFile,ensureWindowsPrivateFile} from '../windows-owner-security.js';

export const ACTIVITY_STORAGE_NAMES = {
  database: 'conversation-activity.sqlite', ownerPrefix: 'activity-owner.',
  config: 'activity-owner.config.json', log: 'activity-owner.log', status: 'activity-owner.status.json', credentials: 'activity-owner.credentials.json',
  nativeSourceCredential: 'activity-owner.native-source.credentials.json',
  supervision: 'activity-source-supervision.json', kswarmLog: 'activity-kswarm.log', brokerLog: 'activity-broker.log',
  endpoints: 'activity-mcp-endpoints.json', notice: 'first-start-notice-shown', snapshots: 'snapshots',
} as const;
export function activityStorageLayout(root: string): 'dedicated' | 'shared' {
  return basename(dirname(resolve(root))) === 'conversation-activity' ? 'dedicated' : 'shared';
}
export function isActivityStorageEntry(name: string): boolean {
  return name === ACTIVITY_STORAGE_NAMES.snapshots || Object.entries(ACTIVITY_STORAGE_NAMES)
    .some(([key, prefix]) => key !== 'snapshots' && name.startsWith(prefix));
}
export function chmodPrivateActivityFile(path: string): void {
  try {
    if(process.platform==='win32'){protectWindowsOwnerFile(path);return;}
    const state = lstatSync(path);
    if (!state.isFile() || state.isSymbolicLink() || state.uid !== process.getuid?.()) throw new Error();
    chmodSync(path, 0o600);
  } catch { throw new Error('activity_storage_not_private'); }
}
export function writePrivateActivityFile(path:string,content:string,exclusive=false):void {
  if(process.platform==='win32'){writeWindowsPrivateFile(path,content,exclusive);return;}
  writeFileSync(path,content,{mode:0o600,flag:exclusive?'wx':'w'});chmodPrivateActivityFile(path);
}
export function ensurePrivateActivityFile(path:string):void {
  if(process.platform==='win32'){ensureWindowsPrivateFile(path);return;}
  closeSync(openSync(path,'a',0o600));chmodPrivateActivityFile(path);
}

/** Bounds work on untrusted or unexpectedly large legacy storage trees. */
const MAX_STORAGE_ENTRIES = 100_000;
/** Tighten legacy storage before any persistent write; never follow links. */
export function secureActivityStorage(root: string, options: { chmodSync?: typeof chmodSync; maxEntries?: number; platform?: NodeJS.Platform } = {}): void {
  const windows=(options.platform??process.platform)==='win32';
  try {
    // Ancestors above the activity tree (home, config dir, macOS /var -> /private/var)
    // belong to the user's environment and may legitimately be links. Only the
    // activity tree itself must be real, owned directories and files.
    root = resolve(root);
    const parent = dirname(root);
    const dedicated = activityStorageLayout(root) === 'dedicated';
    const paths = dedicated ? windows?[root]:[parent, root] : readdirSync(root).filter(isActivityStorageEntry).map(name => join(root, name));
    const verified: Array<[string, number]> = [];
    let count = 0;
    while (paths.length) {
      const path = paths.pop()!;
      if (++count > (options.maxEntries ?? MAX_STORAGE_ENTRIES)) throw new Error();
      // An exposed capability cannot become secret again by chmod. Its fixed
      // owner validates it without repair; invalid Native credentials must not
      // disable ordinary activity or change a linked/unrelated target.
      if (path === join(root, ACTIVITY_STORAGE_NAMES.nativeSourceCredential)) continue;
      const state = lstatSync(path);
      if(windows){
        if(state.isSymbolicLink()||!state.isDirectory()&&!state.isFile())throw new Error();
        if(state.isDirectory()){
          if(!dedicated&&dirname(path)===root&&basename(path)!==ACTIVITY_STORAGE_NAMES.snapshots)throw new Error();
          protectWindowsOwnerDirectory(path);
          for(const name of readdirSync(path))paths.push(join(path,name));
        }else protectWindowsOwnerFile(path);
        continue;
      }
      if (state.isSymbolicLink() || state.uid !== process.getuid?.()) throw new Error();
      if (state.isSocket() && dedicated) continue;
      if (!dedicated && state.isDirectory() && dirname(path) === root && basename(path) !== ACTIVITY_STORAGE_NAMES.snapshots) throw new Error();
      if (!state.isDirectory() && !state.isFile()) throw new Error();
      const mode = state.isDirectory() ? 0o700 : 0o600;
      (options.chmodSync ?? chmodSync)(path, mode); verified.push([path, mode]);
      // The shared parent is secured without traversing other workspace owners.
      if (state.isDirectory() && path !== parent) for (const name of readdirSync(path)) paths.push(resolve(path, name));
    }
    for (const [path, mode] of verified) {
      const state = lstatSync(path);
      if (state.isSymbolicLink() || state.uid !== process.getuid?.() || (state.mode & 0o7777) !== mode) throw new Error();
    }
  } catch { throw new Error('activity_storage_not_private'); }
}

/** Check existing ancestors before recursive mkdir can write through a link. */
export function createPrivateActivityDirectory(root: string): void {
  try {
    if (process.platform !== 'win32') {
      // Refuse to create through a link inside the activity tree. Links above the
      // nearest `conversation-activity` directory are the user's own layout.
      const target = resolve(root);
      let floor = target;
      for (let path = target; path !== parse(path).root; path = dirname(path)) {
        if (basename(path) === 'conversation-activity') { floor = path; break; }
      }
      for (let ancestor = target; ancestor.length >= floor.length && ancestor !== parse(ancestor).root; ancestor = dirname(ancestor)) {
        try { if (lstatSync(ancestor).isSymbolicLink()) throw new Error('activity_storage_not_private'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (ancestor === floor) break;
      }
    }
    const missing: string[] = [];
    for (let path = resolve(root); ; path = dirname(path)) {
      try { lstatSync(path); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      missing.push(path);
    }
    for (const path of missing.reverse()) {
      try { if(process.platform==='win32')createWindowsPrivateDirectory(path);else mkdirSync(path, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; else continue; }
      if (process.platform !== 'win32') chmodSync(path, 0o700);
    }
    secureActivityStorage(root);
  } catch { throw new Error('activity_storage_not_private'); }
}

/** SQLite inherits its parent ACL. SYSTEM and elevated Administrators are trusted
 * OS principals; never tighten the shared config root or accept ordinary users. */
export function assertWindowsPrivateActivityParent(file:string):void {
  const facts=inspectWindowsOwnerPath(dirname(file));
  if(!facts.directory||!facts.protectionOwnerEligible||facts.allowSids.length===0||facts.allowSids.some(sid=>![facts.currentSid,'S-1-5-18','S-1-5-32-544'].includes(sid))||!facts.sddl.split('(').some(ace=>{const parts=ace.split(';');return parts[0]==='A'&&parts[1]?.includes('OI')&&parts[1]?.includes('CI')&&!parts[1]?.includes('IO')&&parts[2]==='FA'&&parts[5]===facts.currentSid+')';}))throw Error('activity_storage_not_private');
}
