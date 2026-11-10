// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {DatabaseSync,StatementSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const nativePrepare=DatabaseSync.prototype.prepare,nativeRun=StatementSync.prototype.run;
const nativeExec=DatabaseSync.prototype.exec,nativeClose=DatabaseSync.prototype.close;
afterEach(()=>vi.restoreAllMocks());
it.each(['assistant_calendar_memory_settings','assistant_derived_run_markers','assistant_derived_lineage'].flatMap(table=>['before','after'].map(mode=>({table,mode}))))('keeps bare undefined first cause and actual transaction state for $table/$mode',async({table,mode})=>{
 vi.resetModules();const statements=new WeakMap<object,string>();let faults=0;
 vi.spyOn(DatabaseSync.prototype,'prepare').mockImplementation(function(this:DatabaseSync,sql:string){const result=Reflect.apply(nativePrepare,this,[sql]);statements.set(result,sql);return result;});
 vi.spyOn(StatementSync.prototype,'run').mockImplementation(function(this:StatementSync,...args:unknown[]){if(statements.get(this)?.startsWith('INSERT INTO '+table+'(')){faults++;if(mode==='after')Reflect.apply(nativeRun,this,args);throw undefined;}return Reflect.apply(nativeRun,this,args);});
 const {LoopStore}=await import('../../electron/loop-store.js'),{assistantDerivedHash}=await import('../../electron/assistant-derived-data.js'),root=mkdtempSync(join(tmpdir(),'derived-sdk-fault-')),path=join(root,'loop.sqlite'),store=new LoopStore(path);
 try{
  store.ensureBuiltInLoops(1);store.setLoopStatus('personal-assistant-morning-briefing','active',2);const profile=store.ensureAssistantProfile({id:'default-personal-assistant',status:'active',locale:'en',timeZone:'UTC',eveningTime:'22:30',morningTime:'08:30',workdays:[1],quietHours:{start:'23:00',end:'07:00'},dataScopes:['tasks'],createdAt:1,updatedAt:1});
  const begin=store.beginLoopRun('personal-assistant-morning-briefing',{kind:'manual'},3,1000,{requestSource:'user'});if(begin.status!=='started')throw Error('fixture');
  const lineage={version:1 as const,profileId:profile.id,profileRevision:assistantDerivedHash(profile),parents:[]};let first:{present:true;raw:unknown}|undefined;
  try{if(table==='assistant_calendar_memory_settings')store.setAssistantCalendarMemorySettings({ownerId:'desktop-user:'+'a'.repeat(64),profileId:profile.id,enabled:true,expectedRevision:0,requestSource:'user'});else store.recordAssistantDerivedLineage(begin.run.id,lineage,()=>assistantDerivedHash(store.getAssistantProfile(profile.id))===lineage.profileRevision);}catch(raw){first={present:true,raw};}
  expect(first).toEqual({present:true,raw:undefined});expect(faults).toBe(1);const read=new DatabaseSync(path,{readOnly:true});try{for(const name of ['assistant_calendar_memory_settings','assistant_derived_run_markers','assistant_derived_lineage'])expect(read.prepare('SELECT count(*) AS n FROM '+name).get()!.n).toBe(0);expect(read.prepare('SELECT status FROM loop_runs WHERE id=?').get(begin.run.id)!.status).toBe('running');read.exec('BEGIN DEFERRED;ROLLBACK');}finally{read.close();}
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
it.each(['before','after'] as const)('preserves a constructor migration bare-undefined first cause %s actual SDK exec and closes only its original handle',async mode=>{
 vi.resetModules();const targets=new WeakSet<object>();let database:DatabaseSync|undefined,closes=0;
 vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){if(sql.startsWith('CREATE TABLE IF NOT EXISTS assistant_calendar_memory_settings')){targets.add(this);database=this;if(mode==='after')Reflect.apply(nativeExec,this,[sql]);throw undefined;}return Reflect.apply(nativeExec,this,[sql]);});
 vi.spyOn(DatabaseSync.prototype,'close').mockImplementation(function(this:DatabaseSync){const result=Reflect.apply(nativeClose,this,[]);if(targets.has(this))closes++;return result;});
 const {LoopStore}=await import('../../electron/loop-store.js'),root=mkdtempSync(join(tmpdir(),'derived-ctor-fault-')),path=join(root,'loop.sqlite');let first:{present:true;raw:unknown}|undefined;
 try{try{new LoopStore(path);}catch(raw){first={present:true,raw};}expect(first).toEqual({present:true,raw:undefined});expect(database).toBeDefined();expect(closes).toBe(1);expect(()=>Reflect.apply(nativePrepare,database!,['SELECT 1'])).toThrow();}finally{console.info(JSON.stringify({fixture:'derived-constructor-first-cause',root,mode,actualNativeCloseCalls:closes,retained:true,physicalQualification:false}));}
});
