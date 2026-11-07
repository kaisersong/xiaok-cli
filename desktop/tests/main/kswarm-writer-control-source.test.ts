import {EventEmitter} from 'node:events';
import {describe,it,expect} from 'vitest';
import {createKSwarmWriterControlSource} from '../../electron/kswarm-writer-control-source.js';
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
function view(){
 const wc=Object.assign(new EventEmitter(),{mainFrame:{url:'file:///owned/index.html'},isDestroyed:()=>false,isLoadingMainFrame:()=>false});
 const window=Object.assign(new EventEmitter(),{webContents:wc,isDestroyed:()=>false});
 return{window,event:{sender:wc,senderFrame:wc.mainFrame}};
}
function fixture(){
 let current=view(),domain={...scope};const service={},source=createKSwarmWriterControlSource({getWindow:()=>current.window as never,getScope:()=>domain,isTrustedUrl:url=>url==='file:///owned/index.html'});
 source.bindService(service as never);
 return{source,service,get current(){return current;},replace(){current=view();return current;},setScope(value:typeof scope){domain=value;}};
}
describe('original Main-only writer configuration source',()=>{
 it('issues a fixed-operation private proof bound to the original service and exact scope',()=>{
  const f=fixture(),frame=f.source.openInspect(f.current.event as never,'user');
  const audience={operation:'inspect_writer' as const,scope,serviceOwner:f.service};
  expect(f.source.admission(frame.context.admission,audience)).toBeUndefined();
  expect(()=>f.source.admission({...frame.context.admission},audience)).toThrow('WRITER_CONTROL_AUTHORITY_REQUIRED');
  expect(()=>f.source.admission(frame.context.admission,{...audience,serviceOwner:{}})).toThrow('WRITER_CONTROL_AUTHORITY_REQUIRED');
  expect(()=>f.source.admission(frame.context.admission,{...audience,operation:'prepare_initial_plan_writer'})).toThrow('WRITER_CONTROL_AUTHORITY_REQUIRED');
  expect(()=>f.source.admission(frame.context.admission,{...audience,scope:{...scope,workspaceId:'c'.repeat(64)}})).toThrow('WRITER_CONTROL_AUTHORITY_REQUIRED');
  frame.release();expect(()=>f.source.admission(frame.context.admission,audience)).toThrow('WRITER_CONTROL_AUTHORITY_REQUIRED');
 });
 it('rejects agent, scheduler, recorder, foreign window, subframe and untrusted URL',()=>{
  const f=fixture();for(const who of ['agent','scheduler'])expect(()=>f.source.openPrepare(f.current.event as never,who as never)).toThrow('WRITER_CONTROL_AUTHORITY_REQUIRED');
  const other=view();for(const event of [other.event,{sender:f.current.window.webContents,senderFrame:{}},{}])expect(()=>f.source.openPrepare(event as never,'user')).toThrow('WRITER_CONTROL_AUTHORITY_REQUIRED');
  f.current.window.webContents.mainFrame.url='https://foreign.example/';expect(()=>f.source.openInspect(f.current.event as never,'user')).toThrow('WRITER_CONTROL_AUTHORITY_REQUIRED');
 });
 it('navigation to the same URL revokes the old frame permanently and waits for actual main-frame load',()=>{
  const f=fixture(),old=f.source.openPrepare(f.current.event as never,'user'),wc=f.current.window.webContents;
  wc.emit('did-start-navigation',{},wc.mainFrame.url,false,true,1,1);
  expect(old.context.signal.aborted).toBe(true);expect(()=>old.assertCurrent()).toThrow();
  expect(()=>f.source.openInspect(f.current.event as never,'user')).toThrow('WRITER_CONTROL_AUTHORITY_REQUIRED');
  wc.emit('did-frame-finish-load',{},true,1,1);
  const fresh=f.source.openInspect(f.current.event as never,'user');expect(()=>fresh.assertCurrent()).not.toThrow();expect(()=>old.assertCurrent()).toThrow();fresh.release();old.release();
 });
 it('a replacement Main window may issue fresh events while the original frame never revives',()=>{
  const f=fixture(),old=f.source.openInspect(f.current.event as never,'user'),original=f.current;
  f.replace();expect(()=>old.assertCurrent()).toThrow('WRITER_CONTROL_AUTHORITY_REQUIRED');
  const fresh=f.source.openInspect(f.current.event as never,'user');expect(()=>fresh.assertCurrent()).not.toThrow();
  original.window.webContents.emit('destroyed');expect(fresh.context.signal.aborted).toBe(false);expect(()=>fresh.assertCurrent()).not.toThrow();fresh.release();old.release();
 });
 it('scope changes, renderer loss and shutdown revoke the actual admitted operation',async()=>{
  const f=fixture(),old=f.source.openPrepare(f.current.event as never,'user');f.setScope({...scope,profileId:'c'.repeat(64)});expect(()=>old.assertCurrent()).toThrow();old.release();
  f.setScope(scope);const frame=f.source.openInspect(f.current.event as never,'user');f.current.window.webContents.emit('render-process-gone',{},{});expect(frame.context.signal.aborted).toBe(true);frame.release();
  f.current.window.webContents.emit('did-frame-finish-load',{},true,1,1);const closing=f.source.openInspect(f.current.event as never,'user');f.source.seal();expect(closing.context.signal.aborted).toBe(true);await f.source.drain();
  expect(()=>f.source.openInspect(f.current.event as never,'user')).toThrow();
 });
 it('does not allow a second service binding or missing installation to issue permissions',()=>{
  const f=fixture();expect(()=>f.source.bindService({} as never)).toThrow('WRITER_CONTROL_SERVICE_ALREADY_BOUND');
  const v=view(),source=createKSwarmWriterControlSource({getWindow:()=>v.window as never,getScope:()=>scope,isTrustedUrl:()=>true});expect(()=>source.openInspect(v.event as never,'user')).toThrow('WRITER_CONTROL_AUTHORITY_REQUIRED');source.seal();
 });
 it('an older load event cannot reopen admission while the actual current main frame is still loading',()=>{
  const f=fixture(),wc=f.current.window.webContents;const frame=f.source.openPrepare(f.current.event as never,'user');
  wc.emit('did-start-navigation',{},wc.mainFrame.url,false,true,1,1);wc.emit('did-start-navigation',{},wc.mainFrame.url,false,true,1,1);
  let loading=true;wc.isLoadingMainFrame=()=>loading;wc.emit('did-frame-finish-load',{},true,1,1);
  expect(()=>f.source.openInspect(f.current.event as never,'user')).toThrow('WRITER_CONTROL_AUTHORITY_REQUIRED');
  loading=false;expect(()=>f.source.openInspect(f.current.event as never,'user')).toThrow('WRITER_CONTROL_AUTHORITY_REQUIRED');
  wc.emit('did-frame-finish-load',{},true,1,1);const fresh=f.source.openInspect(f.current.event as never,'user');fresh.release();frame.release();
 });
 it('a swallowed synchronous source reentry poisons the original issuance before a proof can escape',()=>{
  const v=view();let armed=false,inner:unknown,source:ReturnType<typeof createKSwarmWriterControlSource>;
  source=createKSwarmWriterControlSource({getWindow:()=>{if(armed){armed=false;try{source.openInspect(v.event as never,'user');}catch(error){inner=error;}}return v.window as never;},getScope:()=>scope,isTrustedUrl:()=>true});source.bindService({} as never);
  armed=true;expect(()=>source.openPrepare(v.event as never,'user')).toThrow('WRITER_CONTROL_SYNCHRONOUS_SOURCE_REQUIRED');expect(inner).toBeInstanceOf(Error);expect(()=>source.openInspect(v.event as never,'user')).toThrow('WRITER_CONTROL_SYNCHRONOUS_SOURCE_REQUIRED');source.seal();
 });
 it('an ingress timeout reports unconfirmed cleanup while retaining its original held source tail',async()=>{
  let release!:()=>void;const raw=new Promise<void>(resolve=>{release=resolve;}),v=view();
  const source=createKSwarmWriterControlSource({getWindow:(()=>raw) as never,getScope:()=>scope,isTrustedUrl:()=>true});source.bindService({} as never);
  expect(()=>source.openInspect(v.event as never,'user')).toThrow();expect(await source.ingress.drain(5)).toBe(false);release();await source.drain();
 });
 it('rejects an explicit async dependency before entering its body',()=>{
  let entered=0;expect(()=>createKSwarmWriterControlSource({getWindow:(async()=>{entered++;return null;}) as never,getScope:()=>scope,isTrustedUrl:()=>true})).toThrow('WRITER_CONTROL_SYNCHRONOUS_SOURCE_REQUIRED');expect(entered).toBe(0);
 });
 it('does not return current permission after the last getWindow callback revokes the same frame',()=>{
  const v=view();let calls=0,armed=false;
  const source=createKSwarmWriterControlSource({getWindow:()=>{if(armed&&++calls===2)v.window.webContents.emit('did-start-navigation',{},v.window.webContents.mainFrame.url,false,true,1,1);return v.window as never;},getScope:()=>scope,isTrustedUrl:()=>true});source.bindService({} as never);
  const frame=source.openInspect(v.event as never,'user');armed=true;expect(()=>frame.assertCurrent()).toThrow();expect(frame.context.signal.aborted).toBe(true);frame.release();source.seal();
 });
 it('an admission cannot outlive a revocation in its final scope dependency callback',()=>{
  const v=view();let calls=0,armed=false,revoked=false;
  const source=createKSwarmWriterControlSource({getWindow:()=>v.window as never,getScope:()=>{if(armed&&++calls===2){revoked=true;source.seal();}return scope;},isTrustedUrl:()=>true}),service={};source.bindService(service as never);
  const frame=source.openInspect(v.event as never,'user');armed=true;let granted=false;try{source.admission(frame.context.admission,{operation:'inspect_writer',scope,serviceOwner:service});granted=true;}catch{}
  expect(granted&&revoked).toBe(false);frame.release();source.seal();
 });
 it('a swallowed reentry cannot discard the actual raw Promise returned afterward by that callback',async()=>{
  const v=view();let armed=false,reject!:(error:unknown)=>void,source:ReturnType<typeof createKSwarmWriterControlSource>;
  const raw=new Promise((_,no)=>{reject=no;});
  source=createKSwarmWriterControlSource({getWindow:(()=>{if(armed){armed=false;try{source.openInspect(v.event as never,'user');}catch{}return raw;}return v.window;}) as never,getScope:()=>scope,isTrustedUrl:()=>true});source.bindService({} as never);
  armed=true;expect(()=>source.openInspect(v.event as never,'user')).toThrow();let finished=false;const cause=Error('returned raw after swallowed reentry');
  const draining=source.drain().then(()=>{finished=true;},error=>{finished=true;throw error;}),checked=expect(draining).rejects.toBe(cause);
  await new Promise(resolve=>setTimeout(resolve,10));const early=finished;reject(cause);await checked;expect(early).toBe(false);
 });
 it('retains an accidental ordinary-function raw Promise until its true late rejection',async()=>{
  let reject!:(error:unknown)=>void;const raw=new Promise((_,no)=>{reject=no;}),v=view();
  const source=createKSwarmWriterControlSource({getWindow:(()=>raw) as never,getScope:()=>scope,isTrustedUrl:()=>true});source.bindService({} as never);
  expect(()=>source.openInspect(v.event as never,'user')).toThrow('WRITER_CONTROL_SYNCHRONOUS_SOURCE_REQUIRED');
  let complete=false;const cause=Error('actual late source rejection'),draining=source.drain().then(()=>{complete=true;},error=>{complete=true;throw error;});const checked=expect(draining).rejects.toBe(cause);
  await new Promise(resolve=>setTimeout(resolve,10));expect(complete).toBe(false);reject(cause);await checked;
 });
 it('keeps a nonstandard thenable unknown without invoking hooks or claiming a drain',async()=>{
  let reads=0;const raw={get then(){reads++;return ()=>undefined;}},v=view();
  const source=createKSwarmWriterControlSource({getWindow:(()=>raw) as never,getScope:()=>scope,isTrustedUrl:()=>true});source.bindService({} as never);
  expect(()=>source.openInspect(v.event as never,'user')).toThrow('WRITER_CONTROL_SYNCHRONOUS_SOURCE_REQUIRED');await expect(source.drain()).rejects.toThrow('WRITER_CONTROL_SOURCE_TAIL_UNKNOWN');expect(reads).toBe(0);
 });
 it('a scope dependency thenable is retained as unknown without reading its then getter',async()=>{
  const v=view();let reads=0;const raw={get then(){reads++;return ()=>undefined;}};
  const source=createKSwarmWriterControlSource({getWindow:()=>v.window as never,getScope:(()=>raw) as never,isTrustedUrl:()=>true});source.bindService({} as never);
  expect(()=>source.openInspect(v.event as never,'user')).toThrow();await expect(source.drain()).rejects.toThrow('WRITER_CONTROL_SOURCE_TAIL_UNKNOWN');expect(reads).toBe(0);
 });
});
