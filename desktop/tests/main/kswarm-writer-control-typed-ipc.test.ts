import {WRITER_CONTROL_OUTPUT} from '../../shared/kswarm-writer-control-ipc-contract.js';
import {beforeEach,expect,it} from 'vitest';
import {EventEmitter} from 'node:events';
import {registerKSwarmWriterControlIpc} from '../../electron/kswarm-writer-control-typed-ipc.js';
import {createKSwarmWriterControlSource} from '../../electron/kswarm-writer-control-source.js';
import {resetIpcSchemaRegistryForTests,IPC_SCHEMA_REGISTRY} from '../../electron/ipc-runtime.js';
import type {KSwarmWriterControlService} from '../../electron/kswarm-writer-control-service.js';
import type {IpcHandlerListener} from '../../electron/shutdown-aware-ipc-main.js';
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
const data=()=>({ok:true as const,state:'unprepared' as const,reason:'none' as const,canPrepare:true as const,canMigrate:false as const});
beforeEach(()=>resetIpcSchemaRegistryForTests());
function fixture(run:()=>Promise<unknown>=async()=>data(),trustedHook=()=>{}){
 const wc=Object.assign(new EventEmitter(),{mainFrame:{url:'file:///owned/index.html'},isDestroyed:()=>false,isLoadingMainFrame:()=>false}),window=Object.assign(new EventEmitter(),{webContents:wc,isDestroyed:()=>false}),event={sender:wc,senderFrame:wc.mainFrame};
 const source=createKSwarmWriterControlSource({getWindow:()=>window as never,getScope:()=>scope,isTrustedUrl:()=>{trustedHook();return true;}});source.bindService({} as never);
 const frames:ReturnType<typeof source.openInspect>[]=[],handlers=new Map<string,IpcHandlerListener>();let effects=0;const failures:unknown[]=[];
 const open=()=>{const frame=source.openInspect(event as never,'user');frames.push(frame);return{frame,fail:(error:unknown)=>{failures.push(error);},run:async()=>{effects++;return run();}};};
 const controls={openInspect:open,openPrepare:open,openMigrate:open,readFailure:()=>undefined} as KSwarmWriterControlService;
 registerKSwarmWriterControlIpc({handle:(channel,handler)=>{handlers.set(channel,handler);}},controls);
 return{source,event,wc,frames,failures,get effects(){return effects;},invoke:(method='inspect',...args:unknown[])=>handlers.get('desktop:kswarm:writer:'+method)!(event as never,...args)};
}
it('registers three exact empty-tuple semantic contracts and delivers data after final source verification',async()=>{
 const f=fixture();expect([...IPC_SCHEMA_REGISTRY.keys()]).toEqual(['desktop:kswarm:writer:inspect','desktop:kswarm:writer:prepare','desktop:kswarm:writer:migrate']);
 expect(await f.invoke()).toEqual(data());expect(f.effects).toBe(1);expect(()=>f.frames[0]!.assertCurrent()).toThrow('WRITER_CONTROL_AUTHORITY_REQUIRED');f.source.seal();
});
it('refuses JSON source, operation, scope and proof before running a semantic effect',async()=>{
 const f=fixture();for(const args of [[{requestSource:'user'}],[{op:'prepare'}],[scope],[{}]])await expect(f.invoke('prepare',...args)).rejects.toThrow();
 expect(f.effects).toBe(0);for(const frame of f.frames)expect(()=>frame.assertCurrent()).toThrow();f.source.seal();
});
it('rejects a held output after actual navigation and releases its original proof',async()=>{
 let release!:(value:unknown)=>void;const held=new Promise(resolve=>{release=resolve;}),f=fixture(()=>held),work=f.invoke() as Promise<unknown>;
 f.wc.emit('did-start-navigation',{},f.wc.mainFrame.url,false,true,1,1);release(data());await expect(work).rejects.toThrow('WRITER_CONTROL_AUTHORITY_REQUIRED');expect(()=>f.frames[0]!.assertCurrent()).toThrow();f.source.seal();
});
it('source schema failure never invokes an output getter and cleans the admitted frame',async()=>{
 let touched=0;const f=fixture(async()=>({...data(),get extra(){touched++;return 'bad';}}));await expect(f.invoke()).rejects.toThrow();expect(touched).toBe(0);expect(()=>f.frames[0]!.assertCurrent()).toThrow();f.source.seal();
});
it('each invocation gets its own fresh closed projection even if a producer repeats one cached input object',async()=>{
 const cached=Object.freeze(data()),f=fixture(async()=>cached);const first=f.invoke() as Promise<unknown>,second=f.invoke() as Promise<unknown>;
 const [a,b]=await Promise.all([first,second]);expect(a).toEqual(cached);expect(b).toEqual(cached);expect(a).not.toBe(b);for(const frame of f.frames)expect(()=>frame.assertCurrent()).toThrow();f.source.seal();
});
it('an original semantic failure keeps its exact object while cleaning only its own admitted proof',async()=>{
 const cause=Error('original native failure'),f=fixture(async()=>{throw cause;});await expect(f.invoke()).rejects.toBe(cause);expect(()=>f.frames[0]!.assertCurrent()).toThrow();f.source.seal();
});

it('returns an inert original projection after the last source SDK installs an inherited then getter',async()=>{
 let armed=false,hooks=0,frameReads=0;const previous=Object.getOwnPropertyDescriptor(Object.prototype,'then'),f=fixture(async()=>{armed=true;return data();});
 Object.defineProperty(f.event,'senderFrame',{get(){if(armed&&++frameReads===2)Object.defineProperty(Object.prototype,'then',{configurable:true,get(){hooks++;return undefined;}});return f.wc.mainFrame;}});
 let output:unknown;try{output=await f.invoke();}finally{if(previous)Object.defineProperty(Object.prototype,'then',previous);else delete (Object.prototype as any).then;f.source.seal();}
 expect(frameReads).toBe(2);expect(hooks).toBe(0);expect(Object.getPrototypeOf(output)).toBe(null);expect(output).toEqual(data());
});

it('retains the actual final schema failure instead of replacing it with a delivery diagnostic',async()=>{
 const f=fixture(),parse=WRITER_CONTROL_OUTPUT.parse,original=Error('original final schema error');let count=0;
 WRITER_CONTROL_OUTPUT.parse=function(...args:Parameters<typeof parse>){if(++count===3)throw original;return Reflect.apply(parse,this,args);};
 try{await expect(f.invoke()).rejects.toBe(original);expect(count).toBe(3);expect(f.failures[0]).toBe(original);expect(()=>f.frames[0]!.assertCurrent()).toThrow();}finally{WRITER_CONTROL_OUTPUT.parse=parse;f.source.seal();}
});
