// @vitest-environment node
import {afterAll,afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,readdirSync,readFileSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';

const privateConfig=await vi.hoisted(async()=>{
 const fs=await import('node:fs'),path=await import('node:path'),os=await import('node:os');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'loop-autocommit-config-'));fs.chmodSync(root,0o700);
 const previous=process.env.XIAOK_CONFIG_DIR;process.env.XIAOK_CONFIG_DIR=root;return {root,previous};
});
const nativeDescriptor=Object.getOwnPropertyDescriptor;
const descriptorDescriptor=nativeDescriptor(Object,'getOwnPropertyDescriptor')!;
const closeDescriptor=nativeDescriptor(DatabaseSync.prototype,'close')!;
const rawClose=DatabaseSync.prototype.close,rawExec=DatabaseSync.prototype.exec;
type Modules={
 helper:typeof import('../../electron/loop-sqlite-autocommit.js');
 owner:typeof import('../../electron/loop-database-owner.js');
 migration:typeof import('../../electron/loop-native-schema.js');
 hidden:WeakSet<object>;
};
type Group=ReturnType<Modules['owner']['createLoopDatabaseOwnerGroup']>;
const databases=new Set<DatabaseSync>(),physicallyClosed=new Set<DatabaseSync>();
const groups:Array<{group:Group;db:DatabaseSync}>=[];
const faults:Array<{enabled:boolean}>=[];
let root:string;
beforeEach(()=>{vi.resetModules();root=mkdtempSync(join(privateConfig.root,'case-'));});
afterEach(()=>{
 const errors:unknown[]=[];
 for(const fault of faults.splice(0))fault.enabled=false;
 Object.defineProperty(Object,'getOwnPropertyDescriptor',descriptorDescriptor);
 Object.defineProperty(DatabaseSync.prototype,'close',closeDescriptor);
 vi.restoreAllMocks();
 for(const {group,db} of groups.splice(0).reverse()){
  if(physicallyClosed.has(db))continue;
  try{group.close();physicallyClosed.add(db);}catch(raw){errors.push(raw);}
 }
 // This is test-owned physical cleanup, never a production held-cell reset.
 for(const db of databases){
  if(physicallyClosed.has(db))continue;
  try{Reflect.apply(rawClose,db,[]);physicallyClosed.add(db);}catch(raw){errors.push(raw);}
 }
 databases.clear();physicallyClosed.clear();
 try{rmSync(root,{recursive:true,force:true,maxRetries:10});}catch(raw){errors.push(raw);}
 if(errors.length)throw new AggregateError(errors,'loop_autocommit_test_cleanup');
});
afterAll(()=>{
 if(privateConfig.previous===undefined)delete process.env.XIAOK_CONFIG_DIR;
 else process.env.XIAOK_CONFIG_DIR=privateConfig.previous;
 rmSync(privateConfig.root,{recursive:true,force:true,maxRetries:10});
});

