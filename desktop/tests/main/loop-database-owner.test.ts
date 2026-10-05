// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,symlinkSync,linkSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {join,relative} from 'node:path';import {tmpdir} from 'node:os';import {DatabaseSync} from 'node:sqlite';
import {createDesktopLoopRuntime} from '../../electron/loop-executor.js';
import {KSWARM_SERVICE_HEALTH_LOOP_ID,KSwarmServiceHealthScanner} from '../../electron/kswarm-health-loop.js';
import {LoopStore} from '../../electron/loop-store.js';
import {CompletionEvidenceStore} from '../../electron/completion-evidence-store.js';
import {createLoopDatabaseOwnerGroup,openLoopDatabase} from '../../electron/loop-database-owner.js';
const cleanup:Array<()=>void>=[];afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();});
function root(){const path=mkdtempSync(join(tmpdir(),'loop-db-owner-'));cleanup.push(()=>rmSync(path,{recursive:true,force:true}));return path;}
const database=(store:unknown)=>(store as {db:DatabaseSync}).db;
it('uses the same real database in all four original runtime stores and closes it once',()=>{
 const runtime=createDesktopLoopRuntime({dataRoot:root()});cleanup.push(()=>runtime.close());const db=database(runtime.loopStore);for(const store of [runtime.evidenceStore,runtime.scanner,runtime.kswarmHealthScanner])expect(database(store)).toBe(db);
 runtime.evidenceStore.upsertExpectation({ownerKind:'task',ownerId:'actual',expectedKinds:['answer'],source:'task_spec',confidence:'explicit',now:1});expect(()=>runtime.evidenceStore.completeOwnerWithEvidence({ownerKind:'task',ownerId:'actual',now:2})).toThrow();expect(runtime.scanner.scan({now:3}).scannedOwnerCount).toBe(1);runtime.close();expect(()=>db.prepare('SELECT 1').get()).toThrow();expect(()=>runtime.close()).not.toThrow();
});
it('revokes a closed store without closing the shared database used by its sibling',()=>{
 const group=createLoopDatabaseOwnerGroup([join(root(),'actual.sqlite')]);cleanup.push(()=>group.close());const loops=new LoopStore(group.sources[0]),evidence=new CompletionEvidenceStore(group.sources[0]);loops.ensureBuiltInLoops(1);loops.close();expect(()=>loops.listLoopDefinitions()).toThrow('loop_database_closed');expect(()=>evidence.upsertExpectation({ownerKind:'task',ownerId:'other',expectedKinds:['answer'],source:'task_spec',confidence:'explicit',now:1})).not.toThrow();evidence.close();group.close();expect(()=>openLoopDatabase(group.sources[0])).toThrow('loop_database_closed');
});
it('shares relative and realpath aliases but keeps actually different files separate',()=>{
 const dir=root(),path=join(dir,'actual.sqlite'),initial=new DatabaseSync(path);initial.close();const aliasParent=join(dir,'alias-parent');symlinkSync(dir,aliasParent,process.platform==='win32'?'junction':'dir');const alias=join(aliasParent,'actual.sqlite');const group=createLoopDatabaseOwnerGroup([path,relative(process.cwd(),path),alias,join(dir,'different.sqlite')]);cleanup.push(()=>group.close());const leases=group.sources.map(openLoopDatabase);expect(leases[0].database).toBe(leases[1].database);expect(leases[0].database).toBe(leases[2].database);expect(leases[3].database).not.toBe(leases[0].database);for(const lease of leases)lease.close();
});
it('rejects forged sources and raw database handles',()=>{const db=new DatabaseSync(':memory:');try{for(const source of [{},db])expect(()=>openLoopDatabase(source as never)).toThrow('loop_database_source');}finally{db.close();}});
it('closes a standalone database on store close and makes close idempotent',()=>{const store=new CompletionEvidenceStore(join(root(),'standalone.sqlite')),db=database(store);store.close();expect(()=>db.prepare('SELECT 1').get()).toThrow();expect(()=>store.close()).not.toThrow();});
it('keeps explicit evidence and loop databases distinct in the actual runtime',()=>{const dir=root(),runtime=createDesktopLoopRuntime({dataRoot:dir,completionEvidenceDbPath:join(dir,'evidence.sqlite'),loopDbPath:join(dir,'loops.sqlite')});cleanup.push(()=>runtime.close());expect(database(runtime.loopStore)).not.toBe(database(runtime.evidenceStore));expect(database(runtime.scanner)).toBe(database(runtime.evidenceStore));expect(database(runtime.kswarmHealthScanner)).toBe(database(runtime.evidenceStore));});

