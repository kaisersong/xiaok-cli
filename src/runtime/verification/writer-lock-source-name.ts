import {posix,win32} from 'node:path';
/** Classifies only the original lock-file namespace. Membership in the full
 * original inventory and an empty held SQLite schema are separate checks. */
export function isWriterLockSourceName(directory:string,basename:string):boolean{
 const windows=/^[A-Za-z]:/.test(directory)||directory.startsWith('\\\\');
 const path=windows?win32:posix;
 if(path.basename(basename)!==basename||basename.includes('/')||basename.includes('\\'))return false;
 if(/^[a-f0-9]{64}\.sqlite$/.test(basename))return path.basename(directory)==='.session-execution';
 return /^(?:\.session-store-lock|\.task-store\.save\.lock|\.goal-store\.save\.lock|\.goal-native\.save\.lock|\.profile-source-registry\.lock|[A-Za-z0-9_-]{1,160}\.json\.save-lock)\.cleanup\.sqlite$/.test(basename);
}
