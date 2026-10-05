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
