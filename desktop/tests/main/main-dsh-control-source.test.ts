// @vitest-environment node
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Hash} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
const native=vi.hoisted(()=>({ready:true,windows:[] as any[]}));
vi.mock('electron',()=>{const BrowserWindow=Object.assign(function BrowserWindow(){},{getAllWindows(){return native.windows;},fromId(id:number){return native.windows.find(w=>w.id===id);},fromWebContents(wc:unknown){return native.windows.find(w=>w.webContents===wc);}});const api={app:{isReady(){return native.ready;}},BrowserWindow,webContents:{fromId(id:number){return native.windows.map(w=>w.webContents).find(w=>w.id===id);}}};return {default:api,...api};});
// Deliberate missing-export red calls the real module; no replacement Source.
const modulePath='../../electron/main-dsh-control-source.js';
const api:Record<string,any>=await import(/* @vite-ignore */ modulePath).catch(error=>{
 if(String(error?.code).includes('MODULE_NOT_FOUND')||String(error?.message).includes('Cannot find module'))return {};
 throw error;
});
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
const purpose='mandate_control';
const disposals:Array<()=>unknown>=[];
afterEach(async()=>{for(const close of disposals.splice(0).reverse())try{await close();}catch{}native.windows=[];native.ready=true;vi.restoreAllMocks();});
function view(){const contents=Object.assign(new EventEmitter(),{id:2,session:{},mainFrame:{url:'file:///owned/index.html'},isDestroyed:():boolean=>false,isLoadingMainFrame:():boolean=>false});const window=Object.assign(new EventEmitter(),{id:1,webContents:contents,isDestroyed:():boolean=>false});return {window,contents,event:{sender:contents,senderFrame:contents.mainFrame}};}
function fixture(policy:(url:string)=>boolean=()=>true,bind=true){
 expect(api.createMainDshControlSource).toBeTypeOf('function');
 const v=view();native.windows=[v.window];const source=api.createMainDshControlSource({window:v.window,scope,isTrustedUrl:policy});
 const root=mkdtempSync(join(tmpdir(),'dsh-main-control-'));disposals.push(()=>rmSync(root,{recursive:true,force:true}));
 const store=new DesktopMultiAgentStore(join(root,'groups.sqlite'),{dshAdmissionSource:source});
 disposals.push(()=>store.close());disposals.push(()=>source.drain());if(bind)source.bindStore(store);
 return {...v,source,store};
}
function open(f:ReturnType<typeof fixture>,body:unknown={schemaVersion:1,expectedHeadRevision:0},p=purpose){return f.source.open(f.event,p,body,'user');}
function read(f:ReturnType<typeof fixture>,frame:any,p=purpose,store:unknown=f.store,hash=frame.bodyHash){return api.readOriginalMainDshControl(f.source,frame.proof,store,p,hash);}
it('exports a distinct Main DSH control Source and its fixed private reader',()=>{expect(api.createMainDshControlSource).toBeTypeOf('function');expect(api.readOriginalMainDshControl).toBeTypeOf('function');});
it.each(['enroll_authority','mandate_control','policy_control'])('binds real original Store identity and complete %s request',p=>{
 const f=fixture(),body={schemaVersion:1,nested:{value:'request'}},frame=open(f,body,p),actual=read(f,frame,p);
 expect(actual.storageScope).toEqual(scope);expect(actual.principalId).toBe('desktop-user:'+scope.profileId);expect(actual.purpose).toBe(p);expect(actual.bodyHash).toMatch(/^[a-f0-9]{64}$/);
 expect(actual).not.toHaveProperty('authorityEpoch');expect(actual).not.toHaveProperty('authorityId');
 expect(f.source.resolve(frame.proof,p).data).toEqual(body);expect(Object.isFrozen(f.source.resolve(frame.proof,p).data.nested)).toBe(true);
 expect(actual.assertCurrent()).toBeUndefined();expect(actual.assertLocal()).toBeUndefined();
});
it('does not copy renderer body changes and hashes all fields and purpose',()=>{
 const f=fixture(),body={a:{value:'before'},extra:'one'},one=open(f,body);body.a.value='after';
 expect(f.source.resolve(one.proof,purpose).data.a.value).toBe('before');
 expect(open(f,body).bodyHash).not.toBe(one.bodyHash);expect(open(f,{a:{value:'before'},extra:'two'}).bodyHash).not.toBe(one.bodyHash);
 expect(open(f,{extra:'one',a:{value:'before'}}).bodyHash).toBe(one.bodyHash);expect(open(f,{a:{value:'before'},extra:'one'},'policy_control').bodyHash).not.toBe(one.bodyHash);
});
it('refuses missing and different Store bindings, and does not accept a shaped Store',()=>{
 const f=fixture(()=>true,false);expect(()=>open(f)).toThrow();let hooks=0;const fake=new Proxy({},{get(){hooks++;throw Error('trap');}});
 expect(()=>f.source.bindStore(fake)).toThrow();expect(hooks).toBe(0);f.source.bindStore(f.store);expect(()=>f.source.bindStore(f.store)).not.toThrow();
 const other=fixture();expect(()=>f.source.bindStore(other.store)).toThrow();
});
it('checks private Source and proof membership before touching hostile arguments',()=>{
 expect(api.readOriginalMainDshControl).toBeTypeOf('function');let hooks=0;const foreign=new Proxy({},{get(){hooks++;throw Error('trap');},getPrototypeOf(){hooks++;throw Error('trap');}});
 expect(()=>api.readOriginalMainDshControl(foreign,foreign,foreign,foreign,foreign)).toThrow();const f=fixture();expect(()=>api.readOriginalMainDshControl(f.source,foreign,foreign,foreign,foreign)).toThrow();expect(hooks).toBe(0);
 const frame=open(f);expect(()=>read(f,frame,'policy_control')).toThrow();expect(()=>read(f,frame,purpose,{})).toThrow();expect(()=>read(f,frame,purpose,f.store,'0'.repeat(64))).toThrow();
 expect(()=>f.source.resolve({},purpose)).toThrow();expect(()=>f.source.resolve(frame.proof,'policy_control')).toThrow();
});
it.each(['agent','scheduler'])('rejects %s before reading event or body',requestSource=>{const f=fixture();let hits=0;const hostile=new Proxy({},{get(){hits++;throw Error('trap');},getOwnPropertyDescriptor(){hits++;throw Error('trap');}});expect(()=>f.source.open(hostile,purpose,hostile,requestSource)).toThrow();expect(hits).toBe(0);});
it('rejects a foreign Native sender, subframe, loading window and unknown purpose',()=>{
 const f=fixture();expect(()=>f.source.open({...f.event,sender:{}},purpose,{},'user')).toThrow();expect(()=>f.source.open({...f.event,senderFrame:{}},purpose,{},'user')).toThrow();
 f.contents.isLoadingMainFrame=()=>true;expect(()=>open(f)).toThrow();f.contents.isLoadingMainFrame=()=>false;expect(()=>open(f,{},'dispatch_current_plan')).toThrow();
});
it.each(['did-start-navigation','render-process-gone','destroyed'])('revokes a prior DSH frame on %s and never restores it',event=>{
 const f=fixture(),frame=open(f);f.contents.emit(event,{},f.contents.mainFrame.url,false,true);expect(frame.signal.aborted).toBe(true);expect(()=>read(f,frame)).toThrow();f.contents.emit('did-stop-loading');expect(()=>read(f,frame)).toThrow();
});
it('rejects closed and released frames at the local and current reader',()=>{const f=fixture(),frame=open(f),actual=read(f,frame);frame.release();expect(frame.signal.aborted).toBe(true);expect(()=>actual.assertLocal()).toThrow();expect(()=>read(f,frame)).toThrow();const next=open(f);f.source.seal();expect(()=>read(f,next)).toThrow();expect(()=>open(f)).toThrow();});
it('rejects body getters without invoking them and enforces JSON/depth/size bounds',()=>{
 const f=fixture();let hits=0;const bad={get value(){hits++;return 1;}};expect(()=>open(f,bad)).toThrow();expect(hits).toBe(0);
 for(const body of [{value:undefined},{value:1n},{value:NaN},{value:-0},{value:'\ud800'},Array(2),{value:'x'.repeat(262145)}])expect(()=>open(f,body)).toThrow();
 let deep:any={};for(let i=0;i<34;i++)deep={child:deep};expect(()=>open(f,deep)).toThrow();expect(()=>open(f,{allowed:true})).not.toThrow();
});
it('ends a reentrant trusted URL read with a pure local gate',()=>{let armed=false;let f:ReturnType<typeof fixture>;f=fixture(()=>{if(armed)f.source.seal();return true;});const frame=open(f);armed=true;expect(()=>read(f,frame)).toThrow();expect(frame.signal.aborted).toBe(true);});
it('preserves throw undefined presence from Native SDK and permanently rejects new frames',async()=>{
 const f=fixture(),frame=open(f);vi.spyOn(f.contents,'isLoadingMainFrame').mockImplementation(()=>{throw undefined;});let present=false,raw:unknown=Error('not-thrown');try{read(f,frame);}catch(error){present=true;raw=error;}expect(present).toBe(true);expect(raw).toBeUndefined();vi.restoreAllMocks();expect(()=>open(f)).toThrow();let failed=false;try{await f.source.drain();}catch(error){failed=true;expect(error).toBeUndefined();}expect(failed).toBe(true);
});
it('waits for both original SDK error tails and outcome-born tails before drain',async()=>{
 const f=fixture(),frame=open(f);let first!:(value:unknown)=>void,side!:()=>void,last!:()=>void;
 const a=new Promise(yes=>{first=yes;}),b=new Promise<void>(yes=>{side=yes;}),c=new Promise<void>(yes=>{last=yes;});const error=Error('native-original');Object.defineProperty(error,'raw',{value:a});Object.defineProperty(error,Symbol('side'),{value:b});
 vi.spyOn(f.contents,'isLoadingMainFrame').mockImplementation(()=>{throw error;});expect(()=>read(f,frame)).toThrow(error);let done=false;const drain=f.source.drain().then(()=>{done=true;},()=>{done=true;});
 try{await new Promise<void>(yes=>setImmediate(yes));expect(done).toBe(false);first({outcome:c});side();await new Promise<void>(yes=>setImmediate(yes));expect(done).toBe(false);last();await drain;expect(done).toBe(true);}finally{first(undefined);side();last();await drain;}
});
it('checks Native membership before consulting a trusted URL policy',()=>{let calls=0;const f=fixture(()=>{calls++;return true;});native.windows=[];expect(()=>open(f)).toThrow();expect(calls).toBe(0);});
it('does not borrow a dispatch proof even from the same Native window',async()=>{
 const {createDefaultDispatchUserSource}=await import('../../electron/default-dispatch-user-source.js');const f=fixture(),old=createDefaultDispatchUserSource({window:f.window as never,scope,isTrustedUrl:()=>true});disposals.push(()=>old.drain());const proof=old.open(f.event as never,'project','user').proof;
 expect(()=>api.readOriginalMainDshControl(f.source,proof,f.store,purpose,'0'.repeat(64))).toThrow();expect(()=>f.source.resolve(proof,purpose)).toThrow();
});
it('keeps Native session identity and refuses a missing registered window',()=>{const f=fixture(),frame=open(f);f.contents.session={};expect(()=>read(f,frame)).toThrow();});
it('denies both a late unready app and a denied URL',()=>{const f=fixture(()=>false);expect(()=>open(f)).toThrow();const other=fixture();native.ready=false;expect(()=>open(other)).toThrow();});
it('bounds sparse and enormous arrays before allocating an IPC copy',()=>{const f=fixture();expect(()=>open(f,Array(0xffffffff))).toThrow();expect(()=>open(f,Array.from({length:16385},()=>1))).toThrow();expect(()=>open(f,{a:true})).not.toThrow();});
it('refuses methods with async, bound-async and Proxy URL policy without running them',()=>{
 expect(api.createMainDshControlSource).toBeTypeOf('function');const v=view();native.windows=[v.window];let hits=0;const asyncPolicy=async()=>{hits++;return true;};const proxy=new Proxy(()=>true,{apply(){hits++;return true;}});
 for(const isTrustedUrl of [asyncPolicy,asyncPolicy.bind(null),proxy])expect(()=>api.createMainDshControlSource({window:v.window,scope,isTrustedUrl})).toThrow();expect(hits).toBe(0);
});
it('does not let a last Native session getter seal and still deliver a view',()=>{const f=fixture(),frame=open(f),session=f.contents.session;Object.defineProperty(f.contents,'session',{configurable:true,get(){f.source.seal();return session;}});expect(()=>read(f,frame)).toThrow();});
it('owns returned SDK Promise own symbol siblings and stack-data errors',async()=>{
 const f=fixture(),frame=open(f);let first!:()=>void,second!:()=>void;const a=new Promise<void>(yes=>{first=yes;}),b=new Promise<void>(yes=>{second=yes;});Object.defineProperty(a,Symbol('sibling'),{value:b});vi.spyOn(f.contents,'isLoadingMainFrame').mockReturnValue(a as never);expect(()=>read(f,frame)).toThrow();let done=false;const drain=f.source.drain().then(()=>{done=true;},()=>{done=true;});
 try{first();await new Promise<void>(yes=>setImmediate(yes));expect(done).toBe(false);second();await drain;}finally{first();second();await drain;}
});
it('retains a Native Error own stack Promise without formatting its diagnostic getters',async()=>{
 const f=fixture(),frame=open(f);let release!:()=>void,hits=0;const held=new Promise<void>(yes=>{release=yes;}),raw=Error('native');Object.defineProperty(raw,'stack',{value:held});Object.defineProperty(raw,'message',{get(){hits++;throw Error('must not format');}});vi.spyOn(f.contents,'isLoadingMainFrame').mockImplementation(()=>{throw raw;});let caught:unknown;try{read(f,frame);}catch(error){caught=error;}expect(caught).toBe(raw);expect(hits).toBe(0);let done=false;const drain=f.source.drain().then(()=>{done=true;},()=>{done=true;});try{await new Promise<void>(yes=>setImmediate(yes));expect(done).toBe(false);release();await drain;expect(hits).toBe(0);}finally{release();await drain;}
});
it('uses captured Hash methods after an actual Native callback changes their prototypes',()=>{
 const f=fixture(),one=open(f,{value:'before'}),update=Hash.prototype.update,digest=Hash.prototype.digest;let hooks=0,armed=true;f.contents.isLoadingMainFrame=()=>{if(armed){armed=false;Hash.prototype.update=function(this:Hash){hooks++;return this;} as typeof update;Hash.prototype.digest=function(){hooks++;return '0'.repeat(64);} as unknown as typeof digest;}return false;};
 try{const two=open(f,{value:'different'});expect(two.bodyHash).not.toBe(one.bodyHash);expect(two.bodyHash).not.toBe('0'.repeat(64));expect(hooks).toBe(0);}finally{Hash.prototype.update=update;Hash.prototype.digest=digest;}
});
it('revokes the active signal on a Native SDK fault before draining',()=>{const f=fixture(),frame=open(f);f.contents.isLoadingMainFrame=()=>{throw Error('native-fault');};expect(()=>read(f,frame)).toThrow('native-fault');expect(frame.signal.aborted).toBe(true);});
it('never revives an old frame when a changed Native session is restored',()=>{const f=fixture(),frame=open(f),session=f.contents.session;f.contents.session={};expect(()=>read(f,frame)).toThrow();f.contents.session=session;expect(()=>read(f,frame)).toThrow();expect(frame.signal.aborted).toBe(true);});
it('never revives an old frame after a denied URL policy becomes permissive again',()=>{let allowed=true;const f=fixture(()=>allowed),frame=open(f);allowed=false;expect(()=>read(f,frame)).toThrow();allowed=true;expect(()=>read(f,frame)).toThrow();expect(frame.signal.aborted).toBe(true);});