async function load(fallback=true,closeFault?:'before'|'after'):
 Promise<Modules & {fault:{enabled:boolean}}>{
 const hidden=new WeakSet<object>(),fault={enabled:closeFault!==undefined};faults.push(fault);
 // Modern Node's accessor is own/nonconfigurable. Hide only the exact DBs
 // this fixture subsequently records; all other descriptor reads stay native.
 const observedDescriptor=vi.fn((target:object,key:PropertyKey)=>{
  if(fallback&&key==='isTransaction'&&hidden.has(target))return undefined;
  return nativeDescriptor(target,key);
 });
 Object.defineProperty(Object,'getOwnPropertyDescriptor',{...descriptorDescriptor,value:observedDescriptor});
 if(closeFault){
  const observedClose=vi.fn(function(this:DatabaseSync){
   if(fault.enabled&&closeFault==='before')throw undefined;
   Reflect.apply(rawClose,this,[]);physicallyClosed.add(this);
   if(fault.enabled&&closeFault==='after')throw undefined;
  });
  Object.defineProperty(DatabaseSync.prototype,'close',{...closeDescriptor,value:observedClose});
 }
 try{
  const helper=await import('../../electron/loop-sqlite-autocommit.js');
  const owner=await import('../../electron/loop-database-owner.js');
  const migration=await import('../../electron/loop-native-schema.js');
  return {helper,owner,migration,hidden,fault};
 }finally{
  // Restore the exact global descriptors. The helper retains its captured
  // functions, not mutable public slots or a caller-provided reset callback.
  Object.defineProperty(Object,'getOwnPropertyDescriptor',descriptorDescriptor);
  Object.defineProperty(DatabaseSync.prototype,'close',closeDescriptor);
 }
}
function open(m:Modules,name='actual.sqlite'){
 const file=join(root,name),group=m.owner.createLoopDatabaseOwnerGroup([file]);
 const source=group.sources[0]!,lease=m.owner.openLoopDatabase(source),db=lease.database;
 databases.add(db);m.hidden.add(db);groups.push({group,db});
 db.exec('CREATE TABLE original(value INTEGER);INSERT INTO original VALUES(1)');
 return {file,group,source,lease,db};
}
function close(group:Group,db:DatabaseSync){group.close();physicallyClosed.add(db);}
function thrown(run:()=>unknown){
 let caught:{raw:unknown}|undefined;try{run();}catch(raw){caught={raw};}
 expect(caught).toBeDefined();return caught!.raw;
}
function held(error:unknown){
 expect(error).toBeInstanceOf(Error);
 expect((error as Error).message).toBe('loop_database_metadata_transaction');
 expect(nativeDescriptor(error as object,'cause')).toMatchObject({value:undefined});
}
function exec(db:DatabaseSync,sql:string){return Reflect.apply(rawExec,db,[sql]);}
function snapshot(){return readdirSync(root).sort().map(name=>{
 const file=join(root,name),bytes=readFileSync(file),stat=statSync(file,{bigint:true});
 return {name,bytes:String(stat.size),mtime:String(stat.mtimeNs),sha:createHash('sha256').update(bytes).digest('hex')};
});}

it('uses the real missing-getter fallback without changing original DB/WAL/SHM bytes or mtime',async()=>{
 const m=await load(),f=open(m);f.db.prepare('SELECT * FROM original').all();
 const actual=nativeDescriptor(f.db,'isTransaction');
 if(process.versions.node.startsWith('22.14.'))expect(actual).toBeUndefined();
 const trace:string[]=[];
 vi.spyOn(f.db,'exec').mockImplementation(function(this:DatabaseSync,sql:string){trace.push(sql);return exec(this,sql);});
 const before=snapshot();m.helper.assertLoopSQLiteAutocommit(f.db,'loop_database_metadata_transaction');
 expect(trace).toEqual(['BEGIN DEFERRED','ROLLBACK']);expect(snapshot()).toEqual(before);
 f.lease.recordComponent('loop');expect(m.owner.describeLoopDatabaseSource(f.source)).toMatchObject({components:['loop'],journalMode:'wal'});
 close(f.group,f.db);
});

it('uses an actual modern own getter without calling SQL, or reports its absence on the minimum runtime',async()=>{
 const m=await load(false),f=open(m),own=nativeDescriptor(f.db,'isTransaction');
 if(!own&&!nativeDescriptor(DatabaseSync.prototype,'isTransaction')){
  expect(process.versions.node.startsWith('22.14.')).toBe(true);
  close(f.group,f.db);return;
 }
 expect(typeof (own??nativeDescriptor(DatabaseSync.prototype,'isTransaction'))?.get).toBe('function');
 const sql=vi.spyOn(f.db,'exec').mockImplementation(()=>{throw Error('modern getter must not probe SQL');});
 m.helper.assertLoopSQLiteAutocommit(f.db,'loop_database_metadata_transaction');
 exec(f.db,'BEGIN IMMEDIATE;INSERT INTO original VALUES(2)');
 expect(()=>m.helper.assertLoopSQLiteAutocommit(f.db,'loop_database_metadata_transaction')).toThrow('loop_database_metadata_transaction');
 expect(sql).not.toHaveBeenCalled();m.helper.assertLoopSQLiteReady();
 expect(f.db.prepare('SELECT COUNT(*) n FROM original').get()?.n).toBe(2);
 exec(f.db,'ROLLBACK');expect(f.db.prepare('SELECT COUNT(*) n FROM original').get()?.n).toBe(1);
 close(f.group,f.db);
});

