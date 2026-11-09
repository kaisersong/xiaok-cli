// @vitest-environment node
import {expect,it} from 'vitest';
import {AssistantController} from '../../electron/assistant-controller.js';
import {registerAssistantTypedIpc} from '../../electron/assistant-typed-ipc.js';
import {assistantDerivedFixture} from '../support/assistant-derived-test-fixture.js';
it('runs user-only memory consent through the real authenticated semantic registrar without caller identity or routing fields',async()=>{
 const f=assistantDerivedFixture();try{
  const controller=new AssistantController({candidates:f.store,memoryStore:f.memory,memoryBackend:'layered',kbStore:{} as never,assistantService:{} as never,calendarMemory:f.ports.calendarMemory}),handlers=new Map<string,(event:unknown,...args:unknown[])=>unknown>();
  registerAssistantTypedIpc({handle(channel,listener){handlers.set(channel,listener);}},controller,event=>event==='original-window');
  const call=(name:string,event:unknown,...args:unknown[])=>Promise.resolve().then(()=>handlers.get('desktop:assistant:'+name)!(event,...args));
  expect(await call('getCalendarMemorySettings','original-window')).toEqual({enabled:false,revision:0});
  expect(await call('configureCalendarMemory','original-window',{enabled:true,expectedRevision:0})).toEqual({enabled:true,revision:1});
  await expect(call('configureCalendarMemory','original-window',{enabled:false,expectedRevision:0})).rejects.toThrow('assistant_calendar_memory_conflict');
  let traps=0;const proxy=new Proxy({enabled:true,expectedRevision:1},{ownKeys(){traps++;throw Error('trap');},get(){traps++;throw Error('trap');}});
  await expect(call('configureCalendarMemory','foreign-renderer',proxy)).rejects.toThrow('assistant_ipc_denied');
  await expect(call('configureCalendarMemory','original-window',proxy)).rejects.toThrow();expect(traps).toBe(0);
  for(const requestSource of ['agent','scheduler'] as const)expect(()=>controller.configureCalendarMemory({enabled:false,expectedRevision:1,requestSource})).toThrow('assistant_calendar_memory_user_only');
  await expect(call('configureCalendarMemory','original-window',{enabled:false,expectedRevision:1,ownerId:'other'})).rejects.toThrow('assistant_ipc_input');
  expect(f.ports.calendarMemory.status()).toEqual({enabled:true,revision:1});expect(f.recalls).toBe(0);expect(f.store.getAssistantCalendarConnection().enabled).toBe(false);
 }finally{await f.close();}
});
