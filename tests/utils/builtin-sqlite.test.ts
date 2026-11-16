import {StatementSync} from 'node:sqlite';
import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from '../../src/utils/builtin-sqlite.js';

describe('built-in SQLite stores',()=>{
 it('persists an existing SQLite file without schema or row loss',()=>{
  const root=mkdtempSync(join(tmpdir(),'xiaok-sqlite-'));
  try {const path=join(root,'old.sqlite');let db=new Database(path);db.exec('CREATE TABLE records(id INTEGER PRIMARY KEY, text TEXT, bytes BLOB)');db.prepare('INSERT INTO records VALUES(?,?,?)').run(1,'历史任务',Buffer.from([0,255]));db.close();expect(readFileSync(path).subarray(0,15).toString()).toBe('SQLite format 3');db=new Database(path,{fileMustExist:true});expect(db.prepare('SELECT * FROM records').get()).toEqual({id:1,text:'历史任务',bytes:Buffer.from([0,255])});db.close();}finally{rmSync(root,{recursive:true,force:true});}
 });
 it('rolls back the entire synchronous transaction on error',()=>{
  const db=new Database(':memory:');try{db.exec('CREATE TABLE t(x)');expect(()=>db.transaction(()=>{db.prepare('INSERT INTO t VALUES(?)').run(1);throw Error('stop');}).immediate()).toThrow('stop');expect(db.prepare('SELECT count(*) AS n FROM t').get()).toEqual({n:0});expect(db.inTransaction).toBe(false);}finally{db.close();}
 });
 it('isolates nested rollback and preserves the outer commit',()=>{
  const db=new Database(':memory:');try{db.exec('CREATE TABLE t(x)');const insert=db.prepare('INSERT INTO t VALUES(?)');const result=db.transaction(()=>{insert.run(1);try{db.transaction(()=>{insert.run(2);throw Error('inner');})();}catch{}insert.run(3);return 7;}).exclusive();expect(result).toBe(7);expect(db.prepare('SELECT x FROM t ORDER BY x').pluck().all()).toEqual([1,3]);}finally{db.close();}
 });
 it('rejects async transaction bodies and rolls back writes',()=>{
  const db=new Database(':memory:');try{db.exec('CREATE TABLE t(x)');expect(()=>db.transaction(async()=>{db.exec('INSERT INTO t VALUES(1)');})()).toThrow();expect(db.prepare('SELECT count(*) AS n FROM t').get()).toEqual({n:0});}finally{db.close();}
 });
 it('supports named bindings, reusable binding, raw rows and exact big integers',()=>{
  const db=new Database(':memory:');try{db.exec('CREATE TABLE t(id INTEGER, value TEXT)');db.prepare('INSERT INTO t VALUES(@id,@value)').run({id:9007199254740993n,value:'kept',unused:'ignored'});expect(db.prepare('SELECT id,value FROM t WHERE value=?').bind('kept').raw().safeIntegers().get()).toEqual([9007199254740993n,'kept']);}finally{db.close();}
 });
 it('does not create missing files and enforces read-only opening',()=>{
  const root=mkdtempSync(join(tmpdir(),'xiaok-sqlite-'));try{const path=join(root,'data.sqlite');expect(()=>new Database(path,{fileMustExist:true})).toThrow();expect(existsSync(path)).toBe(false);const db=new Database(path);db.exec('CREATE TABLE t(x)');db.close();const read=new Database(path,{readonly:true,fileMustExist:true});try{expect(()=>read.exec('INSERT INTO t VALUES(1)')).toThrow();expect(read.readonly).toBe(true);}finally{read.close();}}finally{rmSync(root,{recursive:true,force:true});}
 });
 it('retains real lock contention and known close state',()=>{
  const root=mkdtempSync(join(tmpdir(),'xiaok-sqlite-'));try{const path=join(root,'data.sqlite'),a=new Database(path,{timeout:0}),b=new Database(path,{timeout:0});try{a.exec('CREATE TABLE t(x);BEGIN EXCLUSIVE');expect(()=>b.exec('BEGIN EXCLUSIVE')).toThrow();expect(a.inTransaction).toBe(true);expect(b.inTransaction).toBe(false);a.exec('ROLLBACK');b.exec('BEGIN EXCLUSIVE;ROLLBACK');}finally{a.close();b.close();expect(a.open).toBe(false);}}finally{rmSync(root,{recursive:true,force:true});}
 });
 it('rejects double quoted string literals',()=>{const db=new Database(':memory:');try{expect(()=>db.prepare('SELECT "missing_column"')).toThrow();}finally{db.close();}});
 it('enforces foreign keys by default',()=>{const db=new Database(':memory:');try{db.exec('CREATE TABLE parent(id INTEGER PRIMARY KEY);CREATE TABLE child(parent_id REFERENCES parent(id))');expect(()=>db.exec('INSERT INTO child VALUES(9)')).toThrow();expect(db.pragma('foreign_keys',{simple:true})).toBe(1);}finally{db.close();}});
 it('preserves FTS keyword retrieval',()=>{const db=new Database(':memory:');try{db.exec('CREATE VIRTUAL TABLE search USING fts5(body)');db.prepare('INSERT INTO search VALUES(?)').run('project history');expect(db.prepare("SELECT body FROM search WHERE search MATCH 'history'").pluck().get()).toBe('project history');}finally{db.close();}});
});

