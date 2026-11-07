import {EventEmitter} from 'node:events';
import {expect,it} from 'vitest';
import {setTimeout as delay} from 'node:timers/promises';
import {createKSwarmWriterControlSource,readKSwarmWriterControlBootstrap} from '../../electron/kswarm-writer-control-source.js';
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
function view(){const wc=Object.assign(new EventEmitter(),{mainFrame:{url:'file:///original/index.html'},isDestroyed:()=>false,isLoadingMainFrame:()=>false});const window=Object.assign(new EventEmitter(),{webContents:wc,isDestroyed:()=>false});return{window,wc,event:{sender:wc,senderFrame:wc.mainFrame}};}
it('original source drain cannot forget a real raw when its dependency changes Set.add',async()=>{
 const v=view();let release!:()=>void;const raw=new Promise<void>(yes=>{release=yes;}),original=Set.prototype.add;
 const source=createKSwarmWriterControlSource({getWindow:(()=>{Set.prototype.add=function(value:unknown){if(value&&typeof value==='object'&&Object.getOwnPropertyDescriptor(value,'raw')?.value===raw)return this;return Reflect.apply(original,this,[value]);};return raw;}) as never,getScope:()=>scope,isTrustedUrl:()=>true});source.bindService({} as never);
 try{expect(()=>source.openInspect(v.event as never,'user')).toThrow('WRITER_CONTROL_SYNCHRONOUS_SOURCE_REQUIRED');}finally{Set.prototype.add=original;}
 let done=false;const closing=source.drain().then(()=>{done=true;});try{await delay(20);expect(done).toBe(false);}finally{release();await closing;}
});
it('original source still reports an unobservable raw after its dependency changes Set.add',async()=>{
 const v=view();let hooks=0;const raw={get then(){hooks++;throw Error('unobservable raw');}},original=Set.prototype.add;
 const source=createKSwarmWriterControlSource({getWindow:(()=>{Set.prototype.add=function(value:unknown){if(value===raw)return this;return Reflect.apply(original,this,[value]);};return raw;}) as never,getScope:()=>scope,isTrustedUrl:()=>true});source.bindService({} as never);
 try{expect(()=>source.openInspect(v.event as never,'user')).toThrow('WRITER_CONTROL_SYNCHRONOUS_SOURCE_REQUIRED');}finally{Set.prototype.add=original;}
 await expect(source.drain()).rejects.toThrow('WRITER_CONTROL_SOURCE_TAIL_UNKNOWN');expect(hooks).toBe(0);
});
it('source seal still aborts its own original frame and disposes listeners under Set iterator replacement',async()=>{
 const v=view(),source=createKSwarmWriterControlSource({getWindow:()=>v.window as never,getScope:()=>scope,isTrustedUrl:()=>true});source.bindService({} as never);const frame=source.openInspect(v.event as never,'user'),original=Set.prototype[Symbol.iterator];
 Set.prototype[Symbol.iterator]=function(){const first=Reflect.apply(original,this,[]).next().value;const relevant=first&&typeof first==='object'&&(Object.getOwnPropertyDescriptor(first,'contents')?.value===v.wc||Object.getOwnPropertyDescriptor(first,'abort')?.value?.signal===frame.context.signal);return relevant?[][Symbol.iterator]():Reflect.apply(original,this,[]);};
 try{source.seal();}finally{Set.prototype[Symbol.iterator]=original;}
 expect(frame.context.signal.aborted).toBe(true);expect(v.wc.listenerCount('did-start-navigation')).toBe(0);expect(v.window.listenerCount('closed')).toBe(0);await source.drain();
});
it('one original listener disposal error does not skip sibling windows or become a successful source drain',async()=>{
 const first=view(),second=view();let current=first;const source=createKSwarmWriterControlSource({getWindow:()=>current.window as never,getScope:()=>scope,isTrustedUrl:()=>true});source.bindService({} as never);
 const original=source.openInspect(first.event as never,'user');current=second;const other=source.openInspect(second.event as never,'user');const off=first.wc.off.bind(first.wc),cause=Error('original listener disposal failed');
 first.wc.off=((name:string|symbol,fn:(...args:any[])=>void)=>{if(name==='did-start-navigation')throw cause;return off(name,fn);}) as typeof first.wc.off;
 try{try{source.seal();}catch{}await expect(source.drain()).rejects.toBe(cause);expect(second.wc.listenerCount('did-start-navigation')).toBe(0);expect(first.wc.listenerCount('did-frame-finish-load')).toBe(0);expect(original.context.signal.aborted).toBe(true);expect(other.context.signal.aborted).toBe(true);}finally{first.wc.off=off;first.wc.removeAllListeners();first.window.removeAllListeners();second.wc.removeAllListeners();second.window.removeAllListeners();}
});

it('known absence of a Main window denies bootstrap without poisoning replacement or inventing a raw tail',async()=>{
 const v=view();let current:typeof v.window|null=null;const service={},source=createKSwarmWriterControlSource({getWindow:()=>current as never,getScope:()=>scope,isTrustedUrl:()=>true});source.bindService(service as never);
 expect(()=>readKSwarmWriterControlBootstrap(source,service as never)).toThrow('WRITER_CONTROL_AUTHORITY_REQUIRED');current=v.window;
 expect(readKSwarmWriterControlBootstrap(source,service as never).window).toBe(v.window);const frame=source.openInspect(v.event as never,'user');frame.release();await source.drain();
});
