import {existsSync,readdirSync,readlinkSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {ArtifactWorkspaceStore} from '../../electron/artifact-workspace-store.js';
import {closeDesktopMemoryStore,createDesktopServices} from '../../electron/desktop-services.js';

/** Relative path from `root`, with Windows `\\` normalized to `/` so assertions stay posix. */
export function toPosixRelative(root:string,file:string):string{
 return file.slice(root.length+1).replaceAll('\\','/');
}

/** Capture ArtifactWorkspaceStore instances constructed inside `run` (createDesktopServices is sync). */
export function captureArtifactWorkspaceStores<T>(run:()=>T):{value:T;stores:ArtifactWorkspaceStore[]}{
 const stores:ArtifactWorkspaceStore[]=[];
 const proto=ArtifactWorkspaceStore.prototype as unknown as {applySchema():void};
 const original=proto.applySchema;
 proto.applySchema=function(this:ArtifactWorkspaceStore){stores.push(this);return original.call(this);};
 try{return {value:run(),stores};}finally{proto.applySchema=original;}
}

/** Linux-only: sqlite/db file descriptors still open under `root`. Empty when `/proc/self/fd` is absent. */
export function openSqliteFds(root:string):string[]{
 if(!existsSync('/proc/self/fd'))return [];
 let resolved:string;try{resolved=realpathSync(root);}catch{return [];}
 const hits:string[]=[];
 for(const fd of readdirSync('/proc/self/fd')){
  let target:string;try{target=readlinkSync(join('/proc/self/fd',fd));}catch{continue;}
  const path=target.replace(/ \(deleted\)$/,'');
  if((path===resolved||path.startsWith(resolved+'/')||path.startsWith(resolved+'\\'))&&/\.(?:sqlite(?:-wal|-shm)?|db(?:-wal|-shm)?)$/.test(path))hits.push(target);
 }
 return [...new Set(hits)].sort();
}

type Services=ReturnType<typeof createDesktopServices>;

/**
 * Close every sqlite handle createDesktopServices opens that disposeMultiAgent
 * does not: artifact workspace.sqlite, knowledge.sqlite, and memory.db when it
 * already exists. Must run before rmSync; do not paper over EBUSY with retries.
 */
export async function closeCreatedDesktopServices(services:Services,artifactStores:ArtifactWorkspaceStore[],base:string):Promise<void>{
 const failures:unknown[]=[];
 try{await services.closeTaskSourceWritersForMigration();}catch(error){failures.push(error);}
 let drained=false;
 try{const result=await services.disposeMultiAgent();drained=result.drained;if(!result.drained)failures.push(Error('fixture_close_unconfirmed'));}catch(error){failures.push(error);}
 try{await services.closeMaterialRegistryAndArtifactFileManagerInstances();}catch(error){failures.push(error);}
 try{await services.sealAndDrainArtifactWorkspaceServiceInstance();}catch(error){failures.push(error);}
 for(const store of artifactStores.splice(0))try{store.close();}catch(error){failures.push(error);}
 try{services.getKnowledgeBaseStore().close();}catch(error){if(!String((error as {message?:unknown}).message??error).includes('knowledge_base_unavailable'))failures.push(error);}
 try{if(existsSync(join(services.getDataRoot(),'memory.db')))await closeDesktopMemoryStore(services.getDataRoot());}catch(error){failures.push(error);}
 const leftover=openSqliteFds(base);
 if(leftover.length)failures.push(Error(`fixture_sqlite_handles_still_open: ${leftover.join(', ')}`));
 if(!drained)throw Error('fixture_close_unconfirmed');
 if(failures.length===1)throw failures[0];
 if(failures.length)throw new AggregateError(failures,'fixture_close_unconfirmed',{cause:failures[0]});
}
