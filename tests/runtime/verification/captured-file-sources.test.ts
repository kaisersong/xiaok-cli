import {setProfileTestHome} from '../../support/profile-home-env.js';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,realpathSync,statSync,rmSync,mkdirSync,readdirSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve,basename} from 'node:path';
const account=vi.hoisted(()=>({home:''}));
const releaseFault=vi.hoisted(()=>({afterPending:false}));
vi.mock('../../../src/utils/atomic-file.js',async load=>{const actual=await load<typeof import('../../../src/utils/atomic-file.js')>();return {...actual,writeFileAtomicallySync:(...args:Parameters<typeof actual.writeFileAtomicallySync>)=>{const result=actual.writeFileAtomicallySync(...args);if(releaseFault.afterPending&&String(args[0]).endsWith('/.session-aliases.json')&&JSON.parse(String(args[1])).rows.some((row:{state:string})=>row.state==='release_pending'))throw Error('fixture_pending_crash');return result;}};});
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return {...actual,userInfo:(options?:Parameters<typeof actual.userInfo>[0])=>{if(!account.home)throw Error('test_profile_account_not_ready');const info=options===undefined?actual.userInfo():actual.userInfo(options);return {...info,homedir:Buffer.isBuffer(info.homedir)?Buffer.from(account.home):account.home};}};});
vi.mock('../../../src/runtime/verification/migration-markers.js',async load=>({...await load<typeof import('../../../src/runtime/verification/migration-markers.js')>(),readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:()=>({kind:'ordinary'})}));
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {computeSessionHistoryDigest} from '../../../src/ai/runtime/session-store/store.js';
import {FileGoalNativeJournal,type GoalNativeMutation} from '../../../src/runtime/goal/native-mutation-journal.js';
import * as capture from '../../../src/runtime/verification/profile-source-capture.js';
const root=realpathSync(mkdtempSync(join(tmpdir(),'captured-file-sources-'))),defaultAccountHome=join(root,'account-default'),directoryHelper=join(root,'directory'),sqliteHelper=join(root,'sqlite');
account.home=defaultAccountHome;setProfileTestHome(account.home);mkdirSync(defaultAccountHome,{recursive:true});
beforeAll(()=>{const sqlite=resolve('node_modules/better-sqlite3/deps/sqlite3'),object=join(root,'sqlite.o');execFileSync('clang',['-O2','-DSQLITE_THREADSAFE=0','-DSQLITE_OMIT_LOAD_EXTENSION=1','-DSQLITE_TEMP_STORE=3','-DSQLITE_ENABLE_DBPAGE_VTAB=1','-c',join(sqlite,'sqlite3.c'),'-o',object],{timeout:30000});execFileSync('clang',['-Wall','-Wextra','-Werror','-std=c11','-I',sqlite,resolve('src/runtime/verification/native/source-sqlite-custody.c'),object,'-o',sqliteHelper]);execFileSync('clang',['-Wall','-Wextra','-Werror','-std=c11',resolve('src/runtime/verification/native/source-lock-custody.c'),'-o',directoryHelper]);},40000);
afterAll(()=>rmSync(root,{recursive:true,force:true}));
function directory(path:string){const s=statSync(path,{bigint:true});return {canonicalPath:path,device:String(s.dev),inode:String(s.ino)}}
function locks(path:string):capture.ProfileCaptureSource[]{return [path,join(path,'.session-execution')].flatMap(parent=>{try{return readdirSync(parent).filter(n=>n.endsWith('.sqlite')).map(n=>{const s=statSync(join(parent,n),{bigint:true});return {sourceId:createHash('sha256').update(join(parent,n)).digest('hex'),kind:'sqlite-db' as const,snapshotFormat:'writer-lock-sqlite-v1' as const,directory:directory(parent),database:{basename:n,device:String(s.dev),inode:String(s.ino)}};});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}});}
async function session(mode:'normal'|'migrated'|'deleted'|'alias'|'released'|'alias-migrated'='normal',existingHolder?:string,options:{path?:string;id?:string}={}){
 const path=options.path??mkdtempSync(join(root,'session-'));mkdirSync(path,{recursive:true});const holder=existingHolder??mkdtempSync(join(root,'holder-')),store=new FileSessionStore(path),snapshot={...new AgentSessionState().exportSnapshot(),...(options.id?{sessionId:options.id}:{})};
 const authority=createSessionExecutionAuthority({root:path,sessionIdentity:snapshot.sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'fixture',scopeId:'fixture'})}),lease=await authority.acquire({invocationId:'fixture',kind:'recovery'});
 try{await store.compareAndSave({nextSnapshot:snapshot,expectedStoreRevision:0,expectedHistoryDigest:computeSessionHistoryDigest({messages:[]}),lease});
 const binding={aliasId:'alias',holderRoot:holder,holderId:'opaque-holder',targetSessionId:snapshot.sessionId,domainInitializationId:'domain',domainGeneration:1,requestSource:'user' as const,lease};
 if(['alias','released','alias-migrated'].includes(mode))await store.registerSessionAlias(binding);
 if(mode==='released')await store.releaseSessionAlias(binding);
 if(mode==='migrated'||mode==='alias-migrated'){const exported=await store.exportSessionForMigration({sessionId:snapshot.sessionId,lease});await store.markSessionMigrated({sessionId:snapshot.sessionId,lease,expectedSnapshotHash:exported.snapshotHash,expectedStoreRevision:exported.storeRevision,migrationId:'migration',targetAuthorityId:'foreign-authority',targetSessionId:'target',migrationEpoch:1,importReceiptHash:'a'.repeat(64)});}
 if(mode==='deleted')await store.deleteSession({requestSource:'user',executionLease:lease,sessionId:snapshot.sessionId,receipts:{begin:()=> 'a'.repeat(64),complete:()=>{}}});
 }finally{await lease.releaseAfterDrain();authority.dispose();}
 const sources:capture.ProfileCaptureSource[]=[{sourceId:basename(path),kind:'session-root',snapshotFormat:'session-root-v1',directory:directory(path)},...locks(path)];
 if(['alias','released','alias-migrated'].includes(mode))sources.push({sourceId:basename(holder),kind:'session-alias-holder',snapshotFormat:'session-alias-holder-v1',directory:directory(join(holder,'.canonical-session-aliases'))});
 return {path,holder,store,id:snapshot.sessionId,sources};
}
async function held(sources:capture.ProfileCaptureSource[],run:(owner:Awaited<ReturnType<typeof capture.startProfileSourceCapture>>,token:object)=>Promise<void>|void){const owner=await capture.startProfileSourceCapture({uid:process.getuid!(),directoryHelper,sqliteHelper,sources,signal:new AbortController().signal});try{const token=await owner.capture();await run(owner,token);await owner.checkCurrent();}finally{await owner.close();}}
it('reads every real source including migrated and deleted history and rejects copied/closed capabilities',async()=>{
 const {readCapturedFileSources}=await import('../../../src/runtime/verification/captured-file-sources.js');const a=await session(),b=await session('migrated'),c=await session('deleted');
 await held([...a.sources,...b.sources,...c.sources],async(owner,token)=>{const facts=readCapturedFileSources(owner,token);expect(facts.sources).toHaveLength(3);expect(facts.sources.flatMap(s=>s.sessions).map(s=>s.containerSessionId).sort()).toEqual([a.id,b.id].sort());expect(facts.sources.flatMap(s=>s.migrations)).toMatchObject([{sessionId:b.id,targetSessionId:'target'}]);expect(facts.sources.flatMap(s=>s.deletions)).toMatchObject([{sessionId:c.id,state:'committed'}]);expect(Object.isFrozen(facts.sources)).toBe(true);expect(()=>readCapturedFileSources({...owner},token)).toThrow('brand');});
 await expect(b.store.load(b.id)).rejects.toThrow('MIGRATED_SESSION');
});
it.each(['alias','released'] as const)('retains real generic holder %s without requiring a Task root',async mode=>{
 const {readCapturedFileSources}=await import('../../../src/runtime/verification/captured-file-sources.js');const f=await session(mode);
 await held(f.sources,(owner,token)=>{const facts=readCapturedFileSources(owner,token);expect(facts.aliases).toMatchObject([{state:mode==='alias'?'active':'released',binding:{holderId:'opaque-holder',targetSessionId:f.id}}]);expect(facts.sources).toHaveLength(2);});
});
it.each(['task-root','session-root','profile-registry'] as const)('reads an actual alias holder nested inside a declared %s',async kind=>{
 const {readCapturedFileSources}=await import('../../../src/runtime/verification/captured-file-sources.js');
 const home=mkdtempSync(join(root,'nested-')),parent=kind==='profile-registry'?join(home,'.xiaok','profile-sources'):home,holder=join(parent,'nested','workspace');mkdirSync(holder,{recursive:true});
 const f=await session('alias',holder);
 const parentSource:capture.ProfileCaptureSource={sourceId:'parent',directory:directory(parent),...(kind==='task-root'?{kind,snapshotFormat:'task-root-v1'}:kind==='session-root'?{kind,snapshotFormat:'session-root-v1'}:{kind,snapshotFormat:'profile-source-registry-v1'})};
 if(kind==='task-root'){const {FileTaskSnapshotStore}=await import('../../../src/runtime/task-host/snapshot-store.js');const tasks=new FileTaskSnapshotStore(parent);await tasks.save({taskId:'parent-task',sessionId:f.id,status:'completed',prompt:'original',materials:[],events:[],createdAt:1,updatedAt:1});await tasks.closeAndDrain();}
 if(kind==='profile-registry'){
  account.home=home;setProfileTestHome(account.home);try{const {registerOrdinaryProfileSource,readOrdinaryProfileSources}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js');registerOrdinaryProfileSource({kind:'session-root',directory:f.path});const sourceId=readOrdinaryProfileSources()!.sources[0]!.sourceId;f.sources=f.sources.map(s=>s.kind==='session-root'?{...s,sourceId}:s);}finally{account.home=defaultAccountHome;setProfileTestHome(account.home);}
 }
 await held([parentSource,...locks(parent),...f.sources],(owner,token)=>{
  const facts=readCapturedFileSources(owner,token);expect(facts.aliases).toMatchObject([{state:'active',binding:{targetSessionId:f.id,holderRoot:holder}}]);
  expect(facts.sources.find(s=>s.sourceId==='parent')!.sourceReferences).toContainEqual(expect.objectContaining({path:'nested/workspace/.canonical-session-aliases',sourceId:basename(holder)}));
 });
});
it('rejects an actual producer-reachable active alias whose target was subsequently migrated',async()=>{
 const {readCapturedFileSources}=await import('../../../src/runtime/verification/captured-file-sources.js');const f=await session('alias-migrated');await expect(f.store.loadSessionAlias({holderRoot:f.holder,holderId:'opaque-holder'})).rejects.toThrow('MIGRATED_SESSION');await held(f.sources,(owner,token)=>expect(()=>readCapturedFileSources(owner,token)).toThrow('captured_file_alias_target'));
});
it.each(['wrong-hash','duplicate','missing-body'] as const)('rejects captured migration %s before returning partial source facts',async mode=>{
 const {readCapturedFileSources}=await import('../../../src/runtime/verification/captured-file-sources.js');const f=await session('migrated'),file=join(f.path,'.migrations',f.id+'.json');
 if(mode==='missing-body')unlinkSync(join(f.path,f.id+'.json'));else{let raw=readFileSync(file,'utf8');raw=mode==='duplicate'?raw.replace('"sessionId":','"sessionId":"hidden","sessionId":'):JSON.stringify({...JSON.parse(raw),expectedSnapshotHash:'b'.repeat(64)});writeFileSync(file,raw);}
 await held(f.sources,(owner,token)=>expect(()=>readCapturedFileSources(owner,token)).toThrow());
});
it.each([false,true,'oversize-bom'] as const)('reads the original hashed Goal native journal for a session identity containing path characters (BOM=%s)',async bom=>{
 const {readCapturedFileSources}=await import('../../../src/runtime/verification/captured-file-sources.js');const path=mkdtempSync(join(root,'goals-')),journal=new FileGoalNativeJournal(path),sid='../other';
 const next:GoalNativeMutation={id:'mutation',revision:1,sessionId:sid,kind:'create',previous:null,target:{version:1,kind:'goal',sessionId:sid,goalId:'goal',epoch:1,objective:'Original',completionCriterion:null,expectedEvidenceKinds:['answer']},turnLimit:3,definition:{version:1,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'content',path:'result.txt',sha256:'a'.repeat(64),structure:'utf8'}]}}]},enrollmentRequestId:'enroll',applicationRequestId:'apply',status:'reserved',createdAt:1,updatedAt:1};journal.put({sessionId:sid,requestSource:'user',expectedRevision:null,next});
 if(bom){const file=join(path,createHash('sha256').update(sid).digest('hex')+'.native-goal.json'),bytes=readFileSync(file);writeFileSync(file,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),bytes,...(bom==='oversize-bom'?[Buffer.alloc(2*1024**2-bytes.length,32)]:[])]));if(bom==='oversize-bom')expect(()=>journal.load(sid)).toThrow();else expect(journal.load(sid)).toEqual([next]);}
 await held([{sourceId:'goals',kind:'goal-file-root',snapshotFormat:'goal-file-root-v1',directory:directory(path)},...locks(path)],(owner,token)=>{if(bom==='oversize-bom')expect(()=>readCapturedFileSources(owner,token)).toThrow();else expect(readCapturedFileSources(owner,token).sources[0]!.nativeGoals).toEqual([{sessionId:sid,records:[next]}]);});
});