const probeBody={schemaVersion:1,purpose:'test_provider_connection',providerId:'fixture-provider',modelId:null};
function probeFixture(){const v=view();native.windows=[v.window];const source=api.createMainDshControlSource({window:v.window,scope,isTrustedUrl:()=>true});disposals.push(()=>source.drain());return{...v,source};}
it('exports a distinct model probe event opener and private reader with no Store requirement',()=>{
 const f=probeFixture();expect(f.source.openModelProbe).toBeTypeOf('function');expect(api.readOriginalMainModelProbeEvent).toBeTypeOf('function');
 const frame=f.source.openModelProbe(f.event,probeBody,'user'),actual=api.readOriginalMainModelProbeEvent(f.source,frame.proof);
 expect(actual.storageScope).toEqual(scope);expect(actual.principalId).toBe('desktop-user:'+scope.profileId);expect(actual.body).toEqual(probeBody);expect(actual.bodyHash).toMatch(/^[a-f0-9]{64}$/);actual.assertCurrent();actual.assertLocal();
 expect(actual).not.toHaveProperty('authorityEpoch');expect(()=>f.source.open(f.event,'policy_control',{},'user')).toThrow();
 frame.release();expect(()=>api.readOriginalMainModelProbeEvent(f.source,frame.proof)).toThrow();expect(()=>actual.assertLocal()).toThrow();
});
it('never exchanges model probe event proofs and original DSH control proofs',()=>{
 const f=fixture();expect(f.source.openModelProbe).toBeTypeOf('function');const control=open(f),probe=f.source.openModelProbe(f.event,probeBody,'user');
 expect(()=>api.readOriginalMainModelProbeEvent(f.source,control.proof)).toThrow();expect(()=>api.readOriginalMainDshControl(f.source,probe.proof,f.store,'policy_control',probe.bodyHash)).toThrow();expect(()=>f.source.resolve(probe.proof,'policy_control')).toThrow();
 expect(()=>api.readOriginalMainModelProbeEvent(f.source,{...probe.proof})).toThrow();
});
it.each(['agent','scheduler'])('probe refuses %s and hostile refs without reading getters',requestSource=>{
 const f=probeFixture();expect(f.source.openModelProbe).toBeTypeOf('function');let calls=0;const foreign=new Proxy({}, {get(){calls++;throw Error();},getOwnPropertyDescriptor(){calls++;throw Error();}});
 expect(()=>f.source.openModelProbe(foreign,foreign,requestSource)).toThrow();expect(()=>api.readOriginalMainModelProbeEvent(foreign,foreign)).toThrow();expect(()=>api.readOriginalMainModelProbeEvent(f.source,foreign)).toThrow();expect(calls).toBe(0);
});
it('probe enforces closed intent and never restores a proof after its native identity changes back',()=>{
 const f=probeFixture();expect(f.source.openModelProbe).toBeTypeOf('function');let calls=0;
 const hostile={...probeBody,get extra(){calls++;throw Error();}};expect(()=>f.source.openModelProbe(f.event,hostile,'user')).toThrow();expect(calls).toBe(0);
 for(const body of [{...probeBody,extra:true},{...probeBody,purpose:'policy_control'},{...probeBody,modelId:undefined},{...probeBody,providerId:' '},{...probeBody,modelId:'x'.repeat(257)}])expect(()=>f.source.openModelProbe(f.event,body,'user')).toThrow();
 const frame=f.source.openModelProbe(f.event,probeBody,'user'),session=f.contents.session;f.contents.session={};expect(()=>api.readOriginalMainModelProbeEvent(f.source,frame.proof)).toThrow();f.contents.session=session;expect(()=>api.readOriginalMainModelProbeEvent(f.source,frame.proof)).toThrow();expect(frame.signal.aborted).toBe(true);
});

