// Actual original public writer/SQLite regression. Profile variants only cause denials.
// @vitest-environment node
import {afterAll,expect,it,vi} from 'vitest';
const fixture=await vi.hoisted(async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'loop-existing-writer-account-')));fs.chmodSync(home,0o700);
 const config=path.join(home,'.xiaok');fs.mkdirSync(config,{mode:0o700});const previous=process.env.XIAOK_CONFIG_DIR;process.env.XIAOK_CONFIG_DIR=config;
 return {home,config,previous,kind:'ordinary' as 'ordinary'|'protected'|'unavailable',failure:undefined as {raw:unknown}|undefined,failureOnRead:undefined as number|undefined,profileReads:0};
});
vi.mock('node:os',async original=>{
 const actual=await original<typeof import('node:os')>();return {...actual,homedir:()=>fixture.home,userInfo:(options:Parameters<typeof actual.userInfo>[0])=>{
  const info=actual.userInfo(options);return {...info,homedir:Buffer.isBuffer(info.homedir)?Buffer.from(fixture.home):fixture.home};
 }};
});
// The documented route variants only drive a DENIAL. This is no installation,
// protected index, canonical enrollment, Main/Source proof or Native grant.
vi.mock('../../../src/runtime/verification/migration-markers.js',async original=>({
 ...await original<typeof import('../../../src/runtime/verification/migration-markers.js')>(),
 readInstalledCurrentProfile:()=>{fixture.profileReads++;if(fixture.failure&&(fixture.failureOnRead===undefined||fixture.profileReads>=fixture.failureOnRead))throw fixture.failure.raw;return Object.freeze({kind:fixture.kind});},
}));
vi.mock('../../../src/runtime/verification/ordinary-source-writer-observation.js',async original=>await original());
vi.mock('../../electron/loop-database-source-observation.js',async original=>await original());
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,rmSync,readdirSync,renameSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {createLoopDatabaseOwnerGroup,openLoopDatabase} from '../../electron/loop-database-owner.js';
import {LoopStore} from '../../electron/loop-store.js';
import {ArtifactEvidenceRegressionScanner} from '../../electron/artifact-evidence-regression-loop.js';
import {KSwarmServiceHealthScanner} from '../../electron/kswarm-health-loop.js';
import {createKnownDirectoryWriterFence} from '../../../src/runtime/verification/known-directory-writer-fence.js';
import {CompletionEvidenceStore} from '../../electron/completion-evidence-store.js';
import {registerLoopDatabaseSourceObservation} from '../../electron/loop-database-source-observation.js';
import {readOrdinaryProfileSources} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
const held:unknown[]=[];
afterAll(()=>{
 if(fixture.previous===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=fixture.previous;
 if(!held.length)rmSync(fixture.home,{recursive:true,force:true});
});
// Production runtime intentionally does not publish POSIX registry history on Windows.
function observeOriginalSource(source:ReturnType<typeof createLoopDatabaseOwnerGroup>['sources'][number]){
 if(process.platform==='win32'){
  expect(()=>registerLoopDatabaseSourceObservation(source)).toThrow('profile_source_registry_account');
  expect(()=>readOrdinaryProfileSources()).toThrow('profile_source_registry_account');
 }else registerLoopDatabaseSourceObservation(source);
}
function ids(path:string){const db=new DatabaseSync(path,{readOnly:true});try{return db.prepare('SELECT id FROM completion_evidence ORDER BY id').all().map(row=>row.id);}finally{db.close();}}
it('an existing original Loop writer must stop after its original source admission observes protected and stay stopped on ordinary restoration',()=>{
 const root=join(fixture.home,'data');mkdirSync(root,{mode:0o700});const path=join(root,'actual.sqlite'),group=createLoopDatabaseOwnerGroup([path]),source=group.sources[0],store=new CompletionEvidenceStore(source);
 const write=(id:string)=>store.insertEvidence({id,ownerKind:'task',ownerId:'owned',kind:'answer',summary:id,now:1});
 try{
  observeOriginalSource(source);
  if(process.platform!=='win32')expect(readOrdinaryProfileSources()?.sources.some(s=>s.directory.canonicalPath===root&&s.kind==='sqlite-db')).toBe(true);
  write('before');const before=ids(path);
  fixture.kind='protected';let admission:{raw:unknown}|undefined;try{openLoopDatabase(source);}catch(raw){admission={raw};}
  expect(admission?.raw).toBeInstanceOf(Error);expect(Object.getOwnPropertyDescriptor(admission!.raw as Error,'message')?.value).toBe('loop_ordinary_writer_retired');
  const cause=Object.getOwnPropertyDescriptor(admission!.raw as Error,'cause')?.value;expect(Object.getOwnPropertyDescriptor(cause,'message')?.value).toBe('ordinary_source_route');
  let denied:{raw:unknown}|undefined;try{write('after-cut');}catch(raw){denied={raw};}const afterCut=ids(path);
  fixture.kind='ordinary';let reopened=false;try{const lease=openLoopDatabase(source);reopened=true;lease.close();}catch{/* Expected only after a future sticky implementation. */}
  let restoredDenied:{raw:unknown}|undefined;try{write('after-restoration');}catch(raw){restoredDenied={raw};}const afterRestore=ids(path);
  console.log(JSON.stringify({pid:process.pid,node:process.version,privateConfig:fixture.config,before,sourceAdmissionDeniedAtProtected:true,writerDenied:denied!==undefined,afterCut,reopenedOnOrdinary:reopened,writerDeniedAfterRestore:restoredDenied!==undefined,afterRestore,qualificationClaim:false,scope:'denial-only documented profile variant fixture; no official profile publication claimed'}));
  expect(denied).toBeDefined();expect(afterCut).toEqual(before);expect(reopened).toBe(false);expect(restoredDenied).toBeDefined();expect(afterRestore).toEqual(before);
 }finally{
  fixture.kind='ordinary';try{store.close();group.close();}catch(raw){held.push(group,store,raw);throw raw;}
 }
});

it('prepare-to-run input evaluation must not admit a write after the same source observes the narrowing',()=>{
 const root=join(fixture.home,'argument-data');mkdirSync(root,{mode:0o700});const path=join(root,'actual.sqlite'),group=createLoopDatabaseOwnerGroup([path]),source=group.sources[0],store=new CompletionEvidenceStore(source);
 let getterCalls=0,admissionDenied=false,denied:{raw:unknown}|undefined;
 try{
  observeOriginalSource(source);
  const input={id:'argument-cut',get ownerKind(){getterCalls++;fixture.kind='protected';try{const lease=openLoopDatabase(source);lease.close();}catch{admissionDenied=true;}return 'task' as const;},ownerId:'owned',kind:'answer' as const,summary:'cut during run argument construction',now:1};
  try{store.insertEvidence(input);}catch(raw){denied={raw};}
  const rows=ids(path);
  console.log(JSON.stringify({case:'prepare-to-run',pid:process.pid,node:process.version,getterCalls,admissionDenied,writerDenied:denied!==undefined,rows,qualificationClaim:false}));
  expect(getterCalls).toBe(1);expect(admissionDenied).toBe(true);expect(denied).toBeDefined();expect(rows).toEqual([]);
 }finally{fixture.kind='ordinary';try{store.close();group.close();}catch(raw){held.push(group,store,raw);throw raw;}}
});

function resource(kind:'loop'|'completion'|'artifact'|'health'){
 const root=join(fixture.home,randomUUID());mkdirSync(root,{mode:0o700});const path=join(root,'actual.sqlite'),group=createLoopDatabaseOwnerGroup([path]),source=group.sources[0];
 let store:LoopStore|CompletionEvidenceStore|ArtifactEvidenceRegressionScanner|KSwarmServiceHealthScanner,write:()=>unknown,table:string;
 if(kind==='loop'){
  const value=new LoopStore(source);value.ensureBuiltInLoops(1);const id=value.listLoopDefinitions()[0]!.id;store=value;write=()=>value.setLoopStatus(id,'paused',3);table='loop_definitions';
 }else if(kind==='completion'){
  const value=new CompletionEvidenceStore(source);store=value;write=()=>value.insertEvidence({id:randomUUID(),ownerKind:'task',ownerId:'owned',kind:'answer',summary:'actual',now:2});table='completion_evidence';
 }else if(kind==='artifact'){
  const value=new ArtifactEvidenceRegressionScanner(source);value.scan({now:1});const id=value.listAnomalies()[0]!.id;store=value;write=()=>value.ignoreAnomaly(id,9,3);table='evidence_anomalies';
 }else{
  const value=new KSwarmServiceHealthScanner(source,{probe:()=>{throw Error('fixture diagnostic unavailable');}});value.scan({now:1});store=value;write=()=>value.scan({now:3});table='evidence_anomalies';
 }
 observeOriginalSource(source);
 const rows=()=>{const db=new DatabaseSync(path,{readOnly:true});try{return db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();}finally{db.close();}};
 return {root,path,source,group,store,write,rows,close(){store.close();group.close();}};
}
it.each(['loop','completion','artifact','health'] as const)('actual %s public mutation latches observed profile cut without ordinary resurrection',kind=>{
 const value=resource(kind);try{
  value.write();const before=value.rows();fixture.kind='protected';let first:{raw:unknown}|undefined;try{value.write();}catch(raw){first={raw};}
  expect(first?.raw).toBeInstanceOf(Error);expect(value.rows()).toEqual(before);fixture.kind='ordinary';let restored:{raw:unknown}|undefined;try{value.write();}catch(raw){restored={raw};}
  expect(restored?.raw).toBe(first?.raw);expect(value.rows()).toEqual(before);
 }finally{fixture.kind='ordinary';value.close();}
});
it('a real persisted directory fence retires the same public writer even if its own fixture record is moved away',()=>{
 const value=resource('completion');let record:string|undefined,moved:string|undefined;
 try{
  value.write();const before=value.rows();const fence=createKnownDirectoryWriterFence(value.root,'sqlite-db');
  if(process.platform==='win32'){
   expect(()=>fence.persist()).toThrow('known_writer_fence_platform');
   value.write();const supportedRows=value.rows();expect(supportedRows.length).toBeGreaterThan(before.length);
   fixture.kind='protected';expect(()=>value.write()).toThrow('loop_ordinary_writer_retired');
   fixture.kind='ordinary';expect(()=>value.write()).toThrow('loop_ordinary_writer_retired');expect(value.rows()).toEqual(supportedRows);return;
  }
  fence.persist();
  const directory=join(fixture.home,'.xiaok','profile-sources','writer-fences');const names=readdirSync(directory).filter(name=>name.endsWith('.json'));expect(names.length).toBe(1);record=join(directory,names[0]!);moved=record+'.fixture-moved';
  let first:{raw:unknown}|undefined;try{value.write();}catch(raw){first={raw};}expect(first?.raw).toBeInstanceOf(Error);expect(value.rows()).toEqual(before);
  renameSync(record,moved);expect(()=>value.write()).toThrow('loop_ordinary_writer_retired');expect(value.rows()).toEqual(before);
 }finally{if(record&&moved)renameSync(moved,record);value.close();}
});
it.each(['loop','completion','artifact','health'] as const)('actual %s transaction keeps owned rollback reachable after policy cut, preserving undefined',kind=>{
 const value=resource(kind),lease=openLoopDatabase(value.source),db=lease.database;db.exec('CREATE TABLE policy_probe(value)');let failure:{raw:unknown}|undefined;
 try{
  try{(value.store as unknown as {transaction(fn:()=>void):void}).transaction(()=>{db.exec("INSERT INTO policy_probe VALUES ('uncommitted')");fixture.kind='protected';try{value.write();}catch{/* The original positive writer has observed and latched the cut. */}throw undefined;});}catch(raw){failure={raw};}
  expect(failure).toBeDefined();expect(failure!.raw).toBeUndefined();db.exec('BEGIN');db.exec('ROLLBACK');expect(db.prepare('SELECT * FROM policy_probe').all()).toEqual([]);
 }finally{fixture.kind='ordinary';lease.close();value.close();}
});
it('the first undefined route failure remains an own cause and cannot revive the accepted writer',()=>{
 const value=resource('completion');try{
  fixture.failure={raw:undefined};let first:{raw:unknown}|undefined;try{value.write();}catch(raw){first={raw};}
  expect(first?.raw).toBeInstanceOf(Error);const cause=Object.getOwnPropertyDescriptor(first!.raw as Error,'cause');expect(cause).toBeDefined();expect(cause!.value).toBeUndefined();
  fixture.failure=undefined;expect(()=>value.write()).toThrow('loop_ordinary_writer_retired');expect(value.rows()).toEqual([]);
 }finally{fixture.failure=undefined;value.close();}
});
it('policy Error symbol promise tails stay held through actual database close until their original promise settles',async()=>{
 const value=resource('completion');let settle!:()=>void;const tail=new Promise<void>(resolve=>{settle=resolve;}),raw=new Error('actual route failure');Object.defineProperty(raw,Symbol('tail'),{value:tail});
 fixture.failure={raw};try{
  let first:unknown;try{value.write();}catch(error){first=error;}expect(Object.getOwnPropertyDescriptor(first as Error,'cause')?.value).toBe(raw);
  value.store.close();expect(()=>value.group.close()).toThrow();settle();await tail;await new Promise<void>(resolve=>setImmediate(resolve));value.group.close();
 }finally{fixture.failure=undefined;settle();}
});
it('the Windows absence branch still checks the ordinary route (simulated platform branch, not Windows Native qualification)',()=>{
 const value=resource('completion'),platform=Object.getOwnPropertyDescriptor(process,'platform')!;
 try{
  Object.defineProperty(process,'platform',{...platform,value:'win32'});value.write();const before=value.rows();fixture.kind='protected';expect(()=>value.write()).toThrow('loop_ordinary_writer_retired');expect(value.rows()).toEqual(before);
 }finally{Object.defineProperty(process,'platform',platform);fixture.kind='ordinary';value.close();}
});
it('an uninspectable route Error accessor stays unknown after its promise tail settles, without invoking the getter',async()=>{
 const value=resource('completion');let getterCalls=0;const raw=new Error('unknown route tail');Object.defineProperty(raw,'uninspectable',{get(){getterCalls++;return undefined;}});Object.defineProperty(raw,Symbol('settled'),{value:Promise.resolve()});
 try{
  fixture.failure={raw};expect(()=>value.write()).toThrow('loop_ordinary_writer_retired');fixture.failure=undefined;value.store.close();expect(()=>value.group.close()).toThrow();await new Promise<void>(resolve=>setImmediate(resolve));expect(()=>value.group.close()).toThrow();expect(getterCalls).toBe(0);
  held.push(value,raw);console.log(JSON.stringify({pid:process.pid,scope:'unknown ordinary SQLite writer error graph only; no Native capacity claim',unknownRetained:true,getterCalls,privateRoot:value.root}));
 }finally{fixture.failure=undefined;}
});

it.each(['loop','completion','artifact','health'] as const)('actual %s constructor preserves its first route error when accepted standalone cleanup has a held tail',async kind=>{
 const root=join(fixture.home,randomUUID());mkdirSync(root,{mode:0o700});const path=join(root,'constructor.sqlite');let settle!:()=>void;const tail=new Promise<void>(resolve=>{settle=resolve;}),raw=new Error('constructor route denial');Object.defineProperty(raw,Symbol('held'),{value:tail});
 fixture.profileReads=0;fixture.failureOnRead=4;fixture.failure={raw};let primary:{raw:unknown}|undefined;
 try{
  try{if(kind==='loop')new LoopStore(path);else if(kind==='completion')new CompletionEvidenceStore(path);else if(kind==='artifact')new ArtifactEvidenceRegressionScanner(path);else new KSwarmServiceHealthScanner(path,{probe(){throw Error('not called');}});}catch(error){primary={raw:error};}
  expect(primary).toBeDefined();expect(Object.getOwnPropertyDescriptor(primary!.raw as Error,'message')?.value).toBe('loop_ordinary_writer_retired');expect(Object.getOwnPropertyDescriptor(primary!.raw as Error,'cause')?.value).toBe(raw);
  // A missing returned handle cannot report whole-resource known. Keep the
  // original private root/failure evidence; no caller boolean clears the owner.
  held.push(root,raw,primary);settle();await tail;await new Promise<void>(resolve=>setImmediate(resolve));
 }finally{fixture.failure=undefined;fixture.failureOnRead=undefined;settle();}
});
