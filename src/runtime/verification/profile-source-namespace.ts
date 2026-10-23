import {posix,win32} from 'node:path';
import {isWriterLockSourceName} from './writer-lock-source-name.js';
import type {ProfileSourceDescriptor} from './profile-source-descriptor.js';
type Source=ProfileSourceDescriptor extends infer T?T extends ProfileSourceDescriptor?Omit<T,'namespaceId'|'reviewedSnapshotSha256'>:never:never;
function paths(path:string){return /^[A-Za-z]:/.test(path)||path.startsWith('\\\\')?win32:posix;}
/** Fixed original producer namespaces. This validates semantics only; it never
 * proves inventory completeness, physical identity, custody or approval. */
export function assertProfileSourceNamespace(source:Source):void{
 const path=paths(source.directory.canonicalPath);
 if(source.kind!=='sqlite-db'){
  if(path.basename(source.directory.canonicalPath)==='.canonical-session-aliases'&&source.kind!=='session-alias-holder')throw Error('profile_source_namespace');
 }else {const base=source.database.basename,main=base.replace(/-(?:journal|wal|shm)$/,'');if(main!==base&&isWriterLockSourceName(source.directory.canonicalPath,main))throw Error('profile_source_namespace');if(isWriterLockSourceName(source.directory.canonicalPath,base)&&source.snapshotFormat!=='writer-lock-sqlite-v1')throw Error('profile_source_namespace');}
}
/** Declared descendants cannot replace original fixed producer namespaces. */
export function assertProfileReferenceNamespace(parent:Source,relativePath:string,target:Source,physicalSuffix?:string):void{
 assertProfileSourceNamespace(target);
 if(target.kind==='sqlite-db'){
  const path=paths(parent.directory.canonicalPath);
  if(!['','-journal','-wal','-shm'].includes(physicalSuffix??'invalid')||path.join(parent.directory.canonicalPath,...relativePath.split('/'))!==path.join(target.directory.canonicalPath,target.database.basename+physicalSuffix))throw Error('profile_source_namespace');
  if(parent.kind==='goal-file-root'&&/^goals\.sqlite(?:-journal|-wal|-shm)?$/.test(relativePath)&&(target.snapshotFormat!=='goal-sqlite-v1'||target.database.basename!=='goals.sqlite'))throw Error('profile_source_namespace');
  const base=path.basename(relativePath),main=base.replace(/-(?:journal|wal|shm)$/,''),directory=path.dirname(path.join(parent.directory.canonicalPath,...relativePath.split('/')));
  if(isWriterLockSourceName(directory,main)&&(target.database.basename!==main||target.snapshotFormat!=='writer-lock-sqlite-v1'))throw Error('profile_source_namespace');
  return;
 }
 if(parent.kind==='task-root'&&relativePath==='protected-observation-sessions'&&target.kind!=='session-root')throw Error('profile_source_namespace');
 if(parent.kind==='task-root'&&relativePath==='snapshots'||parent.kind==='session-root'&&['.migrations','.deletions','.session-execution'].includes(relativePath))throw Error('profile_source_namespace');
}