it('preserves independent standalone memory databases and explicitly shared memory sources',()=>{
 const a=new CompletionEvidenceStore(':memory:'),b=new CompletionEvidenceStore(':memory:');try{expect(database(a)).not.toBe(database(b));a.upsertExpectation({ownerKind:'task',ownerId:'memory',expectedKinds:['answer'],source:'task_spec',confidence:'explicit',now:1});expect(database(b).prepare('SELECT COUNT(*) n FROM completion_expectations').get()?.n).toBe(0);}finally{a.close();b.close();}
 const group=createLoopDatabaseOwnerGroup([':memory:',':memory:']);try{expect(openLoopDatabase(group.sources[0]).database).toBe(openLoopDatabase(group.sources[1]).database);}finally{group.close();}
});
it('retains the actual database until a deferred runtime health run has really settled',async()=>{
 let reject!:(error:Error)=>void;const probe=new Promise<never>((_resolve,no)=>{reject=no;});const runtime=createDesktopLoopRuntime({dataRoot:root(),kswarmHealthProbe:()=>probe});cleanup.push(()=>runtime.close());const db=database(runtime.loopStore),run=runtime.runner.runLoopNow(KSWARM_SERVICE_HEALTH_LOOP_ID,undefined,undefined,{requestSource:'user'});
 expect(()=>runtime.close()).toThrow('loop_runtime_not_drained');expect(db.prepare('SELECT 1').get()).toBeDefined();expect(()=>runtime.kswarmHealthScanner.scan()).toThrow('loop_scanner_closed');await expect(runtime.runner.runLoopNow(KSWARM_SERVICE_HEALTH_LOOP_ID,undefined,undefined,{requestSource:'user'})).rejects.toThrow('loop_runtime_closed');reject(Error('actual unavailable probe'));expect((await run).status).toBe('blocked');runtime.close();expect(()=>db.prepare('SELECT 1').get()).toThrow();
});
it('retains a directly invoked scanner probe until its real completion and refuses new scans while closing',async()=>{
 let reject!:(error:Error)=>void;const probe=new Promise<never>((_resolve,no)=>{reject=no;});const scanner=new KSwarmServiceHealthScanner(join(root(),'health.sqlite'),{probe:()=>probe});const db=database(scanner),pending=scanner.scan({now:1});expect(()=>scanner.close()).toThrow('loop_scanner_not_drained');expect(()=>scanner.scan()).toThrow('loop_scanner_closed');expect(db.prepare('SELECT 1').get()).toBeDefined();reject(Error('actual probe error'));await pending;scanner.close();expect(()=>db.prepare('SELECT 1').get()).toThrow();
});
it('enforces one actual page cap across all four original writers and preserves autocommit after every FULL',()=>{
 const dir=root(),runtime=createDesktopLoopRuntime({dataRoot:dir,kswarmHealthProbe(){throw Error('x'.repeat(128*1024));}});cleanup.push(()=>runtime.close());const db=database(runtime.loopStore);runtime.evidenceStore.upsertExpectation({ownerKind:'task',ownerId:'retained',expectedKinds:['answer'],source:'task_spec',confidence:'explicit',now:1});expect(()=>runtime.evidenceStore.completeOwnerWithEvidence({ownerKind:'task',ownerId:'retained',now:2})).toThrow();
 db.exec('PRAGMA journal_mode=DELETE');const pages=Number(db.prepare('PRAGMA page_count').get()?.page_count);db.exec('PRAGMA max_page_count='+pages);const long='x'.repeat(128*1024);
 for(const write of [()=>runtime.loopStore.createUserLoopTemplate({loopId:'too-big',title:'actual',kind:'task_completion',prompt:long,outputDirectory:'',outputFileName:'',now:3}),()=>runtime.evidenceStore.insertEvidence({ownerKind:'task',ownerId:'retained',kind:'answer',summary:long,now:4}),()=>runtime.scanner.scan({loopRunId:long,now:5}),()=>runtime.kswarmHealthScanner.scan({loopRunId:long,now:6})]){expect(write).toThrow(/full/i);expect(db.isTransaction).toBe(false);expect(Number(db.prepare('PRAGMA page_count').get()?.page_count)).toBe(pages);expect(db.prepare('SELECT owner_id FROM completion_expectations').get()?.owner_id).toBe('retained');}
 expect(runtime.loopStore.getUserLoopTemplate('too-big')).toBeUndefined();runtime.close();const reopened=new DatabaseSync(join(dir,'loop-evidence.sqlite'));try{expect(reopened.prepare('SELECT owner_id FROM completion_expectations').get()?.owner_id).toBe('retained');expect(reopened.prepare('SELECT * FROM user_loop_templates').all()).toHaveLength(0);}finally{reopened.close();}
});