it('allows real release in root A followed by registration of the same opaque holder in root B',async()=>{
 const {readCapturedFileSources}=await import('../../../src/runtime/verification/captured-file-sources.js');const a=await session('released'),b=await session('alias',a.holder);
 await held([...a.sources.filter(s=>s.kind!=='session-alias-holder'),...b.sources],(owner,token)=>{const facts=readCapturedFileSources(owner,token);expect(facts.aliases.map(a=>[a.state,a.binding.targetSessionId])).toEqual(expect.arrayContaining([['released',a.id],['active',b.id]]));});
});
it.each(['unprotected','wrong-marker-root','orphan-marker','revived-released'] as const)('rejects an invalid original alias relation: %s',async mode=>{
 const {readCapturedFileSources}=await import('../../../src/runtime/verification/captured-file-sources.js');const f=await session(mode==='revived-released'?'released':'alias');
 const markerPath=join(f.holder,'.canonical-session-aliases',createHash('sha256').update('opaque-holder').digest('hex')+'.json');
 if(mode==='unprotected'){const file=join(f.path,f.id+'.json'),v=JSON.parse(readFileSync(file,'utf8'));delete v.executionProtected;writeFileSync(file,JSON.stringify(v));}
 if(mode==='wrong-marker-root'){const v=JSON.parse(readFileSync(markerPath,'utf8'));v.canonicalRoot=root;writeFileSync(markerPath,JSON.stringify(v));}
 if(mode==='orphan-marker'){const file=join(f.path,'.session-aliases.json');writeFileSync(file,JSON.stringify({version:1,rows:[]}));}
 if(mode==='revived-released'){const binding=JSON.parse(readFileSync(join(f.path,'.session-aliases.json'),'utf8')).rows[0];delete binding.state;writeFileSync(markerPath,JSON.stringify({version:1,canonicalRoot:f.path,binding}));}
 await held(f.sources,(owner,token)=>expect(()=>readCapturedFileSources(owner,token)).toThrow());
});
it('revokes captured file declarations after actual close',async()=>{
 const {readCapturedFileSources}=await import('../../../src/runtime/verification/captured-file-sources.js');const f=await session(),owner=await capture.startProfileSourceCapture({uid:process.getuid!(),directoryHelper,sqliteHelper,sources:f.sources,signal:new AbortController().signal});try{const token=await owner.capture();expect(readCapturedFileSources(owner,token).sources).toHaveLength(1);await owner.close();expect(()=>readCapturedFileSources(owner,token)).toThrow('closed');}finally{await owner.close();}
});
it.each(['modern','legacy'] as const)('captures terminal Task history and all active %s pointers with soft missing context',async mode=>{
 const {readCapturedFileSources}=await import('../../../src/runtime/verification/captured-file-sources.js');const {FileTaskSnapshotStore}=await import('../../../src/runtime/task-host/snapshot-store.js');const {FileGoalStore}=await import('../../../src/runtime/goal/file-store.js');const {createGoalState}=await import('../../../src/runtime/goal/reducer.js');
 const taskPath=mkdtempSync(join(root,'tasks-')),goalPath=mkdtempSync(join(root,'goals-')),tasks=new FileTaskSnapshotStore(taskPath),goals=new FileGoalStore(goalPath);
 const initial={taskId:'history',sessionId:'historical-session',status:'running' as const,prompt:'original',materials:[],events:[],createdAt:1,updatedAt:1,context:{taskIds:['absent'],loadedTaskIds:[],skipped:[{taskId:'absent',reason:'missing' as const}]}};
 await tasks.save(initial);await tasks.save({...initial,status:'completed',updatedAt:2});await tasks.save({...initial,taskId:'active',sessionId:'current',context:undefined});await tasks.closeAndDrain();
 writeFileSync(join(taskPath,'active-task.json'),JSON.stringify(mode==='modern'?{activeTaskIds:['active']}:{activeTaskId:'active'}));
 const state=createGoalState({sessionId:'thread',objective:'Original goal',expectedEvidenceKinds:['answer'],now:1});await goals.commit({sessionId:'thread',expectedRevision:null,next:state,events:[],turns:[],evidence:[]});
 await held([{sourceId:'tasks',kind:'task-root',snapshotFormat:'task-root-v1',directory:directory(taskPath)},...locks(taskPath),{sourceId:'goals',kind:'goal-file-root',snapshotFormat:'goal-file-root-v1',directory:directory(goalPath)},...locks(goalPath)],(owner,token)=>{const facts=readCapturedFileSources(owner,token),task=facts.sources.find(s=>s.sourceId==='tasks')!;expect(task.tasks).toHaveLength(2);expect(task.activeTaskIds).toEqual(['active']);expect(task.tasks.find(t=>t.taskId==='history')!.references).toContainEqual(expect.objectContaining({namespace:'task',id:'absent'}));expect(facts.sources.find(s=>s.sourceId==='goals')!.goals[0]!.declaredGoalIds).toEqual([state.goalId]);});
});
it.each(['body-present','unlinked'] as const)('retains real pending deletion after %s producer failure without declaring settlement',async mode=>{
 const {readCapturedFileSources}=await import('../../../src/runtime/verification/captured-file-sources.js');const {writeFileAtomicallySync}=await import('../../../src/utils/atomic-file.js');const f=await session(),original=readFileSync(join(f.path,f.id+'.json'));
 const store=new FileSessionStore(f.path,(path,bytes,options)=>{if(mode==='unlinked'&&path.includes('.deletions')&&JSON.parse(String(bytes)).state==='committed')throw Error('fixture_commit_failed');writeFileAtomicallySync(path,bytes,options);});
 await expect(store.deleteSession({requestSource:'user',sessionId:f.id,receipts:{begin:()=>{if(mode==='body-present')throw Error('fixture_receipt_failed');return 'a'.repeat(64);},complete:()=>{}}})).rejects.toThrow(mode==='body-present'?'fixture_receipt_failed':'fixture_commit_failed');
 await held(f.sources,(owner,token)=>{const facts=readCapturedFileSources(owner,token),source=facts.sources[0]!;expect(source.deletions).toMatchObject([{state:'pending',snapshotHash:createHash('sha256').update(original).digest('hex')}]);expect(source.sessions).toHaveLength(mode==='body-present'?1:0);});
});
it('the existing native capture rejects cross-root hardlinks before any declaration read',async()=>{
 const {linkSync}=await import('node:fs');const a=await session(),b=await session();const original=join(a.path,a.id+'.json'),target=join(b.path,'legacy.json');linkSync(original,target);
 const owner=await capture.startProfileSourceCapture({uid:process.getuid!(),directoryHelper,sqliteHelper,sources:[...a.sources,...b.sources],signal:new AbortController().signal});try{await expect(owner.capture()).rejects.toThrow();}finally{await owner.close();}
});

