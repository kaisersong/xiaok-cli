import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { recoverTaskSnapshotSync } from '../../src/runtime/task-host/snapshot-store.js';
import type { TaskSnapshot } from '../../src/runtime/task-host/types.js';
import type { AssistantSourceReceipt } from './assistant-source-ports.js';

/** Full enumeration receipt; recover/parse losses and the upstream cap remain
 * visible even if time-window filtering later produces an empty list. */
export function readAssistantTaskSource(dataRoot:string,limit=100):AssistantSourceReceipt<TaskSnapshot> {
 const root=join(dataRoot,'tasks'),directory=join(root,'snapshots');
 try {
  if(!existsSync(directory))return {items:[],availability:'available',completeness:'complete'};
  const files=readdirSync(directory).filter(name=>name.endsWith('.json'))
   .map(name=>({name,mtime:statSync(join(directory,name)).mtimeMs}))
   .sort((a,b)=>b.mtime-a.mtime||a.name.localeCompare(b.name));
  let incomplete=files.length>limit;
  const items:TaskSnapshot[]=[];
  for(const {name} of files.slice(0,limit)){
   try {const snapshot=recoverTaskSnapshotSync(root,basename(name,'.json'));if(snapshot)items.push(snapshot);else incomplete=true;}
   catch {incomplete=true;}
  }
  return {items,availability:'available',completeness:incomplete?'partial':'complete'};
 }catch{return {items:[],availability:'unavailable',completeness:'unknown'};}
}

export function readAssistantTaskMetadata(dataRoot:string,window:{from:number;to:number},limit=100){
 const receipt=readAssistantTaskSource(dataRoot,limit);
 return {...receipt,items:receipt.items.filter(row=>row.updatedAt>=window.from&&row.updatedAt<=window.to).map(row=>({
 id:row.taskId,threadId:row.context?.threadId??row.sessionId,title:row.understanding?.goal??row.prompt.slice(0,160),status:row.status,summary:row.result?.summary??row.understanding?.nextAction,updatedAt:row.updatedAt,
 artifacts:(row.result?.artifacts??[]).map(artifact=>({id:artifact.artifactId,title:artifact.title,summary:artifact.kind,updatedAt:Number.isFinite(Date.parse(artifact.createdAt))?Date.parse(artifact.createdAt):row.updatedAt})),
 }))};
}