it('closes every newly opened database when actual PRAGMA initialization hits a locked file',()=>{
 const dir=root(),locked=join(dir,'locked.sqlite'),blocker=new DatabaseSync(locked);blocker.exec('CREATE TABLE actual(id INTEGER); BEGIN EXCLUSIVE');const original=DatabaseSync.prototype.exec,opened=new Set<DatabaseSync>();const spy=vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){if(sql==='PRAGMA journal_mode=WAL')opened.add(this);return original.call(this,sql);});
 try{expect(()=>createLoopDatabaseOwnerGroup([join(dir,'first.sqlite'),locked])).toThrow(/locked/);expect(opened.size).toBe(2);for(const db of opened)expect(()=>db.prepare('SELECT 1').get()).toThrow();}finally{spy.mockRestore();blocker.exec('ROLLBACK');blocker.close();}
 const retry=createLoopDatabaseOwnerGroup([join(dir,'first.sqlite'),locked]);retry.close();
});
it('closes the real runtime database when an existing incompatible schema rejects construction',()=>{
 const dir=root(),path=join(dir,'loop-evidence.sqlite'),initial=new DatabaseSync(path);initial.exec('CREATE TABLE loop_definitions(broken TEXT)');initial.close();const original=DatabaseSync.prototype.exec,opened=new Set<DatabaseSync>();const spy=vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){if(sql==='PRAGMA journal_mode=WAL')opened.add(this);return original.call(this,sql);});
 try{expect(()=>createDesktopLoopRuntime({dataRoot:dir})).toThrow();expect(opened.size).toBe(1);for(const db of opened)expect(()=>db.prepare('SELECT 1').get()).toThrow();}finally{spy.mockRestore();}
});

it('deduplicates an actual hard-link identity within one owner group',()=>{
 const dir=root(),path=join(dir,'original.sqlite'),alias=join(dir,'alias.sqlite'),initial=new DatabaseSync(path);initial.close();linkSync(path,alias);const group=createLoopDatabaseOwnerGroup([path,alias]);try{expect(openLoopDatabase(group.sources[0]).database).toBe(openLoopDatabase(group.sources[1]).database);}finally{group.close();}
});
it.each(['different','dangling'])('calls the real production owner in a fresh Node process with unreliable file identity: %s',mode=>{
 const output=execFileSync(process.execPath,['--import','tsx',fileURLToPath(new URL('../support/loop-database-owner-identity-worker.ts',import.meta.url)),mode],{encoding:'utf8',timeout:15000});const result=JSON.parse(output);expect(result.ok).toBe(true);expect(result.maskedStatCalls).toBeGreaterThanOrEqual(2);
});