it('retains Task-to-observation identity after the actual Session producer committed deletion',async()=>{
 const {readCapturedFileSources}=await import('../../../src/runtime/verification/captured-file-sources.js');const {FileTaskSnapshotStore}=await import('../../../src/runtime/task-host/snapshot-store.js');const {desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');
 const path=mkdtempSync(join(root,'deleted-sidecar-')),tasks=new FileTaskSnapshotStore(path);await tasks.save({taskId:'task',sessionId:'business',status:'completed',prompt:'original',materials:[],events:[],createdAt:1,updatedAt:1});await tasks.closeAndDrain();
 const sidecar=await session('deleted',undefined,{path:join(path,'protected-observation-sessions'),id:desktopObservationSessionId('task')});
 await held([{sourceId:'task',kind:'task-root',snapshotFormat:'task-root-v1',directory:directory(path)},...locks(path),...sidecar.sources],(owner,token)=>{const facts=readCapturedFileSources(owner,token);expect(facts.observationSides).toContainEqual(expect.objectContaining({taskIds:['task'],sessionIdentity:sidecar.id,state:'deletion-committed',missingReasons:['body-absent']}));});
});

it.each(['complete','missing-source','bom','oversize-bom'] as const)('reads the original account registry and requires every recorded source: %s',async mode=>{
 const {readCapturedFileSources}=await import('../../../src/runtime/verification/captured-file-sources.js');const {registerOrdinaryProfileSource,readOrdinaryProfileSources}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js');
 account.home=mkdtempSync(join(root,'account-'));setProfileTestHome(account.home);try{const f=await session();registerOrdinaryProfileSource({kind:'session-root',directory:f.path});const original=readOrdinaryProfileSources()!,registered=original.sources[0]!,path=join(account.home,'.xiaok','profile-sources');
 const sources:capture.ProfileCaptureSource[]=[{sourceId:'registry',kind:'profile-registry',snapshotFormat:'profile-source-registry-v1',directory:directory(path)},...locks(path),...(mode!=='missing-source'?f.sources.map(s=>s.kind==='session-root'?{...s,sourceId:registered.sourceId}:s):[])];
 if(mode==='bom'||mode==='oversize-bom'){const file=join(path,'registry.json'),bytes=readFileSync(file);writeFileSync(file,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),bytes,...(mode==='oversize-bom'?[Buffer.alloc(512*1024-bytes.length,32)]:[])]));if(mode==='oversize-bom')expect(()=>readOrdinaryProfileSources()).toThrow();else expect(readOrdinaryProfileSources()).toEqual(original);}
 await held(sources,(owner,token)=>{if(mode==='missing-source')expect(()=>readCapturedFileSources(owner,token)).toThrow('captured_file_registry_reference');else if(mode==='oversize-bom')expect(()=>readCapturedFileSources(owner,token)).toThrow();else expect(readCapturedFileSources(owner,token).sources.find(s=>s.kind==='profile-registry')!.registry).toEqual(original);});
 }finally{account.home=defaultAccountHome;setProfileTestHome(account.home);}
});

