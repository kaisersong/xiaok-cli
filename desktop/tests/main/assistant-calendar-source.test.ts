import {DatabaseSync} from 'node:sqlite';
// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LoopStore} from '../../electron/loop-store.js';
import {AssistantYzjClient} from '../../electron/assistant-yzj-cli.js';
const root=mkdtempSync(join(tmpdir(),'assistant-calendar-source-')),now=Date.parse('2026-11-09T00:00:00Z');
const actor={success:true,data:{orgId:'org',openId:'self'}};
const record={id:'event',title:'Review',startDate:now+3600000,endDate:now+7200000};
const closes:Array<()=>unknown>=[];let serial=0;
afterEach(async()=>{const errors:unknown[]=[];for(const close of closes.splice(0).reverse()){try{await close();}catch(raw){errors.push(raw);}}if(errors.length)throw new AggregateError(errors,'calendar_fixture_cleanup');});
async function fixture(){
 const path=join(root,String(serial++)+'.sqlite'),store=new LoopStore(path);closes.push(()=>store.close());
 const run=vi.fn(async(args:string[])=>args[0]==='whoami'?actor:{success:true,data:{list:[record],count:1,more:false}});
 const cloud=new AssistantYzjClient({run}),{AssistantCalendarSource}=await import('../../electron/assistant-calendar-source.js');
 const source=new AssistantCalendarSource({store,cloud});closes.push(()=>source.close());return {path,store,run,cloud,source};
}
it('uses the actual Loop constructor and keeps default grant disabled without any provider IO',async()=>{
 const f=await fixture();expect(f.store.getAssistantCalendarConnection()).toEqual({epoch:0,enabled:false,binary:'',accountId:''});
 expect(await f.source.collect({now,requestSource:'scheduler'})).toMatchObject({status:'disabled',epoch:0,events:[]});expect(f.run).not.toHaveBeenCalled();
});
it.each(['agent','scheduler',undefined])('refuses non-user grant changes before provider IO: %s',async requestSource=>{
 const f=await fixture();await expect(f.source.enable({requestSource} as never)).rejects.toThrow('assistant_calendar_user_only');
 expect(()=>f.source.disable({requestSource} as never)).toThrow('assistant_calendar_user_only');expect(f.run).not.toHaveBeenCalled();
});
it('persists a fixed bundled connection and a business-partial observation through the real original DB',async()=>{
 const f=await fixture(),status=await f.source.enable({requestSource:'user'});expect(status).toMatchObject({enabled:true,epoch:1});
 const value=await f.source.collect({now,requestSource:'user'});expect(value).toMatchObject({status:'partial',epoch:1,errorCode:'event_semantics_unknown',recordCount:1,events:[{title:'Review',allDay:'unknown',cancelled:'unknown'}]});
 expect(value.events[0].id).toMatch(/^[a-f0-9]{64}$/);expect(f.store.getAssistantCalendarGeneration(1)).toEqual(value);
 expect(f.store.getAssistantCalendarConnection().binary).toBe('bundled-yzj');
 expect(f.run.mock.calls.some(([args])=>args.includes('--profile')||args.some(arg=>arg.startsWith('--endpoint')))).toBe(false);
});
it('keeps failed/empty provider reads distinct and does not infer complete business semantics',async()=>{
 const f=await fixture();await f.source.enable({requestSource:'user'});
 f.run.mockImplementation(async args=>args[0]==='whoami'?actor:{success:true,data:{list:[],count:0,more:false}});
 expect(await f.source.collect({now,requestSource:'scheduler'})).toMatchObject({status:'partial',events:[],recordCount:0,errorCode:'event_semantics_unknown'});
 f.run.mockRejectedValueOnce(undefined);expect(await f.source.collect({now:now+1,requestSource:'scheduler'})).toMatchObject({status:'unavailable',events:[],errorCode:'source_unavailable'});
});
it('retains provider record revisions and treats disappeared records as unconfirmed rather than cancellation',async()=>{
 const f=await fixture();await f.source.enable({requestSource:'user'});const old=await f.source.collect({now,requestSource:'user'});
 f.run.mockImplementation(async args=>args[0]==='whoami'?actor:{success:true,data:{list:[],count:0,more:false}});
 const next=await f.source.collect({now:now+1,requestSource:'user'});expect(next.observation?.missingUnconfirmed).toEqual([old.events[0].id]);expect(next.status).toBe('partial');
});
it('disables only local derived generations and rejects stale CAS/forged request origins',async()=>{
 const f=await fixture();await f.source.enable({requestSource:'user'});await f.source.collect({now,requestSource:'user'});
 for(const requestSource of ['agent','scheduler',undefined])expect(()=>f.store.setAssistantCalendarConnection({enabled:false,expectedEpoch:1,accountId:'',requestSource} as never)).toThrow('assistant_calendar_user_only');
 expect(()=>f.store.setAssistantCalendarConnection({enabled:false,expectedEpoch:0,accountId:'',requestSource:'user'})).toThrow('assistant_calendar_settings_conflict');
 f.source.disable({requestSource:'user'});expect(f.source.status()).toMatchObject({enabled:false,epoch:2,snapshot:{status:'disabled',events:[]}});expect(f.store.getAssistantCalendarGeneration(1)).toBeUndefined();
 expect(f.run.mock.calls.filter(([args])=>args[0]==='calendar')).toHaveLength(1);
});
it('restores original rows on cold construction without reenabling arbitrary binary paths',async()=>{
 const f=await fixture();await f.source.enable({requestSource:'user'});const snapshot=await f.source.collect({now,requestSource:'user'});await f.source.close();f.store.close();
 const reopened=new LoopStore(f.path);closes.push(()=>reopened.close());expect(reopened.getAssistantCalendarGeneration(1)).toEqual(snapshot);expect(reopened.getAssistantCalendarConnection()).toMatchObject({epoch:1,enabled:true,binary:'bundled-yzj'});
});
it.each(['agent',undefined])('refuses non-user/non-scheduler collection before provider IO: %s',async requestSource=>{
 const f=await fixture();await expect(f.source.collect({now,requestSource} as never)).rejects.toThrow('assistant_calendar_read_denied');expect(f.run).not.toHaveBeenCalled();
});
it('singleflights collection and drains the actual held transport before negative close returns',async()=>{
 const f=await fixture();await f.source.enable({requestSource:'user'});let enter!:()=>void,release!:(value:unknown)=>void;const entered=new Promise<void>(resolve=>{enter=resolve;}),held=new Promise(resolve=>{release=resolve;});
 f.run.mockImplementation(async args=>{if(args[0]==='whoami')return actor;enter();return await held as never;});
 const first=f.source.collect({now,requestSource:'user'}),second=f.source.collect({now,requestSource:'scheduler'});expect(second).toBe(first);await entered;
 let closed=false;const closing=f.source.close().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);
 release({success:true,data:{list:[record],count:1,more:false}});await closing;await first;expect(closed).toBe(true);expect(f.store.getAssistantCalendarGeneration(1)).toBeUndefined();
 await expect(f.source.enable({requestSource:'user'})).rejects.toThrow('assistant_calendar_closed');
});
it('prevents a late enabled grant after close entered while actual whoami was pending',async()=>{
 const f=await fixture();let enter!:()=>void,release!:(value:unknown)=>void;const entered=new Promise<void>(resolve=>{enter=resolve;}),held=new Promise(resolve=>{release=resolve;});
 f.run.mockImplementation(async()=>{enter();return await held as never;});const enabling=f.source.enable({requestSource:'user'});await entered;
 const rejected=expect(enabling).rejects.toThrow('assistant_calendar_closed'),closing=f.source.close();release(actor);await rejected;await expect(closing).rejects.toThrow('assistant_calendar_closed');expect(f.store.getAssistantCalendarConnection().epoch).toBe(0);
 // The same close rejection remains sticky; cleanup must not reinterpret it.
 closes.pop();
});

it('withholds historical picked-binary grants without executing their paths and reconnects only the bundled client',async()=>{
 const f=await fixture();await f.source.enable({requestSource:'user'});await f.source.collect({now,requestSource:'user'});await f.source.close();f.store.close();
 const old=new DatabaseSync(f.path);try{old.prepare('UPDATE assistant_calendar_connection SET binary_path=? WHERE id=1').run('/old/private/yzj-cli');}finally{old.close();}
 const restored=new LoopStore(f.path);closes.push(()=>restored.close());const source=new (await import('../../electron/assistant-calendar-source.js')).AssistantCalendarSource({store:restored,cloud:f.cloud});closes.push(()=>source.close());f.run.mockClear();
 expect(source.status().snapshot.status).toBe('unavailable');expect((await source.collect({now,requestSource:'user'})).status).toBe('unavailable');expect(f.run).not.toHaveBeenCalled();
 await source.enable({requestSource:'user'});expect(restored.getAssistantCalendarConnection()).toMatchObject({epoch:2,binary:'bundled-yzj'});expect(f.run.mock.calls.map(([args])=>args)).toEqual([['whoami']]);expect(restored.getAssistantCalendarGeneration(1)).toBeUndefined();
});
