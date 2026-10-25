import {setProfileTestHome} from '../../support/profile-home-env.js';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdirSync,mkdtempSync,realpathSync,readFileSync,writeFileSync,readdirSync,rmSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const fixture=vi.hoisted(()=>({home:'',reads:0,denyAccount:false}));
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return {...actual,userInfo:()=>{fixture.reads++;if(fixture.denyAccount)throw Error('unexpected_posix_locator');return {...actual.userInfo(),homedir:fixture.home};}};});
vi.mock('../../../src/runtime/verification/migration-markers.js',()=>({readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
import {SQLiteSessionStore} from '../../../src/ai/runtime/session-store/sqlite-store.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {createKnownDirectoryWriterFence} from '../../../src/runtime/verification/known-directory-writer-fence.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
let root:string;const stores:SQLiteSessionStore[]=[];
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'known-sqlite-session-')));fixture.home=join(root,'account');setProfileTestHome(fixture.home);mkdirSync(fixture.home,{mode:0o750});mkdirSync(join(fixture.home,'.xiaok'),{mode:0o755});mkdirSync(join(fixture.home,'.xiaok','profile-sources'),{mode:0o700});fixture.denyAccount=false;fixture.reads=0;});
afterEach(()=>{fixture.denyAccount=false;for(const store of stores.splice(0).reverse())store.dispose();rmSync(root,{recursive:true,force:true});});
const snapshot=()=>({...new AgentSessionState().exportSnapshot(),sessionId:'source',cwd:root});
function open(path:string){const store=new SQLiteSessionStore(path);stores.push(store);return store;}
async function seeded(){const directory=join(root,'sessions'),path=join(directory,'sessions.db'),store=open(path);await store.save(snapshot());const original=(await store.load('source'))!;return {directory,path,store,original};}
const fence=(directory:string)=>createKnownDirectoryWriterFence(directory,'sqlite-db').persist();
function files(path:string){return Object.fromEntries(['','-wal','-shm'].filter(suffix=>existsSync(path+suffix)).map(suffix=>[suffix,{bytes:readFileSync(path+suffix),inode:statSync(path+suffix).ino}]));}
for(const operation of ['save','CAS','migration'] as const)it(`rejects cached actual SQLite Session ${operation} while preserving original complete DB WAL SHM bytes and reads/export`,async()=>{
 const f=await seeded(),authority=createSessionExecutionAuthority({root:f.directory,sessionIdentity:'source',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'owner',scopeId:operation})}),lease=await authority.acquire({invocationId:'original',kind:'recovery'});
 try{const exported=await f.store.exportSessionForMigration({sessionId:'source',lease});fence(f.directory);const before=files(f.path);
 if(operation==='save')await expect(f.store.save({...f.original,updatedAt:f.original.updatedAt+1},{lease})).rejects.toThrow('fenced');
 if(operation==='CAS')await expect(f.store.compareAndSave({expectedStoreRevision:f.original.storeRevision!,expectedHistoryDigest:f.original.historyDigest!,nextSnapshot:f.original,lease})).rejects.toThrow('fenced');
 if(operation==='migration')await expect(f.store.markSessionMigrated({sessionId:'source',expectedSnapshotHash:exported.snapshotHash,expectedStoreRevision:exported.storeRevision,migrationId:'migration-1',targetAuthorityId:'authority-1',targetSessionId:'target',migrationEpoch:1,importReceiptHash:'a'.repeat(64),lease})).rejects.toThrow('fenced');
 expect(await f.store.load('source')).toEqual(f.original);expect(await f.store.exportSessionForMigration({sessionId:'source',lease})).toEqual(exported);expect(await f.store.getSessionMigration('source')).toBeNull();expect(files(f.path)).toEqual(before);
 }finally{await lease.releaseAfterDrain();authority.dispose();}
});
it('rejects reconstructed and same-directory new basename SQLite Session constructors before database open',async()=>{
 const f=await seeded();fence(f.directory);const before=files(f.path),fresh=join(f.directory,'another.db');expect(()=>open(f.path)).toThrow('fenced');expect(()=>open(fresh)).toThrow('fenced');expect(existsSync(fresh)).toBe(false);expect(files(f.path)).toEqual(before);
});
it('rejects an independent Node actual SQLite Session constructor with the confirmed record',async()=>{
 const f=await seeded();fence(f.directory);const before=files(f.path),script=join(root,'child.mjs');writeFileSync(script,`import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';const original=os.userInfo.bind(os);os.userInfo=()=>({...original(),homedir:${JSON.stringify(fixture.home)}});syncBuiltinESMExports();const {SQLiteSessionStore}=await import(${JSON.stringify(pathToFileURL(join(process.cwd(),'src/ai/runtime/session-store/sqlite-store.ts')).href)});try{const store=new SQLiteSessionStore(${JSON.stringify(f.path)});store.dispose();throw Error('unexpected open');}catch(error){if(!/fenced/.test(String(error)))throw error;}`);
 const result=await new Promise<{code:number|null;stderr:string}>((done,reject)=>{const child=spawn(process.execPath,['--import','tsx',script],{cwd:process.cwd(),stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',data=>stderr+=data);child.once('error',reject);child.once('close',code=>done({code,stderr}));});expect(result.code,result.stderr).toBe(0);expect(files(f.path)).toEqual(before);
});
it('keeps original readonly missing probe and new first write plus another directory namespace',async()=>{
 const directory=join(root,'first');createKnownDirectoryWriterFence(directory,'sqlite-db').assertOpen();expect(readdirSync(join(fixture.home,'.xiaok','profile-sources'))).toEqual([]);const store=open(join(directory,'first.db'));await store.save(snapshot());expect(readdirSync(join(fixture.home,'.xiaok','profile-sources'))).not.toContain('writer-fences');fence(directory);const other=open(join(root,'other','other.db'));await other.save(snapshot());expect((await other.load('source'))?.sessionId).toBe('source');
});
it('denies a new fork before root or source execution lock effects after actual publication',async()=>{
 const f=await seeded();fence(f.directory);const before=files(f.path);await expect(f.store.fork('source')).rejects.toThrow('fenced');expect(existsSync(join(f.directory,'.session-store-lock'))).toBe(false);expect(files(f.path)).toEqual(before);
});
it('lets an already accepted original fork settle across its actual load await while denying new admission',async()=>{
 const f=await seeded(),originalLoad=f.store.load.bind(f.store);let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(done=>enter=done),gate=new Promise<void>(done=>release=done);vi.spyOn(f.store,'load').mockImplementation(async id=>{const actual=await originalLoad(id);enter();await gate;return actual;});const work=f.store.fork('source');await entered;expect(existsSync(join(f.directory,'.session-store-lock'))).toBe(true);
 try{fence(f.directory);await expect(f.store.save(f.original)).rejects.toThrow('fenced');await expect(f.store.fork('source')).rejects.toThrow('fenced');release();const forked=await work;expect((await originalLoad(forked.sessionId))?.forkedFromSessionId).toBe('source');expect(existsSync(join(f.directory,'.session-store-lock'))).toBe(false);}finally{release();await work.catch(()=>{});}
});
it('preserves an already started synchronous CAS transaction and real notification after lower-level publication inside beforeCommit',async()=>{
 const f=await seeded(),authority=createSessionExecutionAuthority({root:f.directory,sessionIdentity:'source',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'owner',scopeId:'accepted-sync'})}),lease=await authority.acquire({invocationId:'original',kind:'compaction'}),notifications:number[]=[];f.store.onCommit(s=>{notifications.push(s.storeRevision!);});
 try{const receipt=await f.store.compareAndSave({expectedStoreRevision:f.original.storeRevision!,expectedHistoryDigest:f.original.historyDigest!,nextSnapshot:f.original,lease,beforeCommit:()=>fence(f.directory)});expect(receipt.storeRevision).toBe(f.original.storeRevision!+1);expect(notifications).toEqual([receipt.storeRevision]);await expect(f.store.save((await f.store.load('source'))!,{lease})).rejects.toThrow('fenced');}finally{await lease.releaseAfterDrain();authority.dispose();}
});
it('rejects borrowed commit and migration owners before caller this/input getters or database/lock effects',()=>{
 const prototype=SQLiteSessionStore.prototype as unknown as {commitSnapshot(...args:unknown[]):unknown;markSessionMigratedLocked(...args:unknown[]):unknown};let reads=0;const fake={get dbPath(){reads++;throw Error('unexpected_path');},get mutationInProgress(){reads++;throw Error('unexpected_state');},get db(){reads++;throw Error('unexpected_db');}};expect(()=>prototype.commitSnapshot.call(fake,{get sessionId(){reads++;throw Error('unexpected_input');}})).toThrow('owner');expect(()=>prototype.markSessionMigratedLocked.call(fake,{get lease(){reads++;throw Error('unexpected_lease');}})).toThrow('owner');expect(reads).toBe(0);
});
for(const path of [':memory:',''])it(`preserves original ${JSON.stringify(path)} ephemeral constructor/save/read without added POSIX locator`,async()=>{
 const previous=process.cwd();process.chdir(root);try{fixture.denyAccount=true;fixture.reads=0;const store=open(path);await store.save(snapshot());expect((await store.load('source'))?.sessionId).toBe('source');expect(fixture.reads).toBe(0);expect(readdirSync(join(fixture.home,'.xiaok','profile-sources'))).toEqual([]);}finally{process.chdir(previous);}
});
it('preserves the original Windows ordinary component branch without new POSIX locator',async()=>{
 fixture.denyAccount=true;fixture.reads=0;const platform=vi.spyOn(process,'platform','get').mockReturnValue('win32');try{const store=open(join(root,'windows','sessions.db'));await store.save(snapshot());expect((await store.load('source'))?.sessionId).toBe('source');expect(fixture.reads).toBe(0);expect(readdirSync(join(fixture.home,'.xiaok','profile-sources'))).toEqual([]);}finally{platform.mockRestore();}
});

it('rejects caller rootLockHeld and forged accepted-fork token on a genuine owner before any original SQL or source lock effects',async()=>{
 const f=await seeded(),before=files(f.path),privateStore=f.store as unknown as {commitSnapshot(...args:unknown[]):unknown;commitSnapshotLocked(...args:unknown[]):unknown};expect(()=>privateStore.commitSnapshot(f.original,undefined,'source',undefined,true)).toThrow('owner');expect(()=>privateStore.commitSnapshot(f.original,undefined,'source',undefined,true,undefined,{})).toThrow('owner');expect(()=>privateStore.commitSnapshotLocked(f.original,undefined,'source',undefined,true,undefined,{})).toThrow('owner');expect(files(f.path)).toEqual(before);expect(existsSync(join(f.directory,'.session-store-lock'))).toBe(false);
});

it('denies all 16 original Intent public entry points before raw getters or consuming host-only publication tickets',async()=>{
 const f=await seeded();fence(f.directory);const before=files(f.path),methods=['recordIntentReceiverPublication','recordIntentVerificationOperation','observeIntentVerificationEnrollment','claimIntentVerificationEnrollment','reserveIntentVerificationExecution','retryIntentPublicationApplication','observeIntentPublicationApplication','claimIntentPublicationApplication','reserveIntentParentPublicationCandidate','reserveIntentPublicationCandidate','reserveIntentNativeContract','advanceIntentNativeContractSubject','retryIntentNativeContractSubject','transitionIntentSessionOwnership','recordIntentProducerAction','recordIntentExecutionTerminal'];let reads=0;const raw={get sessionId(){reads++;throw Error('unexpected_raw_getter');},get lease(){reads++;throw Error('unexpected_lease_getter');},get ticket(){reads++;throw Error('unexpected_ticket_getter');}},actual=f.store as unknown as Record<string,(input:unknown)=>Promise<unknown>>;const failures=[];for(const name of methods){failures.push([name,await actual[name](raw).then(()=>undefined,error=>String(error))]);}expect(failures).toEqual(methods.map(name=>[name,expect.stringContaining('fenced')]));expect(reads).toBe(0);expect(files(f.path)).toEqual(before);
});

it('rejects every borrowed public mutation owner before this or raw DTO getters',async()=>{
 const methods=['recordIntentReceiverPublication','recordIntentVerificationOperation','observeIntentVerificationEnrollment','claimIntentVerificationEnrollment','reserveIntentVerificationExecution','retryIntentPublicationApplication','observeIntentPublicationApplication','claimIntentPublicationApplication','reserveIntentParentPublicationCandidate','reserveIntentPublicationCandidate','reserveIntentNativeContract','advanceIntentNativeContractSubject','retryIntentNativeContractSubject','transitionIntentSessionOwnership','recordIntentProducerAction','recordIntentExecutionTerminal','save','compareAndSave','fork','markSessionMigrated'];let reads=0;const fake={get dbPath(){reads++;throw Error('unexpected_path');},get mutationInProgress(){reads++;throw Error('unexpected_state');}},raw={get sessionId(){reads++;throw Error('unexpected_input');},get lease(){reads++;throw Error('unexpected_lease');}},prototype=SQLiteSessionStore.prototype as unknown as Record<string,(input:unknown)=>Promise<unknown>>,failures=[];for(const name of methods){failures.push([name,await prototype[name].call(fake,raw).then(()=>undefined,error=>String(error))]);}expect(failures).toEqual(methods.map(name=>[name,expect.stringContaining('owner')]));expect(reads).toBe(0);
});
