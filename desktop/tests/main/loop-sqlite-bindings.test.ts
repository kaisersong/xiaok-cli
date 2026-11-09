// Actual original lease, Native SQLite and private migration membership.
import {afterEach,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {createLoopDatabaseOwnerGroup,openLoopDatabase,readOriginalLoopMigrationLease} from '../../electron/loop-database-owner.js';
import {migrateLoopNativeSchema} from '../../electron/loop-native-schema.js';
import {migrateLoopArtifactExportJournal} from '../../electron/loop-artifact-export-journal.js';
const groups:ReturnType<typeof createLoopDatabaseOwnerGroup>[]=[];
afterEach(()=>{for(const group of groups.splice(0))group.close();});
function setup(){const group=createLoopDatabaseOwnerGroup([':memory:']);groups.push(group);const lease=openLoopDatabase(group.sources[0]);lease.execWrite('CREATE TABLE binding_probe(a,b,c,d)');return {group,lease,db:lease.database};}
it('the genuine Native DB receiver and actual own transaction getter stay intact for closed positional/named/noargs values',()=>{
 const {lease,db}=setup();expect(db).toBeInstanceOf(DatabaseSync);const getter=Object.getOwnPropertyDescriptor(db,'isTransaction');
 expect(lease.runWrite('INSERT INTO binding_probe VALUES(?,?,?,?)','positional',NaN,5n,null).changes).toBe(1);
 const params=Object.assign(Object.create(null),{a:'named',b:Infinity,c:6n,d:null});expect(lease.runWrite('INSERT INTO binding_probe VALUES(@a,@b,@c,@d)',params).changes).toBe(1);
 expect(lease.runWrite("INSERT INTO binding_probe VALUES('noargs',NULL,7,NULL)").changes).toBe(1);
 expect(db.prepare('SELECT a,c FROM binding_probe ORDER BY c').all().map(row=>[row.a,row.c])).toEqual([['positional',5],['named',6],['noargs',7]]);
 expect(Object.getOwnPropertyDescriptor(db,'isTransaction')).toEqual(getter);
 if(getter?.get)expect(Reflect.apply(getter.get,db,[])).toBe(false);
});
it('named binding accessors are rejected without invoking their getter or running a Native write',()=>{
 const {lease,db}=setup();let hits=0;const input={get a(){hits++;return 'unsafe';}};
 expect(()=>lease.runWrite('INSERT INTO binding_probe(a) VALUES(@a)',input)).toThrow('loop_sqlite_binding_descriptor');expect(hits).toBe(0);expect(db.prepare('SELECT * FROM binding_probe').all()).toEqual([]);
});
it('named binding Proxy and copied/foreign private migration relationships reject with zero traps/SQL calls',()=>{
 const {lease,db}=setup();let traps=0;const proxy=new Proxy({}, {get(){traps++;throw Error('get');},ownKeys(){traps++;throw Error('keys');},getOwnPropertyDescriptor(){traps++;throw Error('descriptor');},getPrototypeOf(){traps++;throw Error('prototype');}});
 expect(()=>lease.runWrite('INSERT INTO binding_probe(a) VALUES(@a)',proxy)).toThrow('loop_sqlite_binding_object');
 const prepare=vi.spyOn(db,'prepare');try{
  expect(()=>migrateLoopNativeSchema(db,proxy as never)).toThrow('loop_database_lease');expect(()=>migrateLoopArtifactExportJournal(db,{...lease})).toThrow('loop_database_lease');expect(prepare).not.toHaveBeenCalled();
 }finally{prepare.mockRestore();}
 expect(traps).toBe(0);const other=setup();expect(()=>readOriginalLoopMigrationLease(lease,other.db)).toThrow('loop_database_lease');
});
it.each([Buffer.from('data'),new Uint8Array([1]),new ArrayBuffer(8),new SharedArrayBuffer(8),{nested:1},()=>1,undefined,true])('closed bindings reject mutable/non-SQL scalar values %s before Native writes',value=>{
 const {lease,db}=setup();expect(()=>lease.runWrite('INSERT INTO binding_probe(a) VALUES(@a)',{a:value})).toThrow('loop_sqlite_binding_value');expect(db.prepare('SELECT * FROM binding_probe').all()).toEqual([]);
});
it('symbol and nonenumerable bindings cannot be silently dropped',()=>{
 const {lease,db}=setup(),withSymbol={a:'x',[Symbol('unsafe')]:Promise.resolve()};expect(()=>lease.runWrite('INSERT INTO binding_probe(a) VALUES(@a)',withSymbol)).toThrow('loop_sqlite_binding_key');
 const hidden=Object.defineProperty({},'a',{value:'x',enumerable:false});expect(()=>lease.runWrite('INSERT INTO binding_probe(a) VALUES(@a)',hidden)).toThrow('loop_sqlite_binding_descriptor');expect(db.prepare('SELECT * FROM binding_probe').all()).toEqual([]);
});
it('the actual owned migration keeps legacy rows, FK and original dynamic index/trigger SQL, and restores a working trigger',()=>{
 const {lease,db}=setup();db.exec(`CREATE TABLE loop_publication_candidates(candidate_id text primary key);
 INSERT INTO loop_publication_candidates VALUES('candidate');
 CREATE TABLE loop_native_attempts(attempt_id text primary key,candidate_id text not null references loop_publication_candidates(candidate_id),revision integer not null,ordinal integer not null,original_source text not null,binding_hash text not null,source_vector_hash text not null,configuration_revision integer not null,definition_hash text not null,enrollment_request_id text not null unique,application_request_id text not null unique,phase text not null,created_at integer not null,updated_at integer not null,unique(candidate_id,ordinal));
 INSERT INTO loop_native_attempts VALUES('attempt','candidate',1,1,'user','hash','vector',1,'definition','enrollment','application','enrolled',20,20);
 CREATE INDEX native_phase_extra ON loop_native_attempts(phase);
 CREATE TABLE native_audit(attempt_id text,phase text);
 CREATE TRIGGER native_phase_audit AFTER UPDATE OF phase ON loop_native_attempts BEGIN INSERT INTO native_audit VALUES(NEW.attempt_id,NEW.phase); END;`);
 const before=db.prepare('SELECT * FROM loop_native_attempts').all(),schema=db.prepare("SELECT type,name,sql FROM sqlite_master WHERE tbl_name='loop_native_attempts' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name").all();
 migrateLoopNativeSchema(db,lease);
 const rows=db.prepare('SELECT * FROM loop_native_attempts').all().map(({kind,enrollment_source_attempt_id,reauthorizes_attempt_id,...row})=>row);expect(rows).toEqual(before);
 expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 expect(db.prepare("SELECT type,name,sql FROM sqlite_master WHERE tbl_name='loop_native_attempts' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name").all()).toEqual(schema);
 lease.runWrite('UPDATE loop_native_attempts SET phase=? WHERE attempt_id=?','staged','attempt');expect(db.prepare('SELECT * FROM native_audit').all()).toEqual([{attempt_id:'attempt',phase:'staged'}]);
 migrateLoopArtifactExportJournal(db,lease);expect(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE tbl_name='loop_artifact_exports' AND type='trigger'").get()?.n).toBe(3);
});