it.each(['before','after']as const)('holds a bare undefined %s actual BEGIN without rolling back a transaction it cannot own',async phase=>{
 const m=await load(),f=open(m),trace:string[]=[];
 vi.spyOn(f.db,'exec').mockImplementation(function(this:DatabaseSync,sql:string){
  trace.push(sql);if(sql==='BEGIN DEFERRED'){if(phase==='before')throw undefined;exec(this,sql);throw undefined;}return exec(this,sql);
 });
 const error=thrown(()=>m.owner.describeLoopDatabaseSource(f.source));held(error);
 expect(trace).toEqual(['BEGIN DEFERRED']);
 if(phase==='after')expect(()=>exec(f.db,'BEGIN DEFERRED')).toThrow();else exec(f.db,'BEGIN DEFERRED');
 f.db.prepare('INSERT INTO original VALUES(2)').run();
 expect(f.db.prepare('SELECT COUNT(*) n FROM original').get()?.n).toBe(2);
 exec(f.db,'ROLLBACK');expect(f.db.prepare('SELECT COUNT(*) n FROM original').get()?.n).toBe(1);
 expect(thrown(()=>m.helper.assertLoopSQLiteReady())).toBe(error);
 close(f.group,f.db);m.helper.assertLoopSQLiteReady();
});

it.each(['before','after']as const)('holds a bare undefined %s actual probe ROLLBACK until the original negative close returns',async phase=>{
 const m=await load(),f=open(m),trace:string[]=[];
 vi.spyOn(f.db,'exec').mockImplementation(function(this:DatabaseSync,sql:string){
  trace.push(sql);if(sql==='ROLLBACK'){if(phase==='before')throw undefined;exec(this,sql);throw undefined;}return exec(this,sql);
 });
 const error=thrown(()=>m.owner.describeLoopDatabaseSource(f.source));held(error);
 expect(trace).toEqual(['BEGIN DEFERRED','ROLLBACK']);
 if(phase==='before')expect(()=>exec(f.db,'BEGIN DEFERRED')).toThrow();else exec(f.db,'BEGIN DEFERRED');
 exec(f.db,'ROLLBACK');expect(thrown(()=>m.helper.assertLoopSQLiteReady())).toBe(error);
 close(f.group,f.db);m.helper.assertLoopSQLiteReady();
});

it('rejects held metadata, existing and new leases and path/source Proxies before FS or argument traps',async()=>{
 const m=await load(),f=open(m);
 vi.spyOn(f.db,'exec').mockImplementation((sql:string)=>{if(sql==='BEGIN DEFERRED')throw undefined;return exec(f.db,sql);});
 const error=thrown(()=>m.owner.describeLoopDatabaseSource(f.source));held(error);
 let traps=0;const handler={get(){traps++;throw Error('path or source touched');},ownKeys(){traps++;throw Error('ownKeys');},getPrototypeOf(){traps++;throw Error('prototype');},getOwnPropertyDescriptor(){traps++;throw Error('descriptor');}};
 const paths=new Proxy([]as string[],handler),source=new Proxy({},handler);
 const unborn=join(root,'never-born','new.sqlite');
 for(const read of [()=>m.owner.createLoopDatabaseOwnerGroup(paths),()=>m.owner.createLoopDatabaseOwnerGroup([unborn]),()=>m.owner.openLoopDatabase(source as never),()=>m.owner.describeLoopDatabaseSource(source as never),()=>m.owner.openLoopDatabase(f.source),()=>f.lease.database,()=>f.lease.recordComponent('completion'),()=>m.owner.describeLoopDatabaseSource(f.source)])expect(thrown(read)).toBe(error);
 expect(traps).toBe(0);expect(existsSync(join(root,'never-born'))).toBe(false);
 close(f.group,f.db);m.helper.assertLoopSQLiteReady();
 const next=open(m,'new.sqlite');expect(next.db.prepare('SELECT COUNT(*) n FROM original').get()?.n).toBe(1);close(next.group,next.db);
});