it.each([['release_pending',true],['release_pending',false],['released',true],['released',false]] as const)('requires the actual holder source for %s (included=%s)',async(state,included)=>{
 const {readCapturedFileSources}=await import('../../../src/runtime/verification/captured-file-sources.js');const f=await session(state==='released'?'released':'alias');
 if(state==='release_pending'){
  const authority=createSessionExecutionAuthority({root:f.path,sessionIdentity:f.id,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'fixture',scopeId:'release'})}),lease=await authority.acquire({invocationId:'release',kind:'recovery'});
  try{releaseFault.afterPending=true;await expect(f.store.releaseSessionAlias({aliasId:'alias',holderRoot:f.holder,holderId:'opaque-holder',targetSessionId:f.id,domainInitializationId:'domain',domainGeneration:1,requestSource:'user',lease})).rejects.toThrow('fixture_pending_crash');}finally{releaseFault.afterPending=false;await lease.releaseAfterDrain();authority.dispose();}
 }
 await held(included?f.sources:f.sources.filter(s=>s.kind!=='session-alias-holder'),(owner,token)=>{if(included)expect(readCapturedFileSources(owner,token).aliases[0]!.state).toBe(state);else expect(()=>readCapturedFileSources(owner,token)).toThrow('alias_holder_source');});
});
it('preserves the original FileSession JSON rejection of a leading UTF-8 BOM',async()=>{
 const {readCapturedFileSources}=await import('../../../src/runtime/verification/captured-file-sources.js');const f=await session(),path=join(f.path,f.id+'.json');writeFileSync(path,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),readFileSync(path)]));
 await expect(f.store.load(f.id)).rejects.toThrow();
 await held(f.sources,(owner,token)=>expect(()=>readCapturedFileSources(owner,token)).toThrow());
});
