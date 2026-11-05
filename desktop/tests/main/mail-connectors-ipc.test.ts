// @vitest-environment node
import { expect,it,vi } from 'vitest';
import { registerMailConnectorIpc } from '../../electron/mail-connector-typed-ipc';
function setup(){const handlers=new Map<string,Function>();const service={list:vi.fn(()=>[]),connect:vi.fn(),disconnect:vi.fn(),test:vi.fn(),search:vi.fn(),read:vi.fn(),getOAuthState:vi.fn(()=>({phase:'idle'})),beginOAuth:vi.fn(),cancelOAuth:vi.fn()};registerMailConnectorIpc({handle:(channel,handler)=>handlers.set(channel,handler)},service as never,event=>(event as any).trusted===true);return {handlers,service};}
it('denies foreign sender before inspecting credentials and rejects injected authority',async()=>{
 const f=setup();const connect=f.handlers.get('desktop:mail:connect')!;
 await expect(connect({trusted:false},{provider:'qq',password:'secret'})).rejects.toThrow('mail_sender_forbidden');
 await expect(connect({trusted:true},{provider:'qq',email:'x@qq.com',password:'secret',allowSend:true,expectedRevision:0,requestSource:'agent'})).rejects.toThrow();expect(f.service.connect).not.toHaveBeenCalled();
});
it('never allows secret-bearing public account projections through IPC',async()=>{const f=setup();f.service.list.mockReturnValue([{id:'a'.repeat(32),provider:'qq',email:'x@qq.com',host:'imap.qq.com',port:993,allowSend:true,revision:1,status:'saved',password:'secret'}] as never);await expect(f.handlers.get('desktop:mail:list')!({trusted:true})).rejects.toThrow();});

it('rechecks sender authorization before returning a delayed network result',async()=>{
 const handlers=new Map<string,Function>();let trusted=true,finish!:(value:any)=>void;const service={search:vi.fn(()=>new Promise(resolve=>finish=resolve))};
 registerMailConnectorIpc({handle:(channel,handler)=>handlers.set(channel,handler)},service as never,()=>trusted);
 const pending=handlers.get('desktop:mail:search')!({}, {accountId:'a'.repeat(32)});await vi.waitFor(()=>expect(service.search).toHaveBeenCalledWith({accountId:'a'.repeat(32)},'user'));trusted=false;finish({messages:[],hasMore:false,coverage:'complete'});await expect(pending).rejects.toThrow('mail_sender_forbidden');
});
