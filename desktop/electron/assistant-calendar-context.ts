import type {MemoryRecord,MemoryStore} from '../../src/ai/memory/store.js';

export interface AssistantCalendarMemoryContext {
 kind:'data';
 status:'disabled'|'available'|'empty'|'unavailable';
 memories:Array<{id:string;title:string;summary:string;updatedAt:number}>;
}
/** Main-private read adapter. canUse must verify current owner/profile access AND
 * user confirmation; MemoryRecord itself carries neither ownership nor consent.
 * An empty recall makes no statement about the user's commitments. */
export async function readAssistantCalendarMemory(input:{
 enabled:boolean;ownerId:string;profileId:string;cwd:string;query:string;
 store:Pick<MemoryStore,'listRelevant'|'getById'>;
 isCurrent():boolean;
 canUse(record:MemoryRecord,ownerId:string,profileId:string):boolean;
}):Promise<AssistantCalendarMemoryContext>{
 const result=(status:AssistantCalendarMemoryContext['status'],memories:AssistantCalendarMemoryContext['memories']=[]):AssistantCalendarMemoryContext=>({kind:'data',status,memories});
 if(!input.enabled)return result('disabled');
 try{
  if(!input.ownerId||!input.profileId||!input.cwd||!input.query.trim()||input.query.length>2048||!input.store.getById||!input.isCurrent())return result('unavailable');
  const recalled=await input.store.listRelevant({cwd:input.cwd,query:input.query});
  if(!input.isCurrent())return result('unavailable');
  const memories:AssistantCalendarMemoryContext['memories']=[],seen=new Set<string>();
  for(const candidate of recalled.slice(0,200)){
   if(memories.length===6)break;
   if(typeof candidate.id!=='string'||seen.has(candidate.id))continue;
   seen.add(candidate.id);
   const record=input.store.getById(candidate.id);
   if(!record||record.id!==candidate.id||!(record.scope==='global'||record.scope==='project'&&record.cwd===input.cwd)
    ||!input.canUse(record,input.ownerId,input.profileId))continue;
   if(typeof record.title!=='string'||typeof record.summary!=='string'||!Number.isFinite(record.updatedAt))continue;
   const entry={id:record.id,title:record.title,summary:record.summary,updatedAt:record.updatedAt};
   if(Buffer.byteLength(JSON.stringify([...memories,entry]),'utf8')<=8192)memories.push(entry);
  }
  if(!input.isCurrent())return result('unavailable');
  return result(memories.length?'available':'empty',memories);
 }catch{return result('unavailable');}
}
