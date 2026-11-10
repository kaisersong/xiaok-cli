// @vitest-environment node
import {afterAll,afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const faults=vi.hoisted(()=>({sql:'',primary:undefined as unknown,closeFailure:undefined as {raw:unknown}|undefined,constructorFailure:undefined as {raw:unknown}|undefined,target:undefined as import('node:sqlite').DatabaseSync|undefined,created:[] as import('node:sqlite').DatabaseSync[]}));
const isolated=await vi.hoisted(async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'loop-birth-config-'))),previous=process.env.XIAOK_CONFIG_DIR;
 fs.chmodSync(root,0o700);process.env.XIAOK_CONFIG_DIR=path.join(root,'.xiaok');return {root,previous};
});
vi.mock('node:sqlite',async load=>{
 const actual=await load<typeof import('node:sqlite')>();
 return {...actual,DatabaseSync:class extends actual.DatabaseSync {
  constructor(...args:ConstructorParameters<typeof actual.DatabaseSync>){super(...args);faults.created.push(this);if(faults.constructorFailure)throw faults.constructorFailure.raw;}
 }};
});
vi.mock('../../../src/runtime/verification/migration-markers.js',()=>({readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
const nativeExec=DatabaseSync.prototype.exec,nativeClose=DatabaseSync.prototype.close;
function caught(fn:()=>unknown){try{fn();return {present:false,raw:undefined};}catch(raw){return {present:true,raw};}}
beforeEach(()=>{
 vi.resetModules();faults.sql='';faults.primary=undefined;faults.closeFailure=undefined;faults.constructorFailure=undefined;faults.target=undefined;faults.created.length=0;
 vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){
  if(sql===faults.sql){faults.sql='';faults.target=this;throw faults.primary;}return Reflect.apply(nativeExec,this,[sql]);
 });
 vi.spyOn(DatabaseSync.prototype,'close').mockImplementation(function(this:DatabaseSync){
  if(this===faults.target&&faults.closeFailure)throw faults.closeFailure.raw;return Reflect.apply(nativeClose,this,[]);
 });
});
afterEach(()=>{
 vi.restoreAllMocks();
 // Test-only cleanup cannot certify the product's held unknown row.
 for(const db of faults.created){try{Reflect.apply(nativeClose,db,[]);}catch(raw){if((raw as NodeJS.ErrnoException)?.code!=='ERR_INVALID_STATE')throw raw;}}
 faults.created.length=0;
});
afterAll(()=>{if(isolated.previous===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=isolated.previous;rmSync(isolated.root,{recursive:true,force:true});});

it.each(['PRAGMA journal_mode=WAL','PRAGMA foreign_keys=ON','PRAGMA busy_timeout=5000'].flatMap(sql=>[false,true].map(bare=>({sql,bare}))))('keeps original $sql primary (undefined=$bare) and releases a known closed memory birth',async({sql,bare})=>{
 const {createLoopDatabaseOwnerGroup}=await import('../../electron/loop-database-owner.js');faults.sql=sql;faults.primary=bare?undefined:Error('initialization-failure');
 const result=caught(()=>createLoopDatabaseOwnerGroup([':memory:']));expect(result.present).toBe(true);expect(result.raw).toBe(faults.primary);
 expect(()=>faults.target!.prepare('SELECT 1')).toThrow('database is not open');
 const next=createLoopDatabaseOwnerGroup([':memory:']);next.close();
});
it.each([false,true])('retains the actual failed-close connection (undefined=$0) before paths and runtime options',async bare=>{
 const {createLoopDatabaseOwnerGroup}=await import('../../electron/loop-database-owner.js');faults.sql='PRAGMA foreign_keys=ON';faults.primary=undefined;faults.closeFailure={raw:bare?undefined:Error('close-unconfirmed')};
 const result=caught(()=>createLoopDatabaseOwnerGroup([':memory:']));expect(result.present).toBe(true);expect(result.raw).toBeUndefined();
 expect(faults.target!.prepare('SELECT 1 AS live').get()?.live).toBe(1);
 let reads=0;const paths=new Proxy([] as string[],{get(){reads++;throw Error('paths-read');}}),options=new Proxy({},{get(){reads++;throw Error('options-read');}});
 expect(()=>createLoopDatabaseOwnerGroup(paths)).toThrow('loop_database_birth_unconfirmed');
 const {createDesktopLoopRuntime}=await import('../../electron/loop-executor.js');
 expect(()=>createDesktopLoopRuntime(options as never)).toThrow('loop_database_birth_unconfirmed');expect(reads).toBe(0);expect(faults.created).toHaveLength(1);
});
it('keeps the original primary symbol Promise after known close until that exact tail settles',async()=>{
 const {createLoopDatabaseOwnerGroup}=await import('../../electron/loop-database-owner.js');let settle!:()=>void;const tail=new Promise<void>(resolve=>{settle=resolve;});
 const primary=Error('primary-with-tail');Object.defineProperty(primary,Symbol('tail'),{value:tail});faults.primary=primary;faults.sql='PRAGMA foreign_keys=ON';
 try{expect(caught(()=>createLoopDatabaseOwnerGroup([':memory:'])).raw).toBe(primary);expect(()=>faults.target!.prepare('SELECT 1')).toThrow('database is not open');expect(()=>createLoopDatabaseOwnerGroup([':memory:'])).toThrow('loop_database_birth_unconfirmed');}
 finally{settle();await tail;await new Promise<void>(resolve=>setImmediate(resolve));}
 const next=createLoopDatabaseOwnerGroup([':memory:']);next.close();
});
it('attempts all entered sibling connections once when a later initialization fails',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'loop-birth-siblings-')));
 try{
 const {createLoopDatabaseOwnerGroup}=await import('../../electron/loop-database-owner.js');const closed:DatabaseSync[]=[];let initialized=0;
 vi.mocked(DatabaseSync.prototype.exec).mockImplementation(function(this:DatabaseSync,sql:string){if(sql==='PRAGMA foreign_keys=ON'&&++initialized===2){faults.target=this;throw undefined;}return Reflect.apply(nativeExec,this,[sql]);});
 vi.mocked(DatabaseSync.prototype.close).mockImplementation(function(this:DatabaseSync){closed.push(this);return Reflect.apply(nativeClose,this,[]);});
 const result=caught(()=>createLoopDatabaseOwnerGroup([join(root,'first.sqlite'),join(root,'second.sqlite')]));expect(result.present).toBe(true);expect(result.raw).toBeUndefined();expect(faults.created).toHaveLength(2);expect(closed).toEqual([...faults.created].reverse());
 for(const db of closed)expect(()=>db.prepare('SELECT 1')).toThrow('database is not open');
 }finally{rmSync(root,{recursive:true,force:true});}
});
it.each([false,true])('does not turn a constructor throw (undefined=$0) with no returned handle into a healthy later birth',async bare=>{
 const {createLoopDatabaseOwnerGroup}=await import('../../electron/loop-database-owner.js');const primary=bare?undefined:Error('constructor-unconfirmed');faults.constructorFailure={raw:primary};
 const first=caught(()=>createLoopDatabaseOwnerGroup([':memory:']));expect(first.present).toBe(true);expect(first.raw).toBe(primary);faults.constructorFailure=undefined;
 expect(()=>createLoopDatabaseOwnerGroup([':memory:'])).toThrow('loop_database_birth_unconfirmed');expect(faults.created).toHaveLength(1);
});
it('does not certify a non-void Native close result even after the actual DB has closed',async()=>{
 const {createLoopDatabaseOwnerGroup}=await import('../../electron/loop-database-owner.js');faults.sql='PRAGMA foreign_keys=ON';faults.primary=Error('original-primary');
 vi.mocked(DatabaseSync.prototype.close).mockImplementation(function(this:DatabaseSync){Reflect.apply(nativeClose,this,[]);return {uncertified:true} as never;});
 expect(caught(()=>createLoopDatabaseOwnerGroup([':memory:'])).raw).toBe(faults.primary);expect(()=>faults.target!.prepare('SELECT 1')).toThrow('database is not open');
 expect(()=>createLoopDatabaseOwnerGroup([':memory:'])).toThrow('loop_database_birth_unconfirmed');
});
it('preserves published negative close while a different failed birth is unknown',async()=>{
 const {createLoopDatabaseOwnerGroup,openLoopDatabase}=await import('../../electron/loop-database-owner.js');const original=createLoopDatabaseOwnerGroup([':memory:']),lease=openLoopDatabase(original.sources[0]!);const db=lease.database;
 faults.sql='PRAGMA foreign_keys=ON';faults.primary=Error('birth-failure');faults.closeFailure={raw:Error('close-unconfirmed')};expect(caught(()=>createLoopDatabaseOwnerGroup([':memory:'])).present).toBe(true);
 expect(()=>lease.database).toThrow('loop_database_birth_unconfirmed');expect(()=>original.close()).not.toThrow();expect(()=>db.prepare('SELECT 1')).toThrow('database is not open');
});
it('closes a real file after WAL activation and a later PRAGMA failure, then permits the same path',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'loop-birth-wal-'))),file=join(root,'actual.sqlite');
 try{const {createLoopDatabaseOwnerGroup}=await import('../../electron/loop-database-owner.js');faults.sql='PRAGMA foreign_keys=ON';faults.primary=Error('after-wal');expect(caught(()=>createLoopDatabaseOwnerGroup([file])).raw).toBe(faults.primary);expect(()=>faults.target!.prepare('SELECT 1')).toThrow('database is not open');const next=createLoopDatabaseOwnerGroup([file]);next.close();}
 finally{rmSync(root,{recursive:true,force:true});}
});
