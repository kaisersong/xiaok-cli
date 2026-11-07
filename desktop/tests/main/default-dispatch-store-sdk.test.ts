// @vitest-environment node
// Actual Store/FS with controlled constructor Source; no Native grant.
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,existsSync,Stats,fstatSync,closeSync,mkdirSync,writeFileSync,readFileSync,renameSync,realpathSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {tmpdir,hostname} from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {acquireSaveLock} from '../../../src/ai/runtime/session-store/mutation-lock.js';
import {registerSourceSyncCustodyOwner,createSourceSyncCustodyContext,invokeSourceSyncSdk} from '../../../src/runtime/task-host/source-sync-custody.js';
const control=vi.hoisted(()=>{vi.resetModules();return{hook:undefined as undefined|((name:string,original:Function,args:unknown[])=>unknown),syncHook:undefined as undefined|((name:string,original:Function,args:unknown[])=>unknown)};});
vi.mock('node:fs',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs')>(),wrappers:Record<string,Function>={};
 for(const name of ['lstatSync','realpathSync','readFileSync','existsSync','mkdirSync','openSync','fstatSync','readSync','writeFileSync','fsyncSync','closeSync','renameSync','linkSync','unlinkSync']){
  const original=(actual as any)[name];wrappers[name]=(...args:unknown[])=>control.syncHook?control.syncHook(name,original,args):Reflect.apply(original,undefined,args);
 }
 return{...actual,...wrappers};
});
vi.mock('node:fs/promises',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs/promises')>();
 const wrappers:Record<string,Function>={};
 for(const name of ['mkdir','readFile','writeFile','appendFile','rename','truncate','unlink','open']){
  const original=(actual as any)[name];
  wrappers[name]=(...args:unknown[])=>control.hook?control.hook(name,original,args):Reflect.apply(original,undefined,args);
 }
 return{...actual,...wrappers};
});
import {FileTaskSnapshotStore,readOriginalPreparationStoreBinding,readOriginalPreparationStoreIO} from '../../../src/runtime/task-host/snapshot-store.js';
import {createTaskDefaultDispatchPreparationIssuer} from '../../../src/runtime/task-host/default-dispatch-preparation.js';
import {buildTaskUnderstanding} from '../../../src/runtime/task-host/task-understanding.js';
import {desktopObservationSessionId} from '../../../src/runtime/task-host/protected-observation-store.js';
import {FileSessionStore,readOriginalFileStoreSession,readOriginalFileStoreAlias,saveOriginalFileStoreSession} from '../../../src/ai/runtime/session-store/file-store.js';
import type {TaskSnapshot} from '../../../src/runtime/task-host/types.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {createHash} from 'node:crypto';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {computeSessionHistoryDigest} from '../../../src/ai/runtime/session-store/store.js';
const {defaultDispatchBusinessIdentity}=createRequire(resolve('package.json'))(resolve('../../kswarm/src/core/default-dispatch-birth-rules.js'));
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{control.hook=undefined;control.syncHook=undefined;for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
function fixture(isolateCanonical=false){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'dsh-store-sdk-'))),path=join(root,'tasks'),canonical=join(root,'isolated-config','compound-sessions');let store:FileTaskSnapshotStore;const previousConfig=process.env.XIAOK_CONFIG_DIR;
 try{if(isolateCanonical)process.env.XIAOK_CONFIG_DIR=join(root,'isolated-config');store=new FileTaskSnapshotStore(path);}finally{if(previousConfig===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=previousConfig;}
 const proof=Object.freeze({}),scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
 cleanups.push(async()=>{await store.closeAndDrain().catch(()=>{});rmSync(root,{recursive:true,force:true,maxRetries:5});});
 const data={scope,projectId:'p',taskId:'p__a',runId:'run',businessExecutionGeneration:1,childKey:defaultDispatchBusinessIdentity(scope,'p','p__a').childKey,payloadHash:'d'.repeat(64),bindingDigest:'e'.repeat(64),hostId:'host',input:{prompt:'Actual SDK contract',materials:[],permissionMode:'plan'}};
 let live=true;
 const issuer=createTaskDefaultDispatchPreparationIssuer(store,{resolve(value:object){if(value!==proof)throw Error('controlled_source_required');return{data,assertCurrent(){if(!live)throw Error('controlled_source_withdrawn');}};}}),io=readOriginalPreparationStoreIO(store,readOriginalPreparationStoreBinding(store).identity);
 function prepare(protectedObservationClosure?:TaskSnapshot['protectedObservationClosure']){const frame=issuer.open(proof,'scheduler');return io.prepare(frame.issue(()=>({taskId:frame.marker.taskId,sessionId:frame.marker.sessionId,status:'understanding',prompt:data.input.prompt,materials:[],events:[{type:'task_started',taskId:frame.marker.taskId},{type:'understanding_updated',understanding:buildTaskUnderstanding({prompt:data.input.prompt,materials:[]})}],usage:{inputTokens:0,outputTokens:0,known:false},createdAt:1,updatedAt:1,...(protectedObservationClosure?{protectedObservationClosure}:{})})));}
 return{root,path,canonical,store,io,prepare,taskId:()=>issuer.open(proof,'scheduler').marker.taskId,withdraw(){live=false;},observation:()=>issuer.open(proof,'scheduler','observe').issueObservation()};
}
function protectionDocumentTemp(path:unknown):path is string{return typeof path==='string'&&basename(path).startsWith('.desktop-observation-')&&basename(path).includes('.json.')&&basename(path).endsWith('.tmp');}
async function originalProtectionGuard(f:ReturnType<typeof fixture>){
 const directory=join(f.path,'protected-observation-sessions'),sessionId=desktopObservationSessionId(f.taskId());mkdirSync(directory,{recursive:true});
 const authority=createSessionExecutionAuthority({root:directory,sessionIdentity:sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'fixture-owner',scopeId:'source-guard-fixture'})});
 try{const lease=await authority.acquire({invocationId:'actual-guard-birth',kind:'recovery'});await lease.releaseAfterDrain();}finally{authority.dispose();}
 const path=join(realpathSync(directory),'.session-execution',createHash('sha256').update(sessionId.toLowerCase()).digest('hex')+'.sqlite');expect(existsSync(path)).toBe(true);return path;
}
const sourceWriteClosure:NonNullable<TaskSnapshot['protectedObservationClosure']>={version:1,requiresReauthorization:true,observations:[{authorityId:'11111111-1111-1111-1111-111111111111',profileId:'actual-profile',sourceSessionId:'source-session',ownerAgentId:'source-agent',scopeId:'source-scope',permissionGeneration:1,observationId:'source-observation',contentHash:'a'.repeat(64),revision:1,policyId:'policy',policyRevision:1}]};
async function originalSourceAlias(){
 const f=fixture(true);mkdirSync(f.path,{recursive:true});mkdirSync(f.canonical,{recursive:true});
 const authority=createSessionExecutionAuthority({root:f.canonical,sessionIdentity:'canonical-source',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'fixture-owner',scopeId:'source-alias-fixture'})}),lease=await authority.acquire({invocationId:'actual-alias-birth',kind:'recovery'}),canonicalStore=new FileSessionStore(f.canonical);
 cleanups.push(async()=>{try{await lease.releaseAfterDrain();}finally{authority.dispose();}});
 await canonicalStore.compareAndSave({nextSnapshot:{...new AgentSessionState().exportSnapshot(),sessionId:'canonical-source',cwd:f.root,executionProtected:true,protectedObservationClosure:sourceWriteClosure},expectedStoreRevision:0,expectedHistoryDigest:computeSessionHistoryDigest({messages:[]}),lease});
 await canonicalStore.registerSessionAlias({aliasId:'actual-source-alias',holderRoot:f.path,holderId:f.taskId(),targetSessionId:'canonical-source',domainInitializationId:'source-alias-domain',domainGeneration:1,requestSource:'user',lease});
 return{...f,canonicalFile:join(f.canonical,'canonical-source.json')};
}
for(const mode of ['matching','conflicting','missing-target'] as const)it(`preserves the original Source canonical alias ${mode} contract without writing a local shadow session`,async()=>{
 const f=await originalSourceAlias(),bytes=readFileSync(f.canonicalFile,'utf8');if(mode==='missing-target')rmSync(f.canonicalFile);
 const closure=mode==='conflicting'?{...sourceWriteClosure,observations:[...sourceWriteClosure.observations,{...sourceWriteClosure.observations[0]!,observationId:'new-observation'}]}:sourceWriteClosure;
 if(mode==='matching')await f.prepare(closure);else{let rejected=false;await f.prepare(closure).catch(()=>{rejected=true;});expect(rejected).toBe(true);}
 expect(existsSync(join(f.path,'protected-observation-sessions'))).toBe(false);if(mode!=='missing-target')expect(readFileSync(f.canonicalFile,'utf8')).toBe(bytes);else expect(existsSync(f.canonicalFile)).toBe(false);
});
it('writes the original protection session through a Source ticket builder containing a real closure',async()=>{
 const f=fixture(),result=await f.prepare(sourceWriteClosure),file=join(f.path,'protected-observation-sessions',desktopObservationSessionId(result.fact.taskId)+'.json');
 expect(JSON.parse(readFileSync(file,'utf8')).protectedObservationClosure).toEqual(sourceWriteClosure);expect(existsSync(join(f.path,'snapshots',result.fact.taskId+'.json'))).toBe(true);await f.io.drain();
});
it('recovers a real exited owner of the original protection session root lock before writing its closure',async()=>{
 const f=fixture(),directory=join(f.path,'protected-observation-sessions');mkdirSync(directory,{recursive:true});
 const child=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore'}),exited=await once(child,'exit');expect(exited[0]).toBe(0);expect(child.pid).toBeTypeOf('number');console.log(JSON.stringify({fixture:'source-protection-stale-lock-owner',pid:child.pid,exitCode:child.exitCode,reaped:true}));
 writeFileSync(join(directory,'.session-store-lock'),JSON.stringify({version:1,pid:child.pid,hostname:hostname(),nonce:randomUUID()}));
 const result=await f.prepare(sourceWriteClosure);expect(JSON.parse(readFileSync(join(directory,desktopObservationSessionId(result.fact.taskId)+'.json'),'utf8')).protectedObservationClosure).toEqual(sourceWriteClosure);expect(existsSync(join(directory,'.session-store-lock'))).toBe(false);await f.io.drain();
});
it('rejects missing and counterfeit Source writer contexts before snapshot getters or filesystem SDKs',()=>{
 const f=fixture(),store=new FileSessionStore(join(f.root,'session-writer'));let getters=0,calls=0;const snapshot=new Proxy({},{get(){getters++;throw Error('untrusted snapshot');},getOwnPropertyDescriptor(){getters++;throw Error('untrusted snapshot descriptor');}});
 control.syncHook=(_name,original,args)=>{calls++;return Reflect.apply(original,undefined,args);};
 for(const context of [undefined,null,{},Object.freeze(Object.create(null)),new Proxy({},{get(){getters++;throw Error('context getter');}})])expect(()=>saveOriginalFileStoreSession(store,snapshot as any,context as any)).toThrow();
 expect(getters).toBe(0);expect(calls).toBe(0);
});
it('keeps the original Source writer root and kernel after late FileStore prototype slots are shadowed',async()=>{
 const f=fixture(),names=['save','rootDir','reader','atomicWrite','commitSnapshot','commitSnapshotLocked','getFilePath','ensureRoot','acquireMutationLock','acquireWriterMutationLock','observedMutation','mutationInProgress','commitNotifications'],prior=Object.getOwnPropertyDescriptors(FileSessionStore.prototype);let reads=0;
 for(const name of names)Object.defineProperty(FileSessionStore.prototype,name,{configurable:true,get(){reads++;throw Error('late FileStore slot '+name);}});
 try{const result=await f.prepare(sourceWriteClosure);expect(reads).toBe(0);expect(JSON.parse(readFileSync(join(f.path,'protected-observation-sessions',desktopObservationSessionId(result.fact.taskId)+'.json'),'utf8')).protectedObservationClosure).toEqual(sourceWriteClosure);await f.io.drain();}
 finally{for(const name of names){if(prior[name])Object.defineProperty(FileSessionStore.prototype,name,prior[name]!);else delete (FileSessionStore.prototype as any)[name];}}
});
for(const mode of ['directory-fsync','last-session'] as const)it(`retains the actually published protection document after ${mode} fails`,async()=>{
 const f=fixture(),target=join(f.path,'protected-observation-sessions',desktopObservationSessionId(f.taskId())+'.json');let published=false,hits=0,lastFd:number|undefined;
 control.syncHook=(name,original,args)=>{const value=Reflect.apply(original,undefined,args);if(name==='renameSync'&&args[1]===target)published=true;if(name==='openSync'&&typeof args[0]==='string'&&basename(args[0]).startsWith('.last_session.'))lastFd=value;if(published&&!hits&&(mode==='directory-fsync'&&name==='fsyncSync'||mode==='last-session'&&name==='writeFileSync'&&args[0]===lastFd)){hits++;throw Error('actual post-publication SDK failure');}return value;};
 let rejected=false;await f.prepare(sourceWriteClosure).catch(()=>{rejected=true;});expect(published).toBe(true);expect(hits).toBe(1);expect(rejected).toBe(true);expect(JSON.parse(readFileSync(target,'utf8')).protectedObservationClosure).toEqual(sourceWriteClosure);expect(existsSync(join(f.path,'snapshots',f.taskId()+'.json'))).toBe(false);
});
it('does not inspect a Proxy failure from the original protection directory fsync SDK',async()=>{
 const f=fixture(),target=join(f.path,'protected-observation-sessions',desktopObservationSessionId(f.taskId())+'.json');let published=false,hits=0,traps=0;
 const failure=new Proxy(new Error('original directory failure'),{getOwnPropertyDescriptor(){traps++;throw Error('must not inspect Proxy SDK failure');}});
 control.syncHook=(name,original,args)=>{const value=Reflect.apply(original,undefined,args);if(name==='renameSync'&&args[1]===target)published=true;if(published&&!hits&&name==='fsyncSync'){hits++;throw failure;}return value;};
 let rejected=false;await f.prepare(sourceWriteClosure).catch(()=>{rejected=true;});expect(hits).toBe(1);expect(rejected).toBe(true);expect(traps).toBe(0);expect(existsSync(target)).toBe(true);
});
it('writes a real closure through the original existing execution guard without bypassing its SQLite lock',async()=>{
 const f=fixture(),guard=await originalProtectionGuard(f);let hits=0;control.syncHook=(name,original,args)=>{if(name==='lstatSync'&&args[0]===guard)hits++;return Reflect.apply(original,undefined,args);};
 const result=await f.prepare(sourceWriteClosure);expect(hits).toBeGreaterThan(0);expect(existsSync(join(f.path,'protected-observation-sessions',desktopObservationSessionId(result.fact.taskId)+'.json'))).toBe(true);await f.io.drain();
});
it('defers the actual existing guard close until a held original BEGIN SDK tail finishes, then closes once',async()=>{
 const f=fixture(),guard=await originalProtectionGuard(f),Database=createRequire(new URL('../../../src/ai/runtime/session-store/execution-authority.ts',import.meta.url))('better-sqlite3'),exec=Database.prototype.exec,close=Database.prototype.close;
 let release!:()=>void,entered!:()=>void,target:any,closes=0,settled=false,closed=false;const held=new Promise<void>(yes=>{release=yes;}),ready=new Promise<void>(yes=>{entered=yes;});
 Database.prototype.exec=function(...args:unknown[]){const value=Reflect.apply(exec,this,args);if(this.name===guard&&args[0]==='BEGIN EXCLUSIVE'){target=this;const raw=Promise.resolve(value);Object.defineProperty(raw,Symbol('actual-execution-guard-sdk-tail'),{value:held});entered();return raw;}return value;};
 Database.prototype.close=function(...args:unknown[]){if(this.name===guard)closes++;return Reflect.apply(close,this,args);};
 const preparing=f.prepare(sourceWriteClosure).then(()=>{settled=true;},()=>{settled=true;});let closing:Promise<void>|undefined;
 try{await Promise.race([ready,preparing.then(()=>{throw Error('guard BEGIN hook not reached');})]);closing=f.io.drain().then(()=>{closed=true;},()=>{closed=true;});await delay(20);expect(closes).toBe(0);expect(settled).toBe(false);expect(closed).toBe(false);release();await preparing;await closing;expect(closes).toBe(1);expect(target.open).toBe(false);}
 finally{release();await preparing;await closing;Database.prototype.exec=exec;Database.prototype.close=close;if(target?.open){Reflect.apply(close,target,[]);console.log(JSON.stringify({fixture:'execution-guard-negative-fd-cleanup',databases:1,notProductDrain:true}));}}
});
it('joins the actual protection writer fsyncSync raw and symbol tail before preparation and Store close finish',async()=>{
 const f=fixture();let release!:()=>void,entered!:()=>void,hits=0,settled=false,closed=false;const descriptors=new Set<number>();
 const held=new Promise<void>(yes=>{release=yes;}),ready=new Promise<void>(yes=>{entered=yes;});
 control.syncHook=(name,original,args)=>{const value=Reflect.apply(original,undefined,args);if(name==='openSync'&&protectionDocumentTemp(args[0]))descriptors.add(value);if(name==='fsyncSync'&&descriptors.has(args[0] as number)){hits++;const raw=Promise.resolve(value);Object.defineProperty(raw,Symbol('actual-protection-writer-tail'),{value:held});entered();return raw;}return value;};
 const preparing=f.prepare(sourceWriteClosure).then(()=>{settled=true;},()=>{settled=true;});await ready;const closing=f.io.drain().then(()=>{closed=true;},()=>{closed=true;});
 try{await delay(20);expect(hits).toBeGreaterThan(0);expect(settled).toBe(false);expect(closed).toBe(false);}
 finally{release();await preparing;await closing;}
});
it('does not start the original protection writer after Source withdrawal across its session load await',async()=>{
 const f=fixture(),directory=join(f.path,'protected-observation-sessions'),file=join(directory,desktopObservationSessionId(f.taskId())+'.json');let revoked=false,hits=0,writes=0;
 control.syncHook=(name,original,args)=>{if(revoked&&['mkdirSync','openSync','writeFileSync','renameSync'].includes(name)&&typeof args[0]==='string'&&args[0].startsWith(directory))writes++;const value=Reflect.apply(original,undefined,args);if(name==='existsSync'&&args[0]===file&&!hits++){queueMicrotask(()=>{revoked=true;f.withdraw();});}return value;};
 let rejected=false;await f.prepare(sourceWriteClosure).catch(()=>{rejected=true;});expect(hits).toBeGreaterThan(0);expect(rejected).toBe(true);expect(revoked).toBe(true);expect(writes).toBe(0);expect(existsSync(file)).toBe(false);
});
it('does not publish a real replacement installed at the closed original protection temp path',async()=>{
 const f=fixture(),target=join(f.path,'protected-observation-sessions',desktopObservationSessionId(f.taskId())+'.json'),fds=new Map<number,string>();let replaced=false,temp='';
 control.syncHook=(name,original,args)=>{const value=Reflect.apply(original,undefined,args);if(name==='openSync'&&protectionDocumentTemp(args[0]))fds.set(value,args[0]);if(name==='closeSync'&&!replaced&&fds.has(args[0] as number)){replaced=true;temp=fds.get(args[0] as number)!;renameSync(temp,temp+'.original');writeFileSync(temp,'foreign replacement bytes');}return value;};
 let rejected=false;await f.prepare(sourceWriteClosure).catch(()=>{rejected=true;});expect(replaced).toBe(true);expect(rejected).toBe(true);expect(existsSync(target)).toBe(false);expect(readFileSync(temp,'utf8')).toBe('foreign replacement bytes');expect(existsSync(temp+'.original')).toBe(true);
});
it('joins a protection writer closeSync raw after the actual descriptor closes and never closes it twice',async()=>{
 const f=fixture();let release!:()=>void,entered!:()=>void,descriptor:number|undefined,closes=0,settled=false,closed=false;
 const held=new Promise<void>(yes=>{release=yes;}),ready=new Promise<void>(yes=>{entered=yes;});
 control.syncHook=(name,original,args)=>{const value=Reflect.apply(original,undefined,args);if(name==='openSync'&&protectionDocumentTemp(args[0])&&descriptor===undefined)descriptor=value;if(name==='closeSync'&&args[0]===descriptor){closes++;const raw=Promise.resolve(value);Object.defineProperty(raw,Symbol('actual-protection-close-tail'),{value:held});entered();return raw;}return value;};
 const preparing=f.prepare(sourceWriteClosure).then(()=>{settled=true;},()=>{settled=true;});await ready;const closing=f.io.drain().then(()=>{closed=true;},()=>{closed=true;});
 try{await delay(20);expect(closes).toBe(1);expect(()=>fstatSync(descriptor!)).toThrow();expect(settled).toBe(false);expect(closed).toBe(false);}
 finally{release();await preparing;await closing;}expect(closes).toBe(1);
});
for(const body of [new Error('original protection fsync failure'),undefined])it(`preserves protection writer ${body===undefined?'undefined':'Error'} as first cause when actual close also fails`,async()=>{
 const f=fixture();let descriptor:number|undefined,fsyncs=0,closes=0,reason:any,rejected=false;
 control.syncHook=(name,original,args)=>{const value=Reflect.apply(original,undefined,args);if(name==='openSync'&&protectionDocumentTemp(args[0])&&descriptor===undefined)descriptor=value;if(name==='fsyncSync'&&args[0]===descriptor){fsyncs++;throw body;}if(name==='closeSync'&&args[0]===descriptor){closes++;throw Error('actual protection close failure');}return value;};
 await f.prepare(sourceWriteClosure).catch(error=>{rejected=true;reason=error;});expect(rejected).toBe(true);expect(fsyncs).toBe(1);expect(closes).toBe(1);
 const pending=[reason],seen=new Set<unknown>();let found:AggregateError|undefined;
 while(pending.length){const error=pending.pop();if(!error||typeof error!=='object'||seen.has(error))continue;seen.add(error);if(error instanceof AggregateError&&error.message==='source_atomic_write_and_cleanup_failed'){found=error;break;}if(Object.hasOwn(error,'cause'))pending.push(error.cause);if(error instanceof AggregateError)pending.push(...error.errors);}
 expect(found instanceof AggregateError).toBe(true);expect(Object.hasOwn(found!,'cause')).toBe(true);expect(found!.cause===body).toBe(true);expect(found!.errors[0]===body).toBe(true);expect(()=>fstatSync(descriptor!)).toThrow();expect(existsSync(join(f.path,'protected-observation-sessions',desktopObservationSessionId(f.taskId())+'.json'))).toBe(false);
});
it('joins the actual protection session read raw and its symbol tail before preparation and Store close finish',async()=>{
 const f=fixture(),taskId=f.taskId();
 await f.store.observations.save(taskId,{version:1,requiresReauthorization:true,observations:[{authorityId:'11111111-1111-1111-1111-111111111111',profileId:'actual-profile',sourceSessionId:'source-session',ownerAgentId:'source-agent',scopeId:'source-scope',permissionGeneration:1,observationId:'source-observation',contentHash:'a'.repeat(64),revision:1,policyId:'policy',policyRevision:1}]});
 const file=join(f.path,'protected-observation-sessions',desktopObservationSessionId(taskId)+'.json');expect(existsSync(file)).toBe(true);
 let release!:()=>void,entered!:()=>void,hits=0,settled=false,closed=false;
 const held=new Promise<void>(yes=>{release=yes;}),ready=new Promise<void>(yes=>{entered=yes;});
 control.syncHook=(name,original,args)=>{const value=Reflect.apply(original,undefined,args);if(name==='readFileSync'&&args[0]===file){hits++;const raw=Promise.resolve(value);Object.defineProperty(raw,Symbol('actual-protection-read-tail'),{value:held});entered();return raw;}return value;};
 const preparing=f.prepare().then(()=>{settled=true;},()=>{settled=true;});await ready;
 const closing=f.io.drain().then(()=>{closed=true;},()=>{closed=true;});
 try{await delay(20);expect(hits).toBe(1);expect(settled).toBe(false);expect(closed).toBe(false);}
 finally{release();await preparing;await closing;}
});
it('holds the actual readonly deletion descriptor until its original readSync tail finishes without unlinking the journal',async()=>{
 const f=fixture(),taskId=f.taskId(),directory=join(f.path,'protected-observation-sessions','.deletions'),file=join(directory,desktopObservationSessionId(taskId)+'.json');mkdirSync(directory,{recursive:true});writeFileSync(file,'{invalid');
 let release!:()=>void,entered!:()=>void,descriptor:number|undefined,hits=0,settled=false,closed=false;
 const held=new Promise<void>(yes=>{release=yes;}),ready=new Promise<void>(yes=>{entered=yes;});
 control.syncHook=(name,original,args)=>{const value=Reflect.apply(original,undefined,args);if(name==='openSync'&&args[0]===file)descriptor=value;if(name==='readSync'&&args[0]===descriptor){hits++;const raw=Promise.resolve(value);Object.defineProperty(raw,Symbol('actual-deletion-read-tail'),{value:held});entered();return raw;}return value;};
 const preparing=f.prepare().then(()=>{settled=true;},()=>{settled=true;});await ready;const closing=f.io.drain().then(()=>{closed=true;},()=>{closed=true;});
 try{await delay(15);expect(hits).toBe(1);expect(settled).toBe(false);expect(closed).toBe(false);expect(fstatSync(descriptor!).isFile()).toBe(true);expect(existsSync(file)).toBe(true);}
 finally{release();await preparing;await closing;}
 expect(()=>fstatSync(descriptor!)).toThrow();expect(existsSync(file)).toBe(true);
});
it('does not invoke a migration stat error code getter while the original Source refuses the read',async()=>{
 const f=fixture();let getters=0,hits=0;const migration=join(f.path,'protected-observation-sessions','.migrations',desktopObservationSessionId(f.taskId())+'.json');
 control.syncHook=(name,original,args)=>{if(name==='lstatSync'&&args[0]===migration){hits++;const error=new Error('actual migration SDK failure');Object.defineProperty(error,'code',{get(){getters++;return'ENOENT';}});throw error;}return Reflect.apply(original,undefined,args);};
 let rejected=false;await f.prepare().catch(()=>{rejected=true;});expect(rejected).toBe(true);expect(hits).toBe(1);expect(getters).toBe(0);
});
it('does not format a migration Native error through its own custom prototype name getter',async()=>{
 const f=fixture();let getters=0,hits=0;const migration=join(f.path,'protected-observation-sessions','.migrations',desktopObservationSessionId(f.taskId())+'.json');
 control.syncHook=(name,original,args)=>{if(name==='lstatSync'&&args[0]===migration){hits++;const error=new Error('actual migration failure');Object.setPrototypeOf(error,Object.create(Error.prototype,{name:{get(){getters++;return'UntrustedError';}}}));throw error;}return Reflect.apply(original,undefined,args);};
 let rejected=false;await f.prepare().catch(()=>{rejected=true;});expect(rejected).toBe(true);expect(hits).toBe(1);expect(getters).toBe(0);
});
it('uses the original protection root and reader after public inner slots are shadowed',async()=>{
 const f=fixture(),taskId=f.taskId(),observation=f.store.observations;let getters=0,hits=0;
 const closure={version:1 as const,requiresReauthorization:true as const,observations:[{authorityId:'11111111-1111-1111-1111-111111111111',profileId:'actual-profile',sourceSessionId:'source-session',ownerAgentId:'source-agent',scopeId:'source-scope',permissionGeneration:1,observationId:'source-observation',contentHash:'a'.repeat(64),revision:1,policyId:'policy',policyRevision:1}]};await observation.save(taskId,closure);
 for(const name of ['root','sessions','canonicalRoot','alias'])Object.defineProperty(observation,name,{get(){getters++;throw Error('late protection slot');}});
 const file=join(f.path,'protected-observation-sessions',desktopObservationSessionId(taskId)+'.json');control.syncHook=(name,original,args)=>{if(name==='readFileSync'&&args[0]===file)hits++;return Reflect.apply(original,undefined,args);};
 expect(await observation.readProtection(taskId)).toEqual({closure});await f.prepare().catch(()=>{});expect(hits).toBeGreaterThan(1);expect(getters).toBe(0);
});
it('rejects missing and counterfeit required Source read contexts before any actual filesystem SDK',()=>{
 const f=fixture(),store=new FileSessionStore(join(f.root,'sessions'));let calls=0,getters=0;
 control.syncHook=(_name,original,args)=>{calls++;return Reflect.apply(original,undefined,args);};
 const proxy=new Proxy({},{get(){getters++;throw Error('context getter');},getOwnPropertyDescriptor(){getters++;throw Error('context descriptor');}});
 for(const context of [undefined,null,{},Object.freeze(Object.create(null)),proxy]){
  expect(()=>readOriginalFileStoreSession(store,'actual-session',context as any)).toThrow();
  expect(()=>readOriginalFileStoreAlias(store,{holderRoot:f.root,holderId:'task'},context as any)).toThrow();
 }
 expect(calls).toBe(0);expect(getters).toBe(0);
});
for(const body of [new Error('original deletion read failure'),undefined])it(`preserves original deletion read cause ${body===undefined?'undefined':'Error'} when actual readonly close also fails`,async()=>{
 const f=fixture(),directory=join(f.path,'protected-observation-sessions','.deletions'),file=join(directory,desktopObservationSessionId(f.taskId())+'.json');mkdirSync(directory,{recursive:true});writeFileSync(file,'{invalid');let descriptor:number|undefined,reads=0,closes=0;
 control.syncHook=(name,original,args)=>{const value=Reflect.apply(original,undefined,args);if(name==='openSync'&&args[0]===file)descriptor=value;if(name==='readSync'&&args[0]===descriptor){reads++;throw body;}if(name==='closeSync'&&args[0]===descriptor){closes++;throw Error('actual close failure');}return value;};
 let rejected=false,reason:any;await f.prepare().catch(error=>{rejected=true;reason=error;});expect(rejected).toBe(true);expect(reads).toBe(1);expect(closes).toBe(1);
 const pending=[reason],seen=new Set<unknown>();let aggregate:AggregateError|undefined;
 while(pending.length){const error=pending.pop();if(!error||typeof error!=='object'||seen.has(error))continue;seen.add(error);if(error instanceof AggregateError&&error.message==='session_read_and_close_failed'){aggregate=error;break;}if(Object.hasOwn(error,'cause'))pending.push(error.cause);if(error instanceof AggregateError)pending.push(...error.errors);}
 expect(aggregate instanceof AggregateError).toBe(true);expect(Object.hasOwn(aggregate!,'cause')).toBe(true);expect(aggregate!.cause===body).toBe(true);expect(aggregate!.errors[0]===body).toBe(true);expect(()=>fstatSync(descriptor!)).toThrow();expect(existsSync(file)).toBe(true);
});
for(const leaf of ['mkdir','writeFile','rename'])it(`rejects an invalid ${leaf} fulfillment after the actual original FS operation`,async()=>{
 const f=fixture();let hits=0;
 control.hook=(name,original,args)=>{const raw=Reflect.apply(original,undefined,args);return name===leaf?raw.then(()=>{hits++;return{invalidSdkValue:true};}):raw;};
 await expect(f.prepare()).rejects.toThrow();expect(hits).toBeGreaterThan(0);
});
it('does not coerce a non-string original checkpoint read into trusted source bytes',async()=>{
 const f=fixture(),prepared=await f.prepare();let hits=0,coercions=0;
 control.hook=(name,original,args)=>{const raw=Reflect.apply(original,undefined,args);return name==='readFile'&&String(args[0]).endsWith(prepared.fact.taskId+'.json')?raw.then((bytes:unknown)=>{hits++;return{toString(){coercions++;return bytes;}};}):raw;};
 await expect(f.prepare()).rejects.toThrow();expect(hits).toBe(1);expect(coercions).toBe(0);
});
it('joins an independent known raw in an invalid write settlement before preparation and Store close finish',async()=>{
 const f=fixture();let release!:()=>void,entered!:()=>void;
 const sidecar=new Promise<void>(yes=>{release=yes;}),ready=new Promise<void>(yes=>{entered=yes;});
 let first=true,prepared=false,closed=false;
 control.hook=(name,original,args)=>{const raw=Reflect.apply(original,undefined,args);if(name==='writeFile'&&first){first=false;return raw.then(()=>{entered();return{sidecar};});}return raw;};
 const preparation=f.prepare().then(()=>{prepared=true;},()=>{prepared=true;});
 await ready;
 const closing=f.io.drain().then(()=>{closed=true;},()=>{closed=true;});
 try{await delay(20);expect(prepared).toBe(false);expect(closed).toBe(false);expect(existsSync(f.path)).toBe(true);}
 finally{release();await preparation;await closing;}
});
it('joins a non-enumerable original write raw sidecar before issuing its otherwise valid receipt',async()=>{
 const f=fixture();let release!:()=>void,entered!:()=>void;const sidecar=new Promise<void>(yes=>{release=yes;}),ready=new Promise<void>(yes=>{entered=yes;});let first=true,settled=false;
 control.hook=(name,original,args)=>{const raw=Reflect.apply(original,undefined,args);if(name==='writeFile'&&first){first=false;Object.defineProperty(raw,Symbol('sdk-original-tail'),{value:sidecar});entered();}return raw;};
 const preparing=f.prepare().then(value=>{settled=true;return value;});await ready;
 try{await delay(15);expect(settled).toBe(false);}finally{release();}
 const result=await preparing;expect(await f.io.observe(f.observation())).toEqual(result.fact);await f.io.drain();
});
it('joins an original rejected read cause tail before treating genuine ENOENT as absence',async()=>{
 const f=fixture();let release!:()=>void,entered!:()=>void;const sidecar=new Promise<void>(yes=>{release=yes;}),ready=new Promise<void>(yes=>{entered=yes;});let first=true,settled=false;
 control.hook=(name,original,args)=>{const raw=Reflect.apply(original,undefined,args);if(name==='readFile'&&first){first=false;return raw.catch((error:Error)=>{Object.defineProperty(error,'cause',{value:{sidecar}});entered();throw error;});}return raw;};
 const preparing=f.prepare().then(value=>{settled=true;return value;});await ready;
 try{await delay(15);expect(settled).toBe(false);}finally{release();}
 const result=await preparing;expect(existsSync(join(f.path,'snapshots',result.fact.taskId+'.json'))).toBe(true);await f.io.drain();
});
it('keeps the exact synchronous SDK rejection value as the unconfirmed close cause',async()=>{
 const f=fixture();let hits=0;control.hook=(name,original,args)=>{if(name==='mkdir'){hits++;throw undefined;}return Reflect.apply(original,undefined,args);};
 let rejected=false,reason:unknown;try{await f.prepare();}catch(error){rejected=true;reason=error;}
 expect(rejected).toBe(true);expect(reason).toBeUndefined();expect(hits).toBe(1);
 const failure=await f.io.drain().catch(error=>error);expect(failure.message).toBe('TASK_SNAPSHOT_SYNC_CLOSE_UNCONFIRMED');expect(Object.hasOwn(failure,'cause')).toBe(true);expect(failure.cause).toBeUndefined();
});
it('closes the actual acquired FileHandle if the Source is revoked at open fulfillment',async()=>{
 const f=fixture(),handles:any[]=[];
 control.hook=(name,original,args)=>{const raw=Reflect.apply(original,undefined,args);return name==='open'?raw.then((handle:unknown)=>{handles.push(handle);f.withdraw();return handle;}):raw;};
 try{await expect(f.prepare()).rejects.toThrow('controlled_source_withdrawn');expect(handles.length).toBe(1);expect(handles[0].fd).toBe(-1);await f.io.drain();}
 finally{let remaining=0;for(const handle of handles)if(handle.fd!==-1){remaining++;await handle.close();}if(remaining)console.log(JSON.stringify({fixture:'open-revoked-actual-handle-cleanup',handles:remaining,notProductDrain:true}));}
});
it('does not launder an unconfirmed ENOENT cause into a healthy absent observation',async()=>{
 const f=fixture(),prepared=await f.prepare();rmSync(join(f.path,'snapshots',prepared.fact.taskId+'.json'));let getters=0,failure:unknown;
 control.hook=(name,original,args)=>{const raw=Reflect.apply(original,undefined,args);return name==='readFile'&&String(args[0]).endsWith(prepared.fact.taskId+'.json')?raw.catch((error:Error)=>{failure=error;Object.defineProperty(error,'cause',{get(){getters++;return undefined;}});throw error;}):raw;};
 let rejected=false,reason:unknown;try{await f.io.observe(f.observation());}catch(error){rejected=true;reason=error;}
 expect(getters).toBe(0);expect(rejected).toBe(true);expect(reason).toBe(failure);await expect(f.io.drain()).rejects.toThrow('TASK_SNAPSHOT_SYNC_CLOSE_UNCONFIRMED');
});
it('never invokes an SDK error code getter to classify a missing checkpoint',async()=>{
 const f=fixture();let getters=0,writes=0;
 control.hook=(name,original,args)=>{if(name==='writeFile')writes++;const raw=Reflect.apply(original,undefined,args);return name==='readFile'?raw.catch((error:Error)=>{Object.defineProperty(error,'code',{get(){getters++;return'ENOENT';}});throw error;}):raw;};
 await f.prepare().catch(()=>{});expect(getters).toBe(0);expect(writes).toBe(0);
});
it('joins visible tails of a non-method sync slot before returning a negative Store close',async()=>{
 const f=fixture();let release!:()=>void,entered!:()=>void;const sidecar=new Promise<void>(yes=>{release=yes;}),ready=new Promise<void>(yes=>{entered=yes;});let first=true,prepared=false,closed=false;
 control.hook=(name,original,args)=>{const raw=Reflect.apply(original,undefined,args);return name==='open'&&first?raw.then((handle:object)=>{first=false;const nonMethod=Promise.resolve();Object.defineProperty(nonMethod,Symbol('non-method-tail'),{value:sidecar});Object.defineProperty(handle,'sync',{value:nonMethod,configurable:true});entered();return handle;}):raw;};
 const preparation=f.prepare().then(()=>{prepared=true;},()=>{prepared=true;});await ready;const closing=f.io.drain().then(()=>{closed=true;},()=>{closed=true;});
 try{await delay(15);expect(prepared).toBe(false);expect(closed).toBe(false);}finally{release();await preparation;await closing;}
});
it('rejects an accessor sync slot without invoking its getter and still closes the actual handle',async()=>{
 const f=fixture(),handles:any[]=[];let getters=0,first=true;
 control.hook=(name,original,args)=>{const raw=Reflect.apply(original,undefined,args);return name==='open'&&first?raw.then((handle:object)=>{first=false;handles.push(handle);Object.defineProperty(handle,'sync',{get(){getters++;throw Error('untrusted method getter');}});return handle;}):raw;};
 await expect(f.prepare()).rejects.toThrow();expect(getters).toBe(0);expect(handles.length).toBe(1);expect(handles[0].fd).toBe(-1);
});
it('does not assimilate a function-valued resource method through its then getter',async()=>{
 const f=fixture();let first=true,gets=0,syncs=0;
 control.hook=(name,original,args)=>{const raw=Reflect.apply(original,undefined,args);return name==='open'&&first?raw.then((handle:any)=>{first=false;const sync=handle.sync,method=function(this:unknown,...parameters:unknown[]){syncs++;return Reflect.apply(sync,this,parameters);};Object.defineProperty(method,'then',{get(){gets++;throw Error('resource method must not be assimilated');}});Object.defineProperty(handle,'sync',{value:method});return handle;}):raw;};
 await f.prepare();expect(gets).toBe(0);expect(syncs).toBe(1);await f.io.drain();
});
it('joins visible tails of an invalid fd getter return before reporting close as unconfirmed',async()=>{
 const f=fixture();let release!:()=>void,entered!:()=>void;const sidecar=new Promise<void>(yes=>{release=yes;}),ready=new Promise<void>(yes=>{entered=yes;});
 const raw=Promise.resolve(-1);Object.defineProperty(raw,Symbol('fd-sdk-tail'),{value:sidecar});let originalDescriptor:PropertyDescriptor|undefined,prototype:any,target:any,first=true,settled=false;
 control.hook=(name,original,args)=>{const result=Reflect.apply(original,undefined,args);return name==='open'&&first?result.then((handle:any)=>{first=false;target=handle;prototype=Object.getPrototypeOf(handle);originalDescriptor=Object.getOwnPropertyDescriptor(prototype,'fd')!;Object.defineProperty(prototype,'fd',{...originalDescriptor,get:function(){if(this===target){entered();return raw;}return Reflect.apply(originalDescriptor!.get!,this,[]);}});return handle;}):result;};
 const preparing=f.prepare().then(()=>{settled=true;},()=>{settled=true;});await ready;let closed=false;const closing=f.io.drain().then(()=>{closed=true;},()=>{closed=true;});
 try{await delay(15);expect(settled).toBe(false);expect(closed).toBe(false);}
 finally{release();await preparing;await closing;if(originalDescriptor)Object.defineProperty(prototype,'fd',originalDescriptor);if(target&&target.fd!==-1)await target.close();}
});
it('does not inherit cleanup authority when a later SDK call follows an unconfirmed failure',async()=>{
 const f=fixture();
 control.hook=(name,original,args)=>{const raw=Reflect.apply(original,undefined,args);return name==='readFile'?raw.catch((error:Error)=>{Object.defineProperty(error,'cause',{get(){throw Error('must not evaluate');}});throw error;}):raw;};
 await expect(f.prepare()).rejects.toThrow();let calls=0;
 control.hook=(_name,original,args)=>{calls++;return Reflect.apply(original,undefined,args);};
 const prior=Object.getOwnPropertyDescriptor(Object.prototype,'cleanup');Object.defineProperty(Object.prototype,'cleanup',{value:true,configurable:true});
 try{await expect(f.prepare()).rejects.toThrow();expect(calls).toBe(0);}
 finally{if(prior)Object.defineProperty(Object.prototype,'cleanup',prior);else delete (Object.prototype as any).cleanup;}
});
it('uses actual own Stats mode data without invoking late prototype directory or symlink methods',async()=>{
 const f=fixture(),selected=new WeakSet<object>(),directory=Stats.prototype.isDirectory,symlink=Stats.prototype.isSymbolicLink;let calls=0;
 control.syncHook=(name,original,args)=>{const raw=Reflect.apply(original,undefined,args);if(name==='lstatSync'&&args[0]===f.path)selected.add(raw);return raw;};
 Stats.prototype.isDirectory=function(){if(selected.has(this)){calls++;throw Error('late Stats.isDirectory');}return Reflect.apply(directory,this,[]);};
 Stats.prototype.isSymbolicLink=function(){if(selected.has(this)){calls++;throw Error('late Stats.isSymbolicLink');}return Reflect.apply(symlink,this,[]);};
 try{const result=await f.prepare();expect(calls).toBe(0);expect(existsSync(join(f.path,'snapshots',result.fact.taskId+'.json'))).toBe(true);}
 finally{Stats.prototype.isDirectory=directory;Stats.prototype.isSymbolicLink=symlink;}
});
it('does not execute an own Stats field getter and joins its visible original sidecar before close',async()=>{
 const f=fixture();let release!:()=>void,entered!:()=>void;const held=new Promise<void>(yes=>{release=yes;}),ready=new Promise<void>(yes=>{entered=yes;});let getters=0,first=true,settled=false,closed=false;
 control.syncHook=(name,original,args)=>{const raw=Reflect.apply(original,undefined,args);if(name==='lstatSync'&&args[0]===f.path){const mode=raw.mode;Object.defineProperty(raw,'mode',{get(){getters++;return mode;}});Object.defineProperty(raw,Symbol('actual-stat-sdk-tail'),{value:held});if(first){first=false;entered();}}return raw;};
 const preparing=f.prepare().then(()=>{settled=true;},()=>{settled=true;});await ready;const closing=f.io.drain().then(()=>{closed=true;},()=>{closed=true;});
 try{await delay(15);expect(getters).toBe(0);expect(settled).toBe(false);expect(closed).toBe(false);}
 finally{release();await preparing;await closing;}
});
it('joins actual realpathSync non-scalar return tails before ending the original writer queue',async()=>{
 const f=fixture();let release!:()=>void,entered!:()=>void;const held=new Promise<void>(yes=>{release=yes;}),ready=new Promise<void>(yes=>{entered=yes;});let first=true,settled=false,closed=false;
 control.syncHook=(name,original,args)=>{const value=Reflect.apply(original,undefined,args);if(name==='realpathSync'&&args[0]===f.path&&first){first=false;const raw=Promise.resolve(value);Object.defineProperty(raw,Symbol('actual-realpath-sdk-tail'),{value:held});entered();return raw;}return value;};
 const preparing=f.prepare().then(()=>{settled=true;},()=>{settled=true;});await ready;const closing=f.io.drain().then(()=>{closed=true;},()=>{closed=true;});
 try{await delay(15);expect(settled).toBe(false);expect(closed).toBe(false);}
 finally{release();await preparing;await closing;}
});
it('keeps its real lock descriptor open until a synchronous SDK return sidecar finishes, then closes it',async()=>{
 const f=fixture();let release!:()=>void,entered!:()=>void;const held=new Promise<void>(yes=>{release=yes;}),ready=new Promise<void>(yes=>{entered=yes;});let descriptor:number|undefined,settled=false,closed=false;
 control.syncHook=(name,original,args)=>{const value=Reflect.apply(original,undefined,args);if(name==='fsyncSync'&&descriptor===undefined){descriptor=args[0] as number;const raw=Promise.resolve(value);Object.defineProperty(raw,Symbol('actual-fsync-tail'),{value:held});entered();return raw;}return value;};
 const preparing=f.prepare().then(()=>{settled=true;},()=>{settled=true;});await ready;const closing=f.io.drain().then(()=>{closed=true;},()=>{closed=true;});
 try{await delay(15);expect(settled).toBe(false);expect(closed).toBe(false);expect(()=>fstatSync(descriptor!)).not.toThrow();}
 finally{release();await preparing;await closing;control.syncHook=undefined;}
 expect(()=>fstatSync(descriptor!)).toThrow();
});
it('preserves the actual lock body error before a close failure and independently attempts temp cleanup',async()=>{
 const f=fixture(),body=Error('actual lock fsync failed'),cleanup=Error('actual lock close failed');let descriptor:number|undefined,unlinks=0;
 control.syncHook=(name,original,args)=>{if(name==='fsyncSync'){descriptor=args[0] as number;throw body;}if(name==='closeSync'&&args[0]===descriptor)throw cleanup;if(name==='unlinkSync')unlinks++;return Reflect.apply(original,undefined,args);};
 try{const error=await f.prepare().catch(error=>error);expect(error).toBeInstanceOf(AggregateError);expect(error.cause).toBe(body);expect(error.errors[0]).toBe(body);expect(error.errors[1]).toBe(cleanup);expect(unlinks).toBeGreaterThan(0);await expect(f.io.drain()).rejects.toThrow();}
 finally{control.syncHook=undefined;if(descriptor!==undefined){closeSync(descriptor);console.log(JSON.stringify({fixture:'sync-lock-fd-cleanup',descriptors:1,notProductDrain:true}));}}
});
it('refuses fake, copied and foreign private sync keys before invoking their SDK or candidate getters',()=>{
 const f=fixture();let gets=0,calls=0;const fake=new Proxy({},{get(){gets++;throw Error('candidate getter');}});
 expect(()=>acquireSaveLock(join(f.root,'fake-lock'),fake)).toThrow('SOURCE_SYNC_CONTEXT_REQUIRED');
 expect(()=>registerSourceSyncCustodyOwner(f.store,()=>{})).toThrow('SOURCE_SYNC_OWNER_ALREADY_REGISTERED');
 const context=createSourceSyncCustodyContext(f.store,{});
 expect(()=>invokeSourceSyncSdk(context,'string',()=>{calls++;return'fake';},[])).toThrow('TASK_SNAPSHOT_SOURCE_SYNC_CONTEXT_REQUIRED');
 expect(()=>invokeSourceSyncSdk({...context},'string',()=>{calls++;return'fake';},[])).toThrow('SOURCE_SYNC_CONTEXT_REQUIRED');
 expect(gets).toBe(0);expect(calls).toBe(0);expect(existsSync(join(f.root,'fake-lock'))).toBe(false);
});
it('does not coerce a late random object while constructing actual prepared checkpoint temp names',async()=>{
 const f=fixture(),random=Math.random;let coercions=0,hits=0;
 Math.random=()=>{hits++;return{toString(){coercions++;return'0.fixture';}} as any;};
 try{await f.prepare();expect(coercions).toBe(0);expect(hits).toBe(0);}finally{Math.random=random;}
});
it('recovers an actual exited owner marker through the same original Source lock and Native SQLite recovery',async()=>{
 const f=fixture(),child=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore'}),closed=once(child,'close');await closed;
 expect(child.exitCode).toBe(0);expect(child.pid).toBeTypeOf('number');console.log(JSON.stringify({fixture:'source-stale-marker-owner',pid:child.pid,exitCode:child.exitCode,reaped:true}));
 mkdirSync(f.path,{recursive:true});const lock=join(f.path,'.task-store.save.lock');writeFileSync(lock,JSON.stringify({version:1,pid:child.pid,hostname:hostname(),nonce:randomUUID()}));
 const originalKill=process.kill;let lateCalls=0;
 process.kill=()=>{lateCalls++;throw Object.assign(Error('late replacement kill'),{code:'EPERM'});};
 try{const result=await f.prepare();expect(existsSync(join(f.path,'snapshots',result.fact.taskId+'.json'))).toBe(true);expect(existsSync(lock)).toBe(false);expect(lateCalls).toBe(0);await f.io.drain();}
 finally{process.kill=originalKill;}
});
it('keeps the original synchronous Native error as close cause when its own cause is unobservable',async()=>{
 const f=fixture(),originalError=Error('actual lstat failure');let getters=0;
 Object.defineProperty(originalError,'cause',{get(){getters++;throw Error('must not inspect cause getter');}});
 control.syncHook=(name,original,args)=>{const value=Reflect.apply(original,undefined,args);if(name==='lstatSync'&&args[0]===f.path)throw originalError;return value;};
 const failure=await f.prepare().catch(error=>error);expect(getters).toBe(0);expect(failure===originalError).toBe(true);
 const close=await f.io.drain().catch(error=>error);expect(getters).toBe(0);expect(close.cause===originalError).toBe(true);
});
for(const phase of ['stale','release'] as const)it(`preserves a real replacement marker installed after the original ${phase} bytes read`,async()=>{
 const f=fixture(),lock=join(f.path,'.task-store.save.lock'),replacement=JSON.stringify({version:1,pid:process.pid,hostname:hostname(),nonce:randomUUID()});
 if(phase==='stale'){const child=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore'});await once(child,'close');expect(child.exitCode).toBe(0);console.log(JSON.stringify({fixture:'replacement-stale-owner',pid:child.pid,exitCode:child.exitCode,reaped:true}));mkdirSync(f.path,{recursive:true});writeFileSync(lock,JSON.stringify({version:1,pid:child.pid,hostname:hostname(),nonce:randomUUID()}));}
 let reads=0,replaced=false;
 control.syncHook=(name,original,args)=>{const value=Reflect.apply(original,undefined,args);if(name==='readFileSync'&&args[0]===lock){const selected=phase==='stale'||String(new Error().stack).includes('readSaveLock');if(selected&&++reads===(phase==='stale'?3:2)){renameSync(lock,lock+'.original');writeFileSync(lock,replacement);replaced=true;}}return value;};
 await f.prepare().catch(()=>{});control.syncHook=undefined;expect(replaced).toBe(true);expect(existsSync(lock)).toBe(true);expect(readFileSync(lock,'utf8')).toBe(replacement);
});

it('rejects actual bigint Stats missing required nanosecond cut fields',async()=>{
 const f=fixture();await f.prepare();let hits=0;
 control.syncHook=(name,original,args)=>{const value=Reflect.apply(original,undefined,args);if(name==='lstatSync'&&(args[1] as any)?.bigint===true){delete value.mtimeNs;delete value.ctimeNs;hits++;}return value;};
 await expect(f.io.observe(f.observation())).rejects.toThrow('TASK_SNAPSHOT_SOURCE_SYNC_STAT_INVALID');expect(hits).toBeGreaterThan(0);
});
