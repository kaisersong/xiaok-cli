import {describe,it,expect,vi} from 'vitest';
import {readAssistantCalendarMemory} from '../../electron/assistant-calendar-context.js';
import type {MemoryRecord} from '../../../src/ai/memory/store.js';
const record:MemoryRecord={id:'one',scope:'project',cwd:'/work',title:'Preference',summary:'Prepare notes',tags:[],updatedAt:1,type:'user'};
function fixture(){
 let current=true;const records=new Map([[record.id,record]]);
 const listRelevant=vi.fn(async()=>[...records.values()]);
 const input={enabled:true,ownerId:'owner',profileId:'profile',cwd:'/work',query:'meeting',store:{listRelevant,getById:(id:string)=>records.get(id)},isCurrent:()=>current,canUse:(_r:MemoryRecord,_o:string,_p:string)=>true};
 return {input,records,listRelevant,revoke:()=>{current=false;}};
}
describe('calendar opt-in memory context',()=>{
 it('does not read while disabled or without stable lookup',async()=>{const f=fixture();expect((await readAssistantCalendarMemory({...f.input,enabled:false})).status).toBe('disabled');expect(f.listRelevant).not.toHaveBeenCalled();expect((await readAssistantCalendarMemory({...f.input,store:{listRelevant:f.listRelevant}})).status).toBe('unavailable');});
 it('filters scope, owner/confirmation, duplicates and deleted current records',async()=>{
  const f=fixture();f.records.set('other',{...record,id:'other',cwd:'/else'});
  f.listRelevant.mockResolvedValue([record,record,{...record,id:'deleted'},f.records.get('other')!]);
  const result=await readAssistantCalendarMemory(f.input);expect(result.memories.map(r=>r.id)).toEqual(['one']);expect(result.kind).toBe('data');
  expect((await readAssistantCalendarMemory({...f.input,canUse:()=>false})).memories).toEqual([]);
 });
 it('keeps empty recall separate from failure and discards revoke during recall',async()=>{
  const f=fixture();f.listRelevant.mockRejectedValueOnce(Error('private'));expect((await readAssistantCalendarMemory(f.input)).status).toBe('unavailable');
  f.listRelevant.mockImplementation(async()=>{f.revoke();return [record];});expect((await readAssistantCalendarMemory(f.input)).memories).toEqual([]);
  expect((await readAssistantCalendarMemory({...fixture().input,query:''})).status).toBe('unavailable');
  const empty=fixture();empty.records.clear();expect((await readAssistantCalendarMemory(empty.input)).status).toBe('empty');
 });
 it('bounds UTF8 serialized payload to six records and 8KiB',async()=>{
  const f=fixture();f.records.clear();for(let n=0;n<12;n++)f.records.set(String(n),{...record,id:String(n),summary:'中'.repeat(400)});
  const result=await readAssistantCalendarMemory(f.input);expect(result.memories.length).toBeLessThanOrEqual(6);expect(result.memories.length).toBeGreaterThan(0);expect(Buffer.byteLength(JSON.stringify(result.memories))).toBeLessThanOrEqual(8192);
 });
});