it('does not clear a held connection on foreign DB close, and only clears after same DB original group close',async()=>{
 const m=await load(),f=open(m),foreign=new DatabaseSync(':memory:');databases.add(foreign);
 vi.spyOn(f.db,'exec').mockImplementation((sql:string)=>{if(sql==='BEGIN DEFERRED')throw undefined;return exec(f.db,sql);});
 const error=thrown(()=>m.owner.describeLoopDatabaseSource(f.source));held(error);
 m.helper.closeLoopSQLiteDatabase(foreign);physicallyClosed.add(foreign);
 expect(thrown(()=>m.helper.assertLoopSQLiteReady())).toBe(error);
 close(f.group,f.db);m.helper.assertLoopSQLiteReady();
 expect(()=>m.owner.describeLoopDatabaseSource(f.source)).toThrow('loop_database_closed');
});

it.each(['before','after']as const)('keeps the original held raw/cause when captured NativeClose throws undefined %s its real call',async phase=>{
 const m=await load(true,phase),f=open(m);
 vi.spyOn(f.db,'exec').mockImplementation((sql:string)=>{if(sql==='BEGIN DEFERRED')throw undefined;return exec(f.db,sql);});
 const error=thrown(()=>m.owner.describeLoopDatabaseSource(f.source));held(error);
 // The public prototype is already restored: only the captured function faults.
 expect(DatabaseSync.prototype.close).toBe(rawClose);
 const aggregate=thrown(()=>f.group.close())as AggregateError;
 expect(aggregate).toBeInstanceOf(AggregateError);expect(aggregate.errors).toHaveLength(1);expect(aggregate.errors[0]).toBeUndefined();
 expect(thrown(()=>m.helper.assertLoopSQLiteReady())).toBe(error);
 if(phase==='before'){
  m.fault.enabled=false;close(f.group,f.db);m.helper.assertLoopSQLiteReady();
 }else{
  // Test instrumentation saw rawClose return, but production still correctly
  // retains uncertainty. Never use SELECT/isOpen to declare its cell cleared.
  expect(physicallyClosed.has(f.db)).toBe(true);
  expect(thrown(()=>m.helper.assertLoopSQLiteReady())).toBe(error);
 }
});

it('rejects real legacy migration inside an outer transaction before changing FK/schema and preserves its pending row',async()=>{
 const m=await load(),f=open(m);
 f.db.exec(`CREATE TABLE loop_publication_candidates(candidate_id text primary key);
 INSERT INTO loop_publication_candidates VALUES('candidate');
 CREATE TABLE loop_native_attempts(attempt_id text primary key,candidate_id text not null references loop_publication_candidates(candidate_id),revision integer not null,ordinal integer not null,original_source text not null,binding_hash text not null,source_vector_hash text not null,configuration_revision integer not null,definition_hash text not null,enrollment_request_id text not null unique,application_request_id text not null unique,phase text not null,created_at integer not null,updated_at integer not null,unique(candidate_id,ordinal));
 INSERT INTO loop_native_attempts VALUES('attempt','candidate',1,1,'user','hash','vector',1,'definition','enrollment','application','enrolled',20,20);
 CREATE INDEX native_phase_extra ON loop_native_attempts(phase);`);
 const rows=f.db.prepare('SELECT * FROM loop_native_attempts').all();
 const schema=f.db.prepare("SELECT type,name,sql FROM sqlite_master WHERE tbl_name='loop_native_attempts' ORDER BY type,name").all();
 const fk=f.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys;
 exec(f.db,'BEGIN IMMEDIATE;INSERT INTO original VALUES(2)');
 expect(()=>m.migration.migrateLoopNativeSchema(f.db)).toThrow('loop_native_migration_outer_transaction');
 expect(f.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(fk);
 expect(f.db.prepare('SELECT COUNT(*) n FROM original').get()?.n).toBe(2);
 expect(f.db.prepare('SELECT * FROM loop_native_attempts').all()).toEqual(rows);
 expect(f.db.prepare("SELECT type,name,sql FROM sqlite_master WHERE tbl_name='loop_native_attempts' ORDER BY type,name").all()).toEqual(schema);
 exec(f.db,'ROLLBACK');expect(f.db.prepare('SELECT COUNT(*) n FROM original').get()?.n).toBe(1);
 close(f.group,f.db);m.helper.assertLoopSQLiteReady();
});
