/** Fixed Native child SDK consumer. This is a local process/stream receipt;
 * it grants no business work, cost refund, old-FD or namespace completeness. */
import {data,method,setField} from './kswarm-protected-child-data.js';
import {createProtectedChildCallbackCustody} from './protected-child-callback-custody.js';
import type {ChildProcess} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {constants} from 'node:os';
import {types,TextDecoder} from 'node:util';
import {createRoomTurnCustody} from './original-room-turn-custody.js';
import {appendIntrinsic,createIntrinsicSet,settleIntrinsicOperations} from '../../src/runtime/verification/intrinsic-async-collection.js';
const requireFixed=createRequire(import.meta.url),apply=Reflect.apply,define=Object.defineProperty as (target:object,key:PropertyKey,attributes:PropertyDescriptor&{__proto__?:null})=>object,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn;
const NativeMap=Map,NativePromise=Promise,then=Promise.prototype.then,stringify=JSON.stringify,parse=JSON.parse,bufferFrom=Buffer.from,bufferSubarray=Buffer.prototype.subarray;
const decode=TextDecoder.prototype.decode,mapGet=Map.prototype.get,mapSet=Map.prototype.set;
function removeAt<T>(array:T[],index:number):void{for(let at=index;at+1<array.length;at++)define(array,String(at),{__proto__:null,value:array[at+1],writable:true,enumerable:true,configurable:true});define(array,'length',{__proto__:null,value:array.length-1});}
const stringSlice=String.prototype.slice,stringIndexOf=String.prototype.indexOf;
const signalNames=Object.entries(constants.signals),NativeAbortController=AbortController,abort=AbortController.prototype.abort;
function mapRead<K,V>(map:Map<K,V>,key:K):V|undefined{return apply(mapGet,map,[key]) as V|undefined;}
function mapPut<K,V>(map:Map<K,V>,key:K,value:V):void{apply(mapSet,map,[key,value]);}
const get=WeakMap.prototype.get,set=WeakMap.prototype.set,records=new WeakMap<object,Row>(),children=new WeakMap<object,Row>(),held=createIntrinsicSet<Row>();
type Listener={fn:Function;once:boolean};
type Emitter={object:Record<string,unknown>;listeners:Map<string,Listener[]>};
interface Row {callbacks:ReturnType<typeof createProtectedChildCallbackCustody>;port:object;module:object;terminal:Function;methods:Record<string,Function>;child:Record<string,unknown>;events:Emitter;stdout:Emitter;stderr:Emitter;stock:ReturnType<typeof createRoomTurnCustody>;negative:ReturnType<typeof createRoomTurnCustody>;raw:unknown[];first?:{raw:unknown};launchEntered:boolean;launched:boolean;stopping:boolean;exited:boolean;joined:boolean;streams:boolean[];ipc:string;decoder:TextDecoder;out:{bytes:Buffer;offset:number;callback?:Function}[];frames:ReturnType<typeof createIntrinsicSet<ReturnType<typeof createRoomTurnCustody>>>;grace?:{controller:AbortController;reason:Error;aborted:boolean;stock:ReturnType<typeof createRoomTurnCustody>;negative:ReturnType<typeof createRoomTurnCustody>};loop?:Promise<void>;closing?:Promise<void>;done:Promise<void>;resolve:()=>void;reject:(raw:unknown)=>void}
function denied():never{throw Error('KSWARM_ORIGINAL_CHILD_SOURCE_REQUIRED');}
async function inventories(row:Row):Promise<void>{
 const stocks=[row.stock,row.negative,row.callbacks],frames=row.frames.snapshot();for(let index=0;index<frames.length;index++)appendIntrinsic(stocks,frames[index]!);
 const results=await settleIntrinsicOperations(stocks,stock=>stock.waitPhysicalKnown());let first:{raw:unknown}|undefined;
 for(let index=0;index<results.length;index++)if(results[index]!.status==='rejected'){const raw=(results[index] as PromiseRejectedResult).reason;appendIntrinsic(row.raw,raw);first??={raw};}
 if(first)throw first.raw;
}
function assertPhysical(row:Row):void{
 let first:{raw:unknown}|undefined;const check=(work:()=>void)=>{try{work();}catch(raw){appendIntrinsic(row.raw,raw);first??={raw};}};
 check(()=>{if(!row.joined)return denied();});check(()=>row.stock.assertPhysicalKnown());check(()=>row.negative.assertPhysicalKnown());check(()=>row.callbacks.assertPhysicalKnown());
 const frames=row.frames.snapshot();for(let index=0;index<frames.length;index++)check(()=>frames[index]!.assertPhysicalKnown());
 check(()=>{const raw=apply(row.terminal,row.module,[row.port]);inventory(row,raw,true);if(raw!==undefined)return denied();});
 if(first)throw first.raw;
}
async function waitPhysical(row:Row):Promise<void>{
 // A known business rejection never skips the independent resource joins.
 try{await row.done;}catch(raw){appendIntrinsic(row.raw,raw);}
 await inventories(row);assertPhysical(row);await row.negative.waitPhysicalKnown();assertPhysical(row);
}
function inventory(row:Row,raw:unknown,negative=false):void{(negative?row.negative:row.stock).inventory(raw);}
function remember(row:Row,raw:unknown):void{row.first??={raw};appendIntrinsic(row.raw,raw);inventory(row,raw);}
function invoke(row:Row,name:string,args:unknown[],negative=false):unknown{
 try{const raw=apply(row.methods[name]!,row.port,args);inventory(row,raw,negative);return raw;}catch(raw){remember(row,raw);inventory(row,raw,true);throw raw;}
}

