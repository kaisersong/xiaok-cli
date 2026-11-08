// Actual production-method regressions; no transaction implementation copied here.
// @vitest-environment node
import {afterAll,expect,it,vi} from 'vitest';
const isolated=await vi.hoisted(async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'loop-negative-red-')));fs.chmodSync(home,0o700);
 const config=path.join(home,'.xiaok');fs.mkdirSync(config,{mode:0o700});const previous=process.env.XIAOK_CONFIG_DIR;process.env.XIAOK_CONFIG_DIR=config;return {home,previous};
});
import {rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createLoopDatabaseOwnerGroup,openLoopDatabase,describeLoopDatabaseSource} from '../../electron/loop-database-owner.js';
import {LoopStore} from '../../electron/loop-store.js';
import {CompletionEvidenceStore} from '../../electron/completion-evidence-store.js';
import {ArtifactEvidenceRegressionScanner} from '../../electron/artifact-evidence-regression-loop.js';
import {KSwarmServiceHealthScanner} from '../../electron/kswarm-health-loop.js';
const held:unknown[]=[];
afterAll(()=>{
 if(isolated.previous===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=isolated.previous;
 if(!held.length)rmSync(isolated.home,{recursive:true,force:true});
});
it.each(['loop','completion','artifact','health'] as const)('original %s transaction rolls back accepted DB after real local-lease withdrawal, preserving undefined',kind=>{
 const group=createLoopDatabaseOwnerGroup([':memory:']),source=group.sources[0],db=openLoopDatabase(source).database;
 const store=kind==='loop'?new LoopStore(source):kind==='completion'?new CompletionEvidenceStore(source):kind==='artifact'?new ArtifactEvidenceRegressionScanner(source):new KSwarmServiceHealthScanner(source,{probe(){throw Error('not called');}});
 db.exec('CREATE TABLE negative_probe(value TEXT)');let caught=false,first:unknown;
 try{
  try{(store as unknown as {transaction(fn:()=>void):void}).transaction(()=>{db.exec("INSERT INTO negative_probe VALUES ('owned')");store.close();throw undefined;});}
  catch(raw){caught=true;first=raw;}
  console.log(JSON.stringify({pid:process.pid,node:process.version,kind,caught,firstIsUndefined:first===undefined,sourceGrant:false,scope:'actual existing lease withdrawal; metadata fuse not claimed'}));
  expect(caught).toBe(true);expect(first).toBeUndefined();
  expect(()=>{db.exec('BEGIN IMMEDIATE');db.exec('ROLLBACK');}).not.toThrow();
  expect(db.prepare('SELECT value FROM negative_probe').all()).toEqual([]);
 }finally{
  // Actual negative close only. An expected failed test is not converted to
  // rollback-known; group close does not revive or reuse the withdrawn store.
  try{group.close();}catch(raw){held.push(group,db,raw);throw raw;}
 }
});
it.each(['loop','completion','artifact','health'] as const)('original %s transaction keeps COMMIT behind the revoked positive lease getter',kind=>{
 const group=createLoopDatabaseOwnerGroup([':memory:']),source=group.sources[0],db=openLoopDatabase(source).database;
 const store=kind==='loop'?new LoopStore(source):kind==='completion'?new CompletionEvidenceStore(source):kind==='artifact'?new ArtifactEvidenceRegressionScanner(source):new KSwarmServiceHealthScanner(source,{probe(){throw Error('not called');}});
 db.exec('CREATE TABLE commit_probe(value TEXT)');let caught=false,first:unknown;
 try{
  try{(store as unknown as {transaction(fn:()=>void):void}).transaction(()=>{db.exec("INSERT INTO commit_probe VALUES ('must-not-commit')");store.close();});}catch(raw){caught=true;first=raw;}
  expect(caught).toBe(true);expect(first).toBeInstanceOf(Error);
  expect(()=>{db.exec('BEGIN IMMEDIATE');db.exec('ROLLBACK');}).not.toThrow();
  expect(db.prepare('SELECT value FROM commit_probe').all()).toEqual([]);
 }finally{try{group.close();}catch(raw){held.push(group,db,raw);throw raw;}}
});
it.each(['loop','completion','artifact','health'] as const)('original %s transaction rolls back after real metadata inspection failure without replacing undefined',kind=>{
 const group=createLoopDatabaseOwnerGroup([':memory:']),source=group.sources[0],db=openLoopDatabase(source).database;
 const store=kind==='loop'?new LoopStore(source):kind==='completion'?new CompletionEvidenceStore(source):kind==='artifact'?new ArtifactEvidenceRegressionScanner(source):new KSwarmServiceHealthScanner(source,{probe(){throw Error('not called');}});
 db.exec('CREATE TABLE metadata_probe(value TEXT)');let caught=false,first:unknown,metadataFailure:unknown;
 try{
  try{(store as unknown as {transaction(fn:()=>void):void}).transaction(()=>{
   db.exec("INSERT INTO metadata_probe VALUES ('owned')");
   try{describeLoopDatabaseSource(source);}catch(raw){metadataFailure=raw;}
   throw undefined;
  });}catch(raw){caught=true;first=raw;}
  let positiveLeaseReady=false;try{openLoopDatabase(source).database;positiveLeaseReady=true;}catch{/* Observed denial is not used as a grant or a known-state substitute. */}
  console.log(JSON.stringify({pid:process.pid,node:process.version,kind,caught,firstIsUndefined:first===undefined,metadataInspectionFailed:metadataFailure!==undefined,positiveLeaseReady,sourceGrant:false}));
  expect(metadataFailure).toBeInstanceOf(Error);expect(Object.getOwnPropertyDescriptor(metadataFailure,'message')?.value).toBe('loop_database_metadata_transaction');
  if((Object.getOwnPropertyDescriptor(db,'isTransaction')??Object.getOwnPropertyDescriptor(DatabaseSync.prototype,'isTransaction'))===undefined)expect(positiveLeaseReady).toBe(false);
  expect(caught).toBe(true);expect(first).toBeUndefined();
  // Diagnostic on the already-held raw DB, not authorization for a new writer.
  expect(()=>{db.exec('BEGIN IMMEDIATE');db.exec('ROLLBACK');}).not.toThrow();
  expect(db.prepare('SELECT value FROM metadata_probe').all()).toEqual([]);
 }finally{try{group.close();}catch(raw){held.push(group,db,raw);throw raw;}}
});