it('does not invoke a then getter while deciding whether to commit a synchronous transaction',()=>{const db=new Database(':memory:');try{db.exec('CREATE TABLE t(x)');let invoked=false;expect(()=>db.transaction(()=>{db.exec('INSERT INTO t VALUES(1)');return {get then(){invoked=true;db.exec('COMMIT');return undefined;}};})()).toThrow('sqlite_async_transaction_forbidden');expect(invoked).toBe(false);expect(db.prepare('SELECT count(*) AS n FROM t').get()).toEqual({n:0});}finally{db.close();}});

it('opens existing Unicode and URI-special filenames without creating an alternate file',()=>{const root=mkdtempSync(join(tmpdir(),'xiaok-sqlite-uri-'));try{const path=join(root,process.platform==='win32'?'旧 # % 文件.sqlite':'旧 #? % 文件.sqlite');const db=new Database(path);db.exec('CREATE TABLE t(x);INSERT INTO t VALUES(42)');db.close();const reopened=new Database(path,{fileMustExist:true});try{expect(reopened.prepare('SELECT x FROM t').pluck().get()).toBe(42);}finally{reopened.close();}}finally{rmSync(root,{recursive:true,force:true});}});
it('rolls back before observing a rejected native promise',async()=>{const db=new Database(':memory:');try{db.exec('CREATE TABLE t(x)');expect(()=>db.transaction(()=>{db.exec('INSERT INTO t VALUES(1)');return Promise.reject(Error('unexpected async body'));})()).toThrow('sqlite_async_transaction_forbidden');expect(db.prepare('SELECT count(*) AS n FROM t').get()).toEqual({n:0});await new Promise(resolve=>setImmediate(resolve));}finally{db.close();}});
it('does not enter a replaced native promise constructor getter',()=>{const db=new Database(':memory:');try{db.exec('CREATE TABLE t(x)');let calls=0;const promise=Promise.resolve(1);Object.defineProperty(promise,'constructor',{get(){calls++;db.exec('COMMIT');return Promise;}});expect(()=>db.transaction(()=>{db.exec('INSERT INTO t VALUES(1)');return promise;})()).toThrow('sqlite_async_transaction_forbidden');expect(calls).toBe(0);expect(db.prepare('SELECT count(*) AS n FROM t').get()).toEqual({n:0});}finally{db.close();}});
it('rejects a proxy result without entering its traps',()=>{const db=new Database(':memory:');try{db.exec('CREATE TABLE t(x)');let calls=0;const result=new Proxy({},{get(){calls++;return undefined;},getPrototypeOf(){calls++;return null;},getOwnPropertyDescriptor(){calls++;return undefined;}});expect(()=>db.transaction(()=>{db.exec('INSERT INTO t VALUES(1)');return result;})()).toThrow();expect(calls).toBe(0);expect(db.prepare('SELECT count(*) AS n FROM t').get()).toEqual({n:0});}finally{db.close();}});

it('keeps genuine Statement operations after native prototype properties are replaced',()=>{const db=new Database(':memory:'),prototype=StatementSync.prototype,keys=['run','get','all','columns','setReturnArrays','setReadBigInts','setAllowBareNamedParameters','setAllowUnknownNamedParameters'] as const,originals=keys.map(key=>Object.getOwnPropertyDescriptor(prototype,key)!);let calls=0;try{db.exec('CREATE TABLE t(x INTEGER)');for(const key of keys)Object.defineProperty(prototype,key,{...Object.getOwnPropertyDescriptor(prototype,key),value(){calls++;throw Error('replaced Statement method');}});db.prepare('INSERT INTO t VALUES(?)').run(1);const statement=db.prepare('SELECT x FROM t');expect(statement.source).toBe('SELECT x FROM t');expect(statement.reader).toBe(true);expect(statement.raw().safeIntegers().all()).toEqual([[1n]]);expect(statement.raw(false).safeIntegers(false).get()).toEqual({x:1});expect(calls).toBe(0);}finally{keys.forEach((key,index)=>Object.defineProperty(prototype,key,originals[index]!));db.close();}});
