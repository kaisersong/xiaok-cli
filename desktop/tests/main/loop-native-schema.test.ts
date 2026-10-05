import {expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {migrateLoopNativeSchema} from '../../electron/loop-native-schema.js';
it('real legacy migration rolls back on broken dependent FK, retains indexes/triggers, and can retry after repair',()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec(`PRAGMA foreign_keys=OFF;
 CREATE TABLE loop_publication_candidates(candidate_id text primary key);
 INSERT INTO loop_publication_candidates VALUES('candidate');
 CREATE TABLE loop_native_attempts(attempt_id text primary key,candidate_id text not null references loop_publication_candidates(candidate_id),revision integer not null,ordinal integer not null,original_source text not null,binding_hash text not null,source_vector_hash text not null,configuration_revision integer not null,definition_hash text not null,enrollment_request_id text not null unique,application_request_id text not null unique,phase text not null,created_at integer not null,updated_at integer not null,unique(candidate_id,ordinal));
 INSERT INTO loop_native_attempts VALUES('attempt','candidate',1,1,'user','hash','vector',1,'definition','enrollment','application','enrolled',20,20);
 CREATE TABLE child(native_id text references loop_native_attempts(attempt_id));INSERT INTO child VALUES('missing');
 CREATE INDEX native_phase_extra ON loop_native_attempts(phase);
 CREATE TRIGGER native_identity_extra BEFORE UPDATE OF application_request_id ON loop_native_attempts BEGIN SELECT RAISE(ABORT,'immutable request');END;
 PRAGMA foreign_keys=ON;`);
 const original=db.prepare('SELECT * FROM loop_native_attempts').all(),schema=db.prepare("SELECT type,name,sql FROM sqlite_master WHERE tbl_name='loop_native_attempts' ORDER BY type,name").all();
 expect(()=>migrateLoopNativeSchema(db)).toThrow('integrity');expect(db.isTransaction).toBe(false);expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
 expect(db.prepare('SELECT * FROM loop_native_attempts').all()).toEqual(original);expect(db.prepare("SELECT type,name,sql FROM sqlite_master WHERE tbl_name='loop_native_attempts' ORDER BY type,name").all()).toEqual(schema);
 db.exec("UPDATE child SET native_id='attempt'");migrateLoopNativeSchema(db);expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 expect(()=>db.exec("UPDATE loop_native_attempts SET application_request_id='replaced'")).toThrow('immutable request');
 expect(db.prepare("SELECT name FROM sqlite_master WHERE name='native_phase_extra'").get()).toBeTruthy();
 expect(db.prepare('SELECT * FROM loop_native_attempts').all()).toEqual(original.map(row=>({...row,kind:'enrollment-and-application',enrollment_source_attempt_id:null,reauthorizes_attempt_id:null})));
 migrateLoopNativeSchema(db);expect(db.prepare('SELECT count(*) AS n FROM loop_native_attempts').get()?.n).toBe(1);
 }finally{db.close();}
});
it('does not change an existing transaction or its foreign key setting',()=>{const db=new DatabaseSync(':memory:');try{
 db.exec('CREATE TABLE loop_native_attempts(attempt_id text);PRAGMA foreign_keys=ON;BEGIN');
 expect(()=>migrateLoopNativeSchema(db)).toThrow('outer_transaction');expect(db.isTransaction).toBe(true);expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);db.exec('ROLLBACK');
 }finally{db.close();}});