it('probe holds original SDK own-symbol siblings and outcome tails while revoking both proof families',async()=>{
 const f=fixture(),control=open(f),probe=f.source.openModelProbe(f.event,probeBody,'user');let first!:(v:unknown)=>void,last!:()=>void,side!:()=>void;
 const a=new Promise(yes=>{first=yes;}),b=new Promise<void>(yes=>{side=yes;}),c=new Promise<void>(yes=>{last=yes;});const raw=Error('probe-native-original');Object.defineProperty(raw,'raw',{value:a});Object.defineProperty(raw,Symbol('sibling'),{value:b});
 vi.spyOn(f.contents,'isLoadingMainFrame').mockImplementation(()=>{throw raw;});expect(()=>api.readOriginalMainModelProbeEvent(f.source,probe.proof)).toThrow(raw);expect(control.signal.aborted).toBe(true);expect(probe.signal.aborted).toBe(true);
 let done=false;const drain=f.source.drain().then(()=>{done=true;},()=>{done=true;});try{await new Promise<void>(yes=>setImmediate(yes));expect(done).toBe(false);first({[Symbol('outcome-tail')]:c});side();await new Promise<void>(yes=>setImmediate(yes));expect(done).toBe(false);last();await drain;}finally{first(undefined);side();last();await drain;}
});
it('probe preserves captured complete target body and an independent hash domain',()=>{
 const f=fixture(),body={...probeBody,modelId:'model-before'},frame=f.source.openModelProbe(f.event,body,'user');body.modelId='model-after';const view=api.readOriginalMainModelProbeEvent(f.source,frame.proof);expect(view.body.modelId).toBe('model-before');expect(Object.isFrozen(view.body)).toBe(true);
 expect(open(f,probeBody,'policy_control').bodyHash).not.toBe(f.source.openModelProbe(f.event,probeBody,'user').bodyHash);
});

it('reads only original Source birth scope before Store binding without any Native SDK',()=>{
 const f=probeFixture();expect(api.readOriginalMainDshControlSourceBinding).toBeTypeOf('function');let calls=0;
 f.contents.isLoadingMainFrame=()=>{calls++;throw Error('must not read Native');};const view=api.readOriginalMainDshControlSourceBinding(f.source);expect(view.storageScope).toEqual(scope);expect(view.principalId).toBe('desktop-user:'+scope.profileId);view.assertLocal();expect(calls).toBe(0);
 const foreign=new Proxy({}, {get(){calls++;throw Error();},getOwnPropertyDescriptor(){calls++;throw Error();}});expect(()=>api.readOriginalMainDshControlSourceBinding(foreign)).toThrow();expect(calls).toBe(0);f.source.seal();expect(()=>view.assertLocal()).toThrow();
});
