// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {LoopStore} from '../../electron/loop-store.js';
import {AssistantYzjClient} from '../../electron/assistant-yzj-cli.js';
import {AssistantCalendarSource} from '../../electron/assistant-calendar-source.js';
import {AssistantController} from '../../electron/assistant-controller.js';
import {registerAssistantTypedIpc} from '../../electron/assistant-typed-ipc.js';
const now=Date.parse('2026-11-09T00:00:00Z'),closes:Array<()=>unknown>=[];
afterEach(async()=>{for(const close of closes.splice(0).reverse())await close();});
function fixture(authorize:((event:unknown)=>boolean)|undefined=event=>event==='main-window'){
 const store=new LoopStore(':memory:');closes.push(()=>store.close());
 const run=vi.fn(async(args:string[])=>args[0]==='whoami'?{success:true,data:{openId:'self',orgId:'org'}}:{success:true,data:{list:[{id:'event',title:'Review',startDate:now+1,endDate:now+2}],count:1,more:false}});
 const source=new AssistantCalendarSource({store,cloud:new AssistantYzjClient({run})});closes.push(()=>source.close());
 const controller=new AssistantController({candidates:store,assistantService:{} as never,memoryStore:{} as never,memoryBackend:'layered',kbStore:{} as never,calendarSource:source,now:()=>now});
 const handlers=new Map<string,(event:unknown,...args:unknown[])=>unknown>();
 registerAssistantTypedIpc({handle(channel,listener){handlers.set(channel,listener);}},controller,authorize);
 const call=(method:string,event:unknown,...args:unknown[])=>Promise.resolve().then(()=>{const fn=handlers.get('desktop:assistant:'+method);if(!fn)throw Error('missing_calendar_handler:'+method);return fn(event,...args);});return {store,run,source,controller,handlers,call};
}
it('runs authenticated fixed calendar controller→Source→original Store and CLI receipt end to end',async()=>{
 const f=fixture();expect(await f.call('getCalendarStatus','main-window')).toMatchObject({enabled:false,epoch:0,snapshot:{status:'disabled'}});expect(f.run).not.toHaveBeenCalled();
 expect(await f.call('connectCalendar','main-window')).toMatchObject({enabled:true,epoch:1});
 expect(await f.call('refreshCalendar','main-window')).toMatchObject({enabled:true,epoch:1,snapshot:{status:'partial',events:[{title:'Review'}]}});
 expect(f.store.getAssistantCalendarGeneration(1)?.events).toHaveLength(1);
 expect(await f.call('disconnectCalendar','main-window')).toMatchObject({enabled:false,epoch:2});expect(f.store.getAssistantCalendarGeneration(1)).toBeUndefined();
 expect(f.run.mock.calls.filter(([args])=>args[0]==='calendar')).toHaveLength(1);
});
it('keeps sender default deny and rejects all caller source/account/routing data before effects or proxy traps',async()=>{
 const f=fixture();let traps=0;const payload=new Proxy({requestSource:'user',endpoint:'http://other',accountId:'fake'},{get(){traps++;throw Error('trap');},ownKeys(){traps++;throw Error('trap');}});
 for(const method of ['getCalendarStatus','connectCalendar','disconnectCalendar','refreshCalendar']){
  await expect(f.call(method,'renderer')).rejects.toThrow('assistant_ipc_denied');
  await expect(f.call(method,'main-window',payload)).rejects.toThrow('assistant_ipc_input');
 }
 expect(f.run).not.toHaveBeenCalled();expect(traps).toBe(0);expect(f.store.getAssistantCalendarConnection().epoch).toBe(0);
});
it('does not grant calendar access when an IPC registrar has no explicit authorized sender',async()=>{
 const f=fixture(undefined); // Default parameter is intentional in fixture; remove the real authorizer explicitly below.
 const handlers=new Map<string,(event:unknown,...args:unknown[])=>unknown>();registerAssistantTypedIpc({handle(channel,listener){handlers.set(channel,listener);}},f.controller);
 await expect(Promise.resolve().then(()=>handlers.get('desktop:assistant:connectCalendar')!('main-window'))).rejects.toThrow('assistant_ipc_denied');expect(f.run).not.toHaveBeenCalled();
});
it('fails closed after the original Source lifetime closes without changing user task admission',async()=>{
 const f=fixture();await f.source.close();await expect(f.call('connectCalendar','main-window')).rejects.toThrow('assistant_calendar_closed');expect(f.run).not.toHaveBeenCalled();expect(f.handlers.has('desktop:assistant:acceptCandidate')).toBe(true);
});
