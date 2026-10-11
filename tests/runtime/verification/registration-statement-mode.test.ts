import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Session as InspectorSession} from 'node:inspector/promises';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createRegistrationCensusDatabase} from '../../../src/runtime/verification/registration-census-database.js';

const cleanup:Array<()=>void>=[];
afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();});

it('rejects a native BigInt builtin registry before subsequent native counter reads and recovers after Number mode returns',async()=>{
 const root=mkdtempSync(join(tmpdir(),'registration-builtin-mode-'));
 cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const db=openPrivateVerificationDatabase(root);
 cleanup.push(()=>db.close());
 let owner:NonNullable<ReturnType<typeof createRegistrationCensusDatabase>>;
 let calls=0;
 db.function('unrelated_registration_probe',()=>{calls++;return 1;});
 const inspector=new InspectorSession();inspector.connect();
 let sourceScript:string|undefined;
 const rawCalls=(coverage:any)=>{
  const scripts=coverage.result.filter((script:any)=>sourceScript?script.scriptId===sourceScript:script.functions.some((fn:any)=>fn.functionName==='createRegistrationCensusDatabase'));
  expect(scripts).toHaveLength(1);
  sourceScript=scripts[0].scriptId;
  const reads=scripts[0].functions.filter((fn:any)=>fn.functionName==='raw');
  expect(reads.length).toBeLessThanOrEqual(1);
  return reads[0]?.ranges[0].count??0;
 };
 try{
  await inspector.post('Profiler.enable');
  await inspector.post('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
  owner=createRegistrationCensusDatabase(db)!;
  const original=owner.begin();original.finish();
  expect(rawCalls(await inspector.post('Profiler.takePreciseCoverage'))).toBeGreaterThan(0);
  db.defaultSafeIntegers(true);
  expect(()=>owner.begin()).toThrow('application_registration_changed');
  expect(calls).toBe(0);
  expect(rawCalls(await inspector.post('Profiler.takePreciseCoverage'))).toBe(0);
 }finally{
  db.defaultSafeIntegers(false);
  await inspector.post('Profiler.stopPreciseCoverage');inspector.disconnect();
 }
 const restored=owner.begin();restored.finish();
 expect(calls).toBe(0);
});

it('fresh original native groups preserve integer mode even when it changes and returns within one checkpoint',()=>{
 const root=mkdtempSync(join(tmpdir(),'registration-statement-mode-'));
 cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const db=openPrivateVerificationDatabase(root);
 cleanup.push(()=>db.close());
 db.exec("CREATE TABLE verification_application_history(owner_key TEXT,n INTEGER);INSERT INTO verification_application_history VALUES('owner',7)");
 const owner=createRegistrationCensusDatabase(db)!;
 const warm=owner.begin();
 expect(warm.groups('verification_application_history',['owner']).get('owner')![0]!.n).toBe(7);
 warm.finish();
 const current=owner.begin();
 let row:Record<string,unknown>|undefined;
 try{
  db.defaultSafeIntegers(true);
  row=current.groups('verification_application_history',['owner']).get('owner')![0];
 }finally{db.defaultSafeIntegers(false);}
 expect(row!.n).toBe(7n);
 expect(()=>current.finish()).not.toThrow();
 const next=owner.begin();
 expect(next.groups('verification_application_history',['owner']).get('owner')![0]!.n).toBe(7);
 next.finish();
});

it('repeated groups in the same checkpoint inherit each actual native integer mode without losing a bit',()=>{
 const root=mkdtempSync(join(tmpdir(),'registration-same-checkpoint-mode-'));
 cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const db=openPrivateVerificationDatabase(root);cleanup.push(()=>db.close());
 db.exec("CREATE TABLE verification_application_history(owner_key TEXT,n INTEGER);INSERT INTO verification_application_history VALUES('owner',9007199254740993)");
 const current=createRegistrationCensusDatabase(db)!.begin();
 expect(current.groups('verification_application_history',['owner']).get('owner')![0]!.n).toBe(9007199254740992);
 try{
  db.defaultSafeIntegers(true);
  const grouped=current.groups('verification_application_history',['owner']).get('owner')![0]!;
  const fresh=current.records('SELECT * FROM main.verification_application_history')[0]!;
  expect(grouped.n).toBe(9007199254740993n);expect(grouped).toEqual(fresh);
 }finally{db.defaultSafeIntegers(false);}
 expect(current.groups('verification_application_history',['owner']).get('owner')![0]!.n).toBe(9007199254740992);
 expect(()=>current.finish()).not.toThrow();
});

it('a statement first read in BigInt mode cannot keep that mode after the same checkpoint restores Number',()=>{
 const root=mkdtempSync(join(tmpdir(),'registration-same-checkpoint-restore-'));
 cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const db=openPrivateVerificationDatabase(root);cleanup.push(()=>db.close());
 db.exec("CREATE TABLE verification_application_history(owner_key TEXT,n INTEGER);INSERT INTO verification_application_history VALUES('owner',9007199254740993)");
 const current=createRegistrationCensusDatabase(db)!.begin();
 try{db.defaultSafeIntegers(true);expect(current.groups('verification_application_history',['owner']).get('owner')![0]!.n).toBe(9007199254740993n);}
 finally{db.defaultSafeIntegers(false);}
 const grouped=current.groups('verification_application_history',['owner']).get('owner')![0]!;
 expect(grouped.n).toBe(9007199254740992);expect(grouped).toEqual(current.records('SELECT * FROM main.verification_application_history')[0]!);
 expect(()=>current.finish()).not.toThrow();
});

it('both actual 128-key chunks keep complete independent native rows through repeated integer mode changes',()=>{
 const root=mkdtempSync(join(tmpdir(),'registration-same-checkpoint-chunks-'));
 cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const db=openPrivateVerificationDatabase(root);cleanup.push(()=>db.close());
 db.exec('CREATE TABLE verification_application_history(owner_key TEXT,n INTEGER,future_blob BLOB,future_null TEXT,constructor TEXT,future_float REAL)');
 const insert=db.prepare('INSERT INTO verification_application_history VALUES(?,?,?,?,?,?)'),keys=Array.from({length:130},(_,i)=>'owner-'+i);
 for(let i=0;i<keys.length;i++)insert.run(keys[i],9007199254740993n+BigInt(i),Buffer.from([i,7]),null,'retained',1.25);
 const current=createRegistrationCensusDatabase(db)!.begin();
 current.groups('verification_application_history',keys);
 try{
  db.defaultSafeIntegers(true);
  const groups=current.groups('verification_application_history',keys);
  expect(groups.size).toBe(130);
  for(let i=0;i<keys.length;i++){
   const row=groups.get(keys[i]!)![0]!,fresh=current.records('SELECT * FROM main.verification_application_history WHERE owner_key=?',[keys[i]])[0]!;
   expect(Object.getPrototypeOf(row)).toBe(null);expect(row).toEqual(fresh);expect(row.n).toBe(9007199254740993n+BigInt(i));
   expect(row.future_blob).not.toBe(fresh.future_blob);expect(row.future_null).toBe(null);expect(row.constructor).toBe('retained');expect(row.future_float).toBe(1.25);
   (row.future_blob as Buffer)[1]=99;expect((fresh.future_blob as Buffer)[1]).toBe(7);
  }
 }finally{db.defaultSafeIntegers(false);}
 const groups=current.groups('verification_application_history',keys);
 for(const key of keys)expect(groups.get(key)![0]).toEqual(current.records('SELECT * FROM main.verification_application_history WHERE owner_key=?',[key])[0]!);
 expect(()=>current.finish()).not.toThrow();
});