function emit(row:Row,emitter:Emitter,name:string,args:unknown[]):void{
 const listeners=mapRead(emitter.listeners,name);if(!listeners)return;
 // A callback failure cannot skip the original sibling notification or close.
 const snapshot:Listener[]=[];for(let index=0;index<listeners.length;index++)appendIntrinsic(snapshot,listeners[index]!);for(let i=0;i<snapshot.length;i++){const listener=snapshot[i]!;if(listener.once){let at=-1;for(let index=0;index<listeners.length;index++)if(listeners[index]===listener){at=index;break;}if(at>=0)removeAt(listeners,at);}try{inventory(row,row.callbacks.invoke(listener.fn,emitter.object,args));}catch(raw){remember(row,raw);}}
}
function emitter(row:Row):Emitter{
 const value:Emitter={object:Object.create(null) as Record<string,unknown>,listeners:new NativeMap()};
 const add=(name:unknown,fn:unknown,once:boolean)=>{if(typeof name!=='string'||typeof fn!=='function'||types.isProxy(fn))return denied();row.callbacks.capture(fn);let list=mapRead(value.listeners,name);if(!list){list=[];mapPut(value.listeners,name,list);}appendIntrinsic(list,{fn,once});return value.object;};
 const on=(name:unknown,fn:unknown)=>add(name,fn,false),once=(name:unknown,fn:unknown)=>add(name,fn,true);
 const remove=(name:unknown,fn:unknown)=>{if(typeof name!=='string')return denied();const list=mapRead(value.listeners,name);if(list)for(let at=list.length-1;at>=0;at--)if(list[at]!.fn===fn)removeAt(list,at);return value.object;};
 const methods=[['on',on],['once',once],['removeListener',remove],['off',remove]] as const;for(let index=0;index<methods.length;index++){const name=methods[index]![0],fn=methods[index]![1];Object.freeze(fn);define(value.object,name,{__proto__:null,value:fn,enumerable:true});}return value;
}
function callbacksClosed(row:Row,raw:unknown):void{for(let i=0;i<row.out.length;i++){const fn=row.out[i]!.callback;if(fn)try{inventory(row,row.callbacks.invoke(fn,row.child,[raw]));}catch(error){remember(row,error);}}row.out.length=0;}
function signal(row:Row,name:unknown):boolean{
 const actual=name===undefined?'SIGTERM':name;if(actual!=='SIGTERM'&&actual!=='SIGKILL')return denied();if(row.exited)return false;
 invoke(row,'signal',[actual==='SIGTERM'?constants.signals.SIGTERM:constants.signals.SIGKILL],true);return true;
}
function stopGrace(row:Row):void{
 const grace=row.grace;if(!grace||grace.aborted)return;grace.aborted=true;
 try{grace.negative.syncVoid(abort,grace.controller,[grace.reason]);}catch(raw){remember(row,raw);}
}
function beginGrace(row:Row):void{
 if(row.grace||row.exited)return;
 const grace={controller:new NativeAbortController(),reason:Error('KSWARM_ORIGINAL_CHILD_GRACE_CANCELLED'),aborted:false,stock:createRoomTurnCustody(),negative:createRoomTurnCustody()};row.grace=grace;row.frames.add(grace.stock);row.frames.add(grace.negative);
 const work=(async()=>{
  try{await grace.stock.sdk(delay,undefined,[5000,undefined,{signal:grace.controller.signal}]);if(!row.exited)signal(row,'SIGKILL');}
  catch(raw){const cause=raw&&typeof raw==='object'&&!types.isProxy(raw)?descriptor(raw,'cause'):undefined,code=raw&&typeof raw==='object'&&!types.isProxy(raw)?descriptor(raw,'code'):undefined;
   if(!(row.exited&&grace.aborted&&cause&&own(cause,'value')&&cause.value===grace.reason&&code&&own(code,'value')&&code.value==='ABORT_ERR'))remember(row,raw);
  }
  const results=await settleIntrinsicOperations([grace.stock,grace.negative],stock=>stock.waitPhysicalKnown());let known=true;
  for(let index=0;index<results.length;index++)if(results[index]!.status==='rejected'){known=false;remember(row,(results[index] as PromiseRejectedResult).reason);}
  if(known){row.frames.delete(grace.stock);row.frames.delete(grace.negative);}
 })();apply(then,work,[undefined,(raw:unknown)=>remember(row,raw)]);
}
async function pump(row:Row):Promise<void>{
 try{
  for(;;){
   let failed=false,pollFailed=false;
   for(let stream=1;stream<=3;stream++){
    if(row.streams[stream-1])continue;
    try{for(;;){const raw=data(invoke(row,'read',[stream],true),['state','data']);if(typeof raw.data!=='string'||typeof raw.state!=='number')return denied();const bytes=apply(bufferFrom,Buffer,[raw.data,'latin1']) as Buffer;
     if(raw.state===2)break;
     if(raw.state===0){row.streams[stream-1]=true;if(stream===3){setField(row.child,'connected',false);emit(row,row.events,'disconnect',[]);}break;}
     if(raw.state!==1)return denied();
     if(stream<3)emit(row,stream===1?row.stdout:row.stderr,'data',[bytes]);
     else if(!row.stopping){row.ipc+=apply(decode,row.decoder,[bytes,{stream:true}]);for(;;){const end=apply(stringIndexOf,row.ipc,['\n']) as number;if(end<0)break;const line=apply(stringSlice,row.ipc,[0,end]) as string;row.ipc=apply(stringSlice,row.ipc,[end+1]) as string;const message=parse(line);inventory(row,message);emit(row,row.events,'message',[message]);}}
    }}catch(raw){remember(row,raw);failed=true;}
   }
   try{
    const observed=data(invoke(row,'poll',[],true),['pid','waitStatus','state']);
    if(typeof observed.pid!=='number'||typeof observed.waitStatus!=='number'||typeof observed.state!=='number')return denied();setField(row.child,'pid',observed.pid);
    if(observed.state===1&&!row.exited){row.exited=true;stopGrace(row);const status=observed.waitStatus,signalNumber=status&0x7f;let name:string|null=null;if(signalNumber!==0)for(let index=0;index<signalNames.length;index++)if(signalNames[index]![1]===signalNumber){name=signalNames[index]![0];break;}const code=signalNumber===0?(status>>8)&255:null;setField(row.child,'exitCode',code);setField(row.child,'signalCode',name);emit(row,row.events,'exit',[code,name]);}
   }catch(raw){remember(row,raw);failed=true;pollFailed=true;}
   if(!row.stopping&&!row.exited&&row.out.length){try{const item=row.out[0]!,chunk=apply(bufferSubarray,item.bytes,[item.offset,Math.min(item.offset+65536,item.bytes.length)]) as Buffer;const count=invoke(row,'write',[chunk]);if(typeof count!=='number'||!Number.isSafeInteger(count)||count<0||count>chunk.length)return denied();item.offset+=count;if(item.offset===item.bytes.length){removeAt(row.out,0);if(item.callback)try{inventory(row,row.callbacks.invoke(item.callback,row.child,[null]));}catch(raw){remember(row,raw);}}}catch(raw){remember(row,raw);failed=true;}}
   if(row.exited&&row.streams[0]&&row.streams[1]&&row.streams[2]){
    if(!row.stopping){row.ipc+=apply(decode,row.decoder,[]);if(row.ipc)remember(row,Error('KSWARM_ORIGINAL_CHILD_IPC_TRUNCATED'));}
    invoke(row,'join',[],true);row.joined=true;
    await inventories(row);
    const raw=apply(row.terminal,row.module,[row.port]);inventory(row,raw,true);if(raw!==undefined)return denied();
    emit(row,row.events,'close',[row.child.exitCode,row.child.signalCode]);
    await inventories(row);
    if(row.first)row.reject(row.first.raw);else{held.delete(row);row.resolve();}return;
   }
   if(failed&&!row.stopping){row.stopping=true;callbacksClosed(row,row.first?.raw);try{signal(row,'SIGTERM');}catch(raw){remember(row,raw);}beginGrace(row);}
   if(pollFailed&&row.streams[0]&&row.streams[1]&&row.streams[2])throw row.first?.raw;
   // Physical process observation, not an additional business scheduler.
   const frame=createRoomTurnCustody();row.frames.add(frame);
   try{await frame.sdk(delay,undefined,[20]);await frame.waitPhysicalKnown();row.frames.delete(frame);}catch(raw){remember(row,raw);throw raw;}
  }
 }catch(raw){remember(row,raw);callbacksClosed(row,raw);row.reject(row.first?row.first.raw:raw);}
}
/** Only the genuine native port is accepted; no caller SDK/factory/verifier. */
export async function createOriginalProtectedKSwarmChild(port:object):Promise<ChildProcess>{
 if(!port||typeof port!=='object'||types.isProxy(port)||apply(get,records,[port]))return denied();
 let resolve!:()=>void,reject!:(raw:unknown)=>void;const done=new NativePromise<void>((yes,no)=>{resolve=yes;reject=no;});define(done,'constructor',{__proto__:null,value:NativePromise});apply(then,done,[undefined,()=>{}]);
 const row:Row={callbacks:createProtectedChildCallbackCustody(),port,module:port,terminal:()=>{},methods:Object.create(null),child:Object.create(null),events:undefined!,stdout:undefined!,stderr:undefined!,stock:createRoomTurnCustody(),negative:createRoomTurnCustody(),raw:[],launchEntered:false,launched:false,stopping:false,exited:false,joined:false,streams:[false,false,false],frames:createIntrinsicSet(),ipc:'',decoder:new TextDecoder('utf-8',{fatal:true}),out:[],done,resolve,reject};apply(set,records,[port,row]);held.add(row);
 try{
  // Exact fixed Main addon; neither path nor API can be supplied by the caller.
  const module=requireFixed(join(dirname(fileURLToPath(import.meta.url)),'main_bootstrap.node')) as object;row.module=module;
  const assert=method(module,'assertOriginalKSwarmChildPort');const asserted=apply(assert,module,[port]);inventory(row,asserted);if(asserted!==undefined)return denied();row.terminal=method(module,'assertOriginalKSwarmChildTerminal');
  const names=['launch','poll','read','write','signal','join','cancel'];for(let index=0;index<names.length;index++){const name=names[index]!;row.methods[name]=method(port,name);}
  row.events=emitter(row);row.child=row.events.object;row.stdout=emitter(row);row.stderr=emitter(row);
  const fields=[['connected',true],['exitCode',null],['signalCode',null],['killed',false],['pid',undefined]] as const;for(let index=0;index<fields.length;index++)setField(row.child,fields[index]![0],fields[index]![1]);
  const send=(message:unknown,callback?:unknown)=>{if(callback!==undefined&&(typeof callback!=='function'||types.isProxy(callback)))return denied();if(row.stopping||row.exited||row.first)throw Error('KSWARM_ORIGINAL_CHILD_CLOSED');const raw=stringify(message);inventory(row,raw);if(typeof raw!=='string')return denied();if(typeof callback==='function')row.callbacks.capture(callback);appendIntrinsic(row.out,{bytes:apply(bufferFrom,Buffer,[raw+'\n']) as Buffer,offset:0,...(typeof callback==='function'?{callback}:{})});return true;};
  const kill=(name?:unknown)=>{row.stopping=true;setField(row.child,'killed',true);callbacksClosed(row,Error('KSWARM_ORIGINAL_CHILD_CLOSED'));return signal(row,name);};
  const values=[['stdout',row.stdout.object],['stderr',row.stderr.object],['send',Object.freeze(send)],['kill',Object.freeze(kill)]] as const;for(let index=0;index<values.length;index++){const name=values[index]![0],value=values[index]![1];define(row.child,name,{__proto__:null,value,enumerable:true});}
  apply(set,children,[row.child,row]);row.launchEntered=true;invoke(row,'launch',[]);row.launched=true;
  const state=data(invoke(row,'poll',[],true),['pid','waitStatus','state']);setField(row.child,'pid',state.pid);
  row.loop=pump(row);apply(then,row.loop,[undefined,(raw:unknown)=>remember(row,raw)]);return row.child as unknown as ChildProcess;
 }catch(raw){remember(row,raw);row.stopping=true;if(row.launchEntered&&!row.loop){try{signal(row,'SIGTERM');}catch(error){remember(row,error);}row.loop=pump(row);apply(then,row.loop,[undefined,(error:unknown)=>remember(row,error)]);}else if(!row.launchEntered){try{invoke(row,'cancel',[],true);row.joined=true;row.reject(raw);}catch(error){remember(row,error);row.reject(raw);}}throw raw;}
}
/** Fixed negative consumer. It never asks a revoked positive Source to stop. */
export async function closeOriginalProtectedKSwarmChild(value:unknown):Promise<void>{
 const row=value&&typeof value==='object'?(apply(get,records,[value])??apply(get,children,[value])) as Row|undefined:undefined;if(!row)return denied();
 if(row.closing)return row.closing;
 let yes!:()=>void,no!:(raw:unknown)=>void;row.closing=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});define(row.closing,'constructor',{__proto__:null,value:NativePromise});
 const operation=(async()=>{try{
  row.stopping=true;callbacksClosed(row,Error('KSWARM_ORIGINAL_CHILD_CLOSED'));
  if(!row.launchEntered){invoke(row,'cancel',[],true);row.joined=true;row.resolve();}
  else if(!row.exited){try{signal(row,'SIGTERM');}catch(raw){remember(row,raw);}beginGrace(row);}
  try{await row.done;}catch(raw){remember(row,raw);}await waitPhysical(row);
  if(row.first)throw row.first.raw;yes();
 }catch(raw){remember(row,raw);no(row.first?row.first.raw:raw);}})();apply(then,operation,[undefined,(raw:unknown)=>remember(row,raw)]);return row.closing;
}
/** Optional only for absence: an entered failed Source remains a member. */
export function readOptionalOriginalProtectedKSwarmChildPortFate(port:unknown):Readonly<{waitPhysicalKnown():Promise<void>;assertPhysicalKnown():void}>|null{
 const row=port&&typeof port==='object'?apply(get,records,[port]) as Row|undefined:undefined;if(!row)return null;
 return Object.freeze({waitPhysicalKnown:()=>waitPhysical(row),assertPhysicalKnown:()=>assertPhysical(row)});
}
/** Original child membership first; copies and public fields never grant fate. */
export function readOriginalProtectedKSwarmChildPhysicalFate(child:unknown):Readonly<{waitKnown():Promise<void>;assertKnown():void}>{
 const row=child&&typeof child==='object'?apply(get,children,[child]) as Row|undefined:undefined;if(!row)return denied();
 return Object.freeze({waitKnown:()=>waitPhysical(row),assertKnown:()=>assertPhysical(row)});
}
