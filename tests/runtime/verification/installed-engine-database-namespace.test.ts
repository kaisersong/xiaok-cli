import {it,expect} from 'vitest';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Database} from 'better-sqlite3';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {assertInstalledEngineDatabaseNamespaces} from '../../../src/runtime/verification/installed-engine.js';

// Real SQLite namespace checks only. No mock PRAGMA, engine/qualification leaf,
// installed handle, VM, transport or native eligibility is created here.
function usingDatabase(work:(database:Database,root:string)=>void){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'engine-namespace-'))),errors:unknown[]=[];let db:Database|undefined;
 try{db=openPrivateVerificationDatabase(root);work(db,root);}catch(error){errors.push(error);}
 for(const close of [()=>db?.close(),()=>rmSync(root,{recursive:true,force:true})])try{close();}catch(error){errors.push(error);}
 if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,'namespace_control_cleanup_unknown');
}

it('accepts the exact main database without activating an absent temp namespace',()=>{
 usingDatabase((db,root)=>{
  const before=db.pragma('database_list');
  expect(before).toEqual([{seq:0,name:'main',file:join(root,'authority.sqlite')}]);
  expect(()=>assertInstalledEngineDatabaseNamespaces(db,join(root,'authority.sqlite'))).not.toThrow();
  expect(db.pragma('database_list')).toEqual(before);
 });
});

it('accepts an actually opened empty temp namespace and preserves the native vector',()=>{
 usingDatabase((db,root)=>{
  expect(db.prepare('SELECT 1 FROM temp.sqlite_schema LIMIT 1').get()).toBeUndefined();
  const before=db.pragma('database_list');
  expect(before).toEqual([{seq:0,name:'main',file:join(root,'authority.sqlite')},{seq:1,name:'temp',file:''}]);
  expect(()=>assertInstalledEngineDatabaseNamespaces(db,join(root,'authority.sqlite'))).not.toThrow();
  expect(db.pragma('database_list')).toEqual(before);
 });
});

it.each(['file','memory'] as const)('rejects an actual attached %s database even with a correct main path',kind=>{
 usingDatabase((db,root)=>{
  db.prepare('ATTACH DATABASE ? AS extra').run(kind==='file'?join(root,'extra.sqlite'):':memory:');
  expect(()=>assertInstalledEngineDatabaseNamespaces(db,join(root,'authority.sqlite'))).toThrow('installed_engine_database');
  db.exec('CREATE TABLE extra.namespace_shadow(value TEXT)');
  expect(()=>assertInstalledEngineDatabaseNamespaces(db,join(root,'authority.sqlite'))).toThrow('installed_engine_database');
 });
});

const tempObjects=[
 {kind:'table',sql:'CREATE TEMP TABLE namespace_fault(value TEXT)'},
 {kind:'view',sql:'CREATE TEMP VIEW namespace_fault AS SELECT 1 value'},
 {kind:'index',sql:'CREATE TEMP TABLE namespace_anchor(value TEXT); CREATE INDEX temp.namespace_fault ON namespace_anchor(value)'},
 {kind:'trigger',sql:'CREATE TABLE main.namespace_anchor(value INTEGER); CREATE TEMP TRIGGER namespace_fault BEFORE INSERT ON main.namespace_anchor BEGIN SELECT 1; END'},
];
it.each(tempObjects)('rejects actual temp objects without clearing or exempting them: $kind',({kind,sql})=>{
 usingDatabase((db,root)=>{
  db.exec(sql);const before=db.prepare('SELECT type,name,tbl_name,sql FROM temp.sqlite_schema ORDER BY type,name').all();expect(before).toEqual(expect.arrayContaining([expect.objectContaining({type:kind})]));
  expect(()=>assertInstalledEngineDatabaseNamespaces(db,join(root,'authority.sqlite'))).toThrow('installed_engine_database');
  expect(db.prepare('SELECT type,name,tbl_name,sql FROM temp.sqlite_schema ORDER BY type,name').all()).toEqual(before);
 });
});

it('rejects a different qualified main path instead of accepting its parent prefix',()=>{
 usingDatabase((db,root)=>{
  expect(()=>assertInstalledEngineDatabaseNamespaces(db,join(root,'other.sqlite'))).toThrow('installed_engine_database');
  expect(()=>assertInstalledEngineDatabaseNamespaces(db,root)).toThrow('installed_engine_database');
 });
});
