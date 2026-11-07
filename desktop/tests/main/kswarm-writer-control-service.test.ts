import {afterEach,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {createKSwarmService,computeKSwarmServiceSourceHash,sealAndDrainKSwarmServiceInstance} from '../../electron/kswarm-service.js';
import {createKSwarmWriterControlSource} from '../../electron/kswarm-writer-control-source.js';
import {createKSwarmWriterControlService} from '../../electron/kswarm-writer-control-service.js';
import {registerKSwarmWriterControlIpc} from '../../electron/kswarm-writer-control-typed-ipc.js';
import type {IpcHandlerListener} from '../../electron/shutdown-aware-ipc-main.js';
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const work of cleanups.splice(0).reverse())await work();vi.unstubAllEnvs();vi.unstubAllGlobals();});
async function fixture({attached=false,start=true,legacy=false,fault=false}={}){
 const root=mkdtempSync(join(tmpdir(),'writer-control-main-')),entry=resolve('../../kswarm/test/fixtures/owned-desktop-control/entry.js'),children:ChildProcess[]=[],sent:unknown[]=[];let healthy=attached;
 const wc=Object.assign(new EventEmitter(),{mainFrame:{url:'file:///owned/index.html'},isDestroyed:()=>false,isLoadingMainFrame:()=>false}),window=Object.assign(new EventEmitter(),{webContents:wc,isDestroyed:()=>false});
 const source=createKSwarmWriterControlSource({getWindow:()=>window as never,getScope:()=>scope,isTrustedUrl:url=>url===wc.mainFrame.url});
 vi.stubEnv('KSWARM_SERVER_PATH',entry);vi.stubGlobal('fetch',vi.fn(async(input:unknown)=>{
  const url=String(input);if(url.includes(':4400/health'))return new Response(JSON.stringify({ok:healthy,features:['dynamic_workflows'],service:{entryPath:entry,sourceHash:computeKSwarmServiceSourceHash(entry)}}),{status:healthy?200:503});
  if(url.endsWith('/agents'))return new Response(JSON.stringify({agents:[]}));return new Response(JSON.stringify({ok:true}));
 }));
 const service=createKSwarmService({desktopProjectScope:scope,ownedControlAdmission:source.admission,findPortOwner:async()=>null,spawnProcess:((_command,_args,options)=>{
  const child=spawn(process.execPath,[entry],{...options,env:{...process.env,CONTROL_TEST_ROOT:root,...(legacy?{CONTROL_TEST_LEGACY_PROJECT:'1'}:{}),...(fault?{CONTROL_TEST_COMMIT_FAULT:'1'}:{})}});children.push(child);
  const send=child.send.bind(child);child.send=((message:unknown,callback:never)=>{sent.push(message);return send(message as never,callback);}) as typeof child.send;
  healthy=true;child.once('exit',(code,signal)=>{healthy=false;console.log(JSON.stringify({test:'Main-writer-control-service',pid:child.pid,code,signal,reaped:true}));});return child;
 }) as typeof spawn});source.bindService(service);
 const controls=createKSwarmWriterControlService({source,service}),event={sender:wc,senderFrame:wc.mainFrame};
 cleanups.push(async()=>{source.seal();await sealAndDrainKSwarmServiceInstance(service);await source.drain();for(const child of children)expect(child.exitCode!==null||child.signalCode!==null).toBe(true);rmSync(root,{recursive:true,force:true,maxRetries:5});});
 if(start)await service.start();
 return{root,source,service,controls,event,wc,window,children,sent};
}
it('uses the actual source, original owned child and native fresh writer, returning only presentation data',async()=>{
 const f=await fixture(),before=f.controls.openInspect(f.event as never,'user');try{expect(await before.run()).toEqual({ok:true,state:'unprepared',reason:'none',canPrepare:true,canMigrate:false});}finally{before.frame.release();}
 const prepare=f.controls.openPrepare(f.event as never,'user');try{expect(await prepare.run()).toEqual({ok:true,state:'prepared',reason:'none',canPrepare:false,canMigrate:false});await expect(prepare.run()).rejects.toThrow('WRITER_CONTROL_INVOCATION_CONSUMED');}finally{prepare.frame.release();}
 const db=new DatabaseSync(join(f.root,'state.sqlite'),{readOnly:true});try{expect(db.prepare("SELECT count(*) n FROM state_meta WHERE meta_key='writer_floor_v1'").get()?.n).toBe(1);}finally{db.close();}
});
it('uninstalled runtime qualification never sends a migration command even after preparing a native writer',async()=>{
 const f=await fixture(),prepare=f.controls.openPrepare(f.event as never,'user');try{await prepare.run();}finally{prepare.frame.release();}
 const count=f.sent.length,operation=f.controls.openMigrate(f.event as never,'user');try{expect(await operation.run()).toEqual({ok:false,state:'unavailable',reason:'runtime_not_ready',canPrepare:false,canMigrate:false});}finally{operation.frame.release();}expect(f.sent).toHaveLength(count);
});
it('is service-level default deny for agents and schedulers without transport effects',async()=>{
 const f=await fixture();for(const who of ['agent','scheduler'] as const)for(const method of ['openInspect','openPrepare','openMigrate'] as const)expect(()=>f.controls[method](f.event as never,who)).toThrow('WRITER_CONTROL_AUTHORITY_REQUIRED');expect(f.sent).toHaveLength(0);
});
it('attached and stopped services are unavailable without starting, falling back to HTTP or taking ownership',async()=>{
 for(const options of [{attached:true},{start:false}]){
  const f=await fixture(options),operation=f.controls.openPrepare(f.event as never,'user');try{expect(await operation.run()).toEqual({ok:false,state:'unavailable',reason:'not_owned',canPrepare:false,canMigrate:false});}finally{operation.frame.release();}expect(f.children).toHaveLength(0);expect(f.sent).toHaveLength(0);
 }
});
it('a nonempty actual legacy database is refused and cannot be retried as fresh through the semantic service',async()=>{
 const f=await fixture({legacy:true}),operation=f.controls.openPrepare(f.event as never,'user');try{expect(await operation.run()).toEqual({ok:false,state:'unavailable',reason:'existing_data',canPrepare:false,canMigrate:false});}finally{operation.frame.release();}
 const db=new DatabaseSync(join(f.root,'state.sqlite'),{readOnly:true});try{expect(db.prepare("SELECT count(*) n FROM state_meta WHERE meta_key='writer_floor_v1'").get()?.n).toBe(0);}finally{db.close();}
});
it('preserves the actual original remote native failure and never converts it into a successful presentation',async()=>{
 const f=await fixture({fault:true}),operation=f.controls.openPrepare(f.event as never,'user');let caught:unknown;
 try{await operation.run();}catch(error){caught=error;}finally{operation.frame.release();}
 expect(caught).toMatchObject({message:'OWNED_CONTROL_REMOTE_ERROR',remoteError:{name:'PersistenceCommitError',durableCommitted:false}});expect(f.controls.readFailure('prepare')).toBe(caught);
});
it('navigation before the actual send refuses an already opened invocation without a packet',async()=>{
 const f=await fixture(),operation=f.controls.openPrepare(f.event as never,'user');f.wc.emit('did-start-navigation',{},f.wc.mainFrame.url,false,true,1,1);
 try{await expect(operation.run()).rejects.toThrow('WRITER_CONTROL_AUTHORITY_REQUIRED');}finally{operation.frame.release();}expect(f.sent).toHaveLength(0);
});
it('a failed final delivery after actual known COMMIT is sticky in the Main owner across new observations',async()=>{
 const f=await fixture(),operation=f.controls.openPrepare(f.event as never,'user'),cause=Error('original final Main delivery failed');
 expect(await operation.run()).toMatchObject({ok:true,state:'prepared'});operation.fail(cause);operation.frame.release();expect(f.controls.readFailure('prepare')).toBe(cause);
 const count=f.sent.length,inspect=f.controls.openInspect(f.event as never,'user');try{expect(await inspect.run()).toEqual({ok:false,state:'unavailable',reason:'outcome_unknown',canPrepare:false,canMigrate:false});}finally{inspect.frame.release();}
 const observed=f.sent.length;expect(observed).toBeGreaterThan(count);const retry=f.controls.openPrepare(f.event as never,'user');try{await expect(retry.run()).rejects.toThrow('OWNED_CONTROL_OUTCOME_UNKNOWN');}finally{retry.frame.release();}expect(f.sent).toHaveLength(observed);
 const db=new DatabaseSync(join(f.root,'state.sqlite'),{readOnly:true});try{expect(db.prepare("SELECT count(*) n FROM state_meta WHERE meta_key='writer_floor_v1'").get()?.n).toBe(1);}finally{db.close();}
});
it('an actual late child ACK cannot deliver a withdrawn Main gesture or allow another prepare after readback',async()=>{
 const f=await fixture(),inspect=f.controls.openInspect(f.event as never,'user');try{await inspect.run();}finally{inspect.frame.release();}
 const child=f.children[0]!,send=child.send.bind(child);let release:(()=>void)|undefined;
 const ack=new Promise<void>(resolve=>{const received=(raw:unknown)=>{const row=raw as {type?:string;op?:string};if(row.type==='response'&&row.op==='prepare_initial_plan_writer'){child.off('message',received);resolve();}};child.on('message',received);});
 child.send=((message:unknown,callback:(error:Error|null)=>void)=>{send(message as never,error=>{release=()=>callback(error);});return false;}) as typeof child.send;
 const operation=f.controls.openPrepare(f.event as never,'user'),work=operation.run();let caught:unknown;const observed=work.catch(error=>{caught=error;});
 try{
  await ack;for(let n=0;n<100&&!release;n++)await delay(5);expect(release).toBeTypeOf('function');f.wc.emit('did-start-navigation',{},f.wc.mainFrame.url,false,true,1,1);await observed;expect(caught).toMatchObject({message:'WRITER_CONTROL_AUTHORITY_REQUIRED'});
 }finally{release?.();child.send=send;operation.frame.release();}
 await delay(0);f.wc.emit('did-frame-finish-load',{},true,1,1);const next=f.controls.openInspect(f.event as never,'user');try{expect(await next.run()).toMatchObject({ok:false,reason:'outcome_unknown',canPrepare:false});}finally{next.frame.release();}
});
it('a replaced WeakMap lookup cannot recategorize the actual post-COMMIT guard error as zero-admission unavailable',async()=>{
 const f=await fixture(),initial=f.controls.openInspect(f.event as never,'user');try{await initial.run();}finally{initial.frame.release();}
 const operation=f.controls.openPrepare(f.event as never,'user'),cause=Error('original post-COMMIT source fault'),db=new DatabaseSync(join(f.root,'state.sqlite'),{readOnly:true});
 const original=WeakMap.prototype.get;let armed=true,caught:unknown;
 f.window.isDestroyed=()=>{if(armed&&db.prepare("SELECT count(*) n FROM state_meta WHERE meta_key='writer_floor_v1'").get()?.n===1){armed=false;WeakMap.prototype.get=function(key:object){return key===cause?{service:f.service,operation:'prepare_initial_plan_writer',context:operation.frame.context}:Reflect.apply(original,this,[key]);};throw cause;}return false;};
 try{await operation.run();}catch(error){caught=error;}finally{WeakMap.prototype.get=original;operation.frame.release();db.close();}
 expect(caught).toBe(cause);const observe=f.controls.openInspect(f.event as never,'user');try{expect(await observe.run()).toMatchObject({ok:false,reason:'outcome_unknown'});}finally{observe.frame.release();}
});
it('the actual semantic ACK followed by real typed projection failure reports sticky unknown to its original Main owner',async()=>{
 const f=await fixture(),handlers=new Map<string,IpcHandlerListener>();let invoked=0;
 registerKSwarmWriterControlIpc({handle:(channel,handler)=>{handlers.set(channel,handler);}},{...f.controls,openPrepare(event,who){
  const invocation=f.controls.openPrepare(event,who);return{...invocation,async run(){const result=await invocation.run();return Object.defineProperty({...result},'extra',{enumerable:true,get(){invoked++;return 'must not execute';}});}};
 }});
 await expect(handlers.get('desktop:kswarm:writer:prepare')!(f.event as never)).rejects.toThrow();expect(invoked).toBe(0);
 const next=f.controls.openInspect(f.event as never,'user');try{expect(await next.run()).toMatchObject({ok:false,reason:'outcome_unknown',canPrepare:false});}finally{next.frame.release();}
 const count=f.sent.length,retry=f.controls.openPrepare(f.event as never,'user');try{await expect(retry.run()).rejects.toThrow('OWNED_CONTROL_OUTCOME_UNKNOWN');}finally{retry.frame.release();}expect(f.sent).toHaveLength(count);
 const db=new DatabaseSync(join(f.root,'state.sqlite'),{readOnly:true});try{expect(db.prepare("SELECT count(*) n FROM state_meta WHERE meta_key='writer_floor_v1'").get()?.n).toBe(1);}finally{db.close();}
});
