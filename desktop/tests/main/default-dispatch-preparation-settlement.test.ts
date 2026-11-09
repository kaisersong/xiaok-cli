// Original Source production entry with controlled Electron SDK; not Native qualification.
import {afterEach,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {setImmediate as nextTurn} from 'node:timers/promises';
const sdk=vi.hoisted(()=>({windows:[] as any[],inventory:undefined as undefined|(()=>unknown),calls:0}));
vi.mock('electron',()=>({app:{isReady(){sdk.calls++;return true;}},BrowserWindow:{getAllWindows(){sdk.calls++;return sdk.inventory?sdk.inventory():sdk.windows;},fromId(id:number){sdk.calls++;return sdk.windows.find(value=>value.id===id);},fromWebContents(contents:unknown){sdk.calls++;return sdk.windows.find(value=>value.webContents===contents);}},webContents:{fromId(id:number){sdk.calls++;return sdk.windows.find(value=>value.webContents.id===id)?.webContents;}}}));
import * as native from '../../electron/default-dispatch-preparation-native-source.js';
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{sdk.inventory=undefined;for(const cleanup of cleanups.splice(0).reverse())await cleanup();sdk.windows=[];});
function original(){
 const contents=Object.assign(new EventEmitter(),{id:2,session:{},isDestroyed:()=>false,isLoading:()=>false,getURL:()=> 'file:///controlled.html'}),window=Object.assign(new EventEmitter(),{id:1,webContents:contents,isDestroyed:()=>false});sdk.windows=[window];
 const source=native.createDefaultDispatchPreparationNativeSource({window:window as any,scope,isTrustedUrl:url=>url==='file:///controlled.html'});source.activate();const lease=native.acquireOriginalPreparationNativeObservationLease(source);let released=false,negative=false;
 const release=()=>{if(!released){native.releaseOriginalPreparationNativeObservationLease(source,lease);released=true;}};
 cleanups.push(async()=>{release();if(negative)await expect(source.drain()).rejects.toThrow('UNCONFIRMED');else await source.drain();});
 return{source,lease,window,contents,release,negative:()=>{negative=true;}};
}
function read(source:unknown,lease:unknown){const fn=(native as any).readOriginalPreparationNativeObservationSettlement;expect(fn).toBeTypeOf('function');return fn(source,lease) as {assertKnown():void;waitKnown():Promise<void>};}
it('keeps an original active lease known after normal seal without waiting for its own lease completion',async()=>{
 const f=original(),before=sdk.calls,view=read(f.source,f.lease);expect(Object.getPrototypeOf(view)).toBe(null);expect(Object.isFrozen(view)).toBe(true);expect(read(f.source,f.lease)).toBe(view);view.assertKnown();await view.waitKnown();expect(sdk.calls).toBe(before);
 f.source.seal();let closed=false;const closing=f.source.drain().then(()=>{closed=true;});await nextTurn();expect(closed).toBe(false);await view.waitKnown();view.assertKnown();expect(closed).toBe(false);f.release();await closing;
});
it('reads only the same private revoked lease and rejects released or copied identities before getters',async()=>{
 const f=original(),view=read(f.source,f.lease),before=sdk.calls;f.contents.emit('did-start-navigation',{},'file:///controlled.html',false,true);expect(()=>native.assertOriginalPreparationNativeObservationCurrent(f.source,f.lease)).toThrow();expect(()=>native.assertOriginalPreparationNativeObservationLocal(f.source,f.lease)).toThrow();view.assertKnown();await view.waitKnown();expect(sdk.calls).toBe(before);
 let getters=0;const fake=new Proxy({},{get(){getters++;throw Error('foreign');},getPrototypeOf(){getters++;throw Error('foreign');}});expect(()=>read(fake,f.lease)).toThrow();expect(()=>read(f.source,fake)).toThrow();expect(()=>read({...f.source},f.lease)).toThrow();expect(()=>read(f.source,{...f.lease})).toThrow();expect(getters).toBe(0);
 f.release();expect(()=>view.assertKnown()).toThrow();expect(()=>read(f.source,f.lease)).toThrow();await expect(view.waitKnown()).rejects.toThrow();
});
it('joins the actual held SDK raw but keeps known SDK errors in effect and final drain state',async()=>{
 const f=original(),view=read(f.source,f.lease);let release!:()=>void;const held=new Promise<void>(yes=>{release=yes;});sdk.inventory=()=>held;f.negative();expect(()=>native.assertOriginalPreparationNativeObservationCurrent(f.source,f.lease)).toThrow();sdk.inventory=undefined;
 let done=false;const waiting=view.waitKnown().then(()=>{done=true;});expect(()=>view.assertKnown()).toThrow();try{await nextTurn();expect(done).toBe(false);}finally{release();}await waiting;view.assertKnown();expect(()=>native.assertOriginalPreparationNativeObservationCurrent(f.source,f.lease)).toThrow();f.release();await expect(f.source.drain()).rejects.toThrow('UNCONFIRMED');
});
it('does not turn an opaque unsafe SDK object into a known fate',async()=>{
 const f=original(),view=read(f.source,f.lease);f.negative();sdk.inventory=()=>({then(){throw Error('must not invoke');}});expect(()=>native.assertOriginalPreparationNativeObservationCurrent(f.source,f.lease)).toThrow();sdk.inventory=undefined;expect(()=>view.assertKnown()).toThrow('UNCONFIRMED');await expect(view.waitKnown()).rejects.toThrow('UNCONFIRMED');expect(()=>native.assertOriginalPreparationNativeObservationLocal(f.source,f.lease)).toThrow();
});
it('queries a reentrant SDK root without effect-current reentry poisoning or a self dependency',async()=>{
 const f=original(),view=read(f.source,f.lease);let waiting:Promise<void>|undefined;sdk.inventory=()=>{expect(()=>view.assertKnown()).toThrow();waiting=view.waitKnown();return sdk.windows;};native.assertOriginalPreparationNativeObservationCurrent(f.source,f.lease);sdk.inventory=undefined;expect(waiting).toBeDefined();await waiting;view.assertKnown();native.assertOriginalPreparationNativeObservationCurrent(f.source,f.lease);
});
it('rechecks the original lease after a held SDK tail instead of returning a released fate',async()=>{
 const f=original(),view=read(f.source,f.lease);let release!:()=>void;const held=new Promise<void>(yes=>{release=yes;});sdk.inventory=()=>held;f.negative();expect(()=>native.assertOriginalPreparationNativeObservationCurrent(f.source,f.lease)).toThrow();sdk.inventory=undefined;
 let settled=false;const waiting=view.waitKnown().then(()=>{settled=true;return true;},()=>{settled=true;return false;});f.release();
 try{await nextTurn();expect(settled).toBe(false);}finally{release();}expect(await waiting).toBe(false);expect(()=>view.assertKnown()).toThrow();
});
