import type {MemoryRecord,MemoryStore} from '../../src/ai/memory/store.js';
import {captureAssistantDerivedValue} from './assistant-derived-data.js';
import {canonicalVerificationJson} from '../../src/runtime/verification/protocol.js';
export async function readAssistantCalendarMemory(options:{enabled:boolean;ownerId:string;profileId:string;cwd:string;query:string;store:Pick<MemoryStore,'listRelevant'|'getById'>;isCurrent():boolean;canUse(record:MemoryRecord):boolean}){
 const empty=(status:'disabled'|'empty'|'unavailable')=>({kind:'data' as const,status,memories:[] as Array<{id:string;title:string;summary:string;updatedAt:number}>});
 if(!options.enabled)return empty('disabled');
 if(!options.ownerId||!options.profileId||!options.cwd||!options.query||options.query.length>2048||!options.store.getById||!options.isCurrent())return empty('unavailable');
 try{
  const recalled=await options.store.listRelevant({cwd:options.cwd,query:options.query});if(!options.isCurrent())return empty('unavailable');
  const candidates=captureAssistantDerivedValue(recalled);if(!Array.isArray(candidates))return empty('unavailable');
  const memories:Array<{id:string;title:string;summary:string;updatedAt:number}>=[],ids=new Set<string>();
  for(const hinted of candidates.slice(0,200)){
   if(!hinted||typeof hinted.id!=='string'||!hinted.id||ids.has(hinted.id))continue;
   const raw=options.store.getById(hinted.id);if(!raw)continue;const record=captureAssistantDerivedValue(raw);
   if(record.id!==hinted.id||record.scope!=='global'&&(record.scope!=='project'||record.cwd!==options.cwd)||typeof record.title!=='string'||typeof record.summary!=='string'||!Number.isSafeInteger(record.updatedAt)||record.updatedAt<0||!options.canUse(record)||!options.isCurrent())continue;
   const next={id:record.id,title:record.title,summary:record.summary,updatedAt:record.updatedAt};
   if(Buffer.byteLength(canonicalVerificationJson([...memories,next]))>8192)continue;memories.push(next);ids.add(record.id);if(memories.length===6)break;
  }
  if(!options.isCurrent())return empty('unavailable');return {kind:'data' as const,status:memories.length?'available' as const:'empty' as const,memories};
 }catch{return empty('unavailable');}
}
