import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtempSync,existsSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it,expect} from 'vitest';
import {openPrivateVerificationDatabase,readPrivateDatabaseNativeAccess} from '../../../src/runtime/verification/private-database.js';
import {createRegistrationCensusDatabase,REGISTRATION_TABLE_KEYS} from '../../../src/runtime/verification/registration-census-database.js';
import {captureRegistrationSnapshot} from '../../../src/runtime/verification/registration-value-snapshot.js';

const moduleUrl=new URL('../../../src/runtime/verification/registration-census-database.js',import.meta.url);
if(!existsSync(moduleUrl))moduleUrl.pathname=moduleUrl.pathname.replace(/\.js$/,'.ts');
const snapshotUrl=new URL('./registration-value-snapshot.js',moduleUrl);
if(!existsSync(snapshotUrl))snapshotUrl.pathname=snapshotUrl.pathname.replace(/\.js$/,'.ts');
const privateUrl=new URL('./private-database.js',moduleUrl);
if(!existsSync(privateUrl))privateUrl.pathname=privateUrl.pathname.replace(/\.js$/,'.ts');

const childSource=String.raw`
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const censusModule=await import(process.argv[2]),snapshotModule=await import(process.argv[3]),privateModule=await import(process.argv[4]);
const {createRegistrationCensusDatabase}=censusModule,{captureRegistrationSnapshot}=snapshotModule,{openPrivateVerificationDatabase}=privateModule;
const descriptor=Object.getOwnPropertyDescriptor,define=Object.defineProperty,ownKeys=Reflect.ownKeys,proto=Object.getPrototypeOf,setProto=Object.setPrototypeOf,apply=Reflect.apply;
const arrayIterator=proto([][Symbol.iterator]()),mapIterator=proto(new Map().keys()),setIterator=proto(new Set().values()),iteratorParent=proto(arrayIterator);
const targetName=process.argv[5],phase=process.argv[6],targets={globals:globalThis,Object,Array,String,RegExp,Map,Set,WeakMap,Number,Math,JSON,Reflect,
 ArrayPrototype:Array.prototype,StringPrototype:String.prototype,RegExpPrototype:RegExp.prototype,MapPrototype:Map.prototype,SetPrototype:Set.prototype,WeakMapPrototype:WeakMap.prototype,
 ArrayIterator:arrayIterator,MapIterator:mapIterator,SetIterator:setIterator,IteratorParent:iteratorParent};
const target=targets[targetName],keys=targetName==='globals'?['Object','Array','String','RegExp','Map','Set','WeakMap','Number','Math','JSON','Reflect']:ownKeys(target);
const root=mkdtempSync(join(tmpdir(),'registration-intrinsic-child-')),db=openPrivateVerificationDatabase(root);
db.exec("CREATE TABLE verification_application_history(owner_key TEXT,n INTEGER);INSERT INTO verification_application_history VALUES('owner',1)");
const census=createRegistrationCensusDatabase(db),cases=[];
function afterRestoration(){const c=census.begin();const rows=c.groups('verification_application_history',['owner']).get('owner');c.finish();return rows.length===1&&rows[0].n===1;}
try{
 for(let i=0;i<keys.length;i++){
  const key=keys[i],original=descriptor(target,key);if(!original||(!original.configurable&&(!('value'in original)||!original.writable)))continue;
  const checkpoint=phase==='closing'?census.begin():undefined;let calls=0,error,returned=false;
  const replacement=function(){calls++;throw Error('replacement_intrinsic_was_called');};
  // The writable Array.prototype.length only accepts a valid numeric length.
  const changed='value'in original?{...original,value:targetName==='ArrayPrototype'&&key==='length'?1:replacement}:{...original,get:replacement};
  define(target,key,changed);
  try{if(phase==='begin')census.begin();else if(phase==='closing')checkpoint.finish();else if(phase==='snapshot')captureRegistrationSnapshot({owner:'owner',rows:[{n:1}]});else createRegistrationCensusDatabase(db);returned=true;}
  catch(e){error=e;}
  finally{define(target,key,original);}
  cases.push({key:String(key),phase,error:error?.message,returned,calls,normalAfterRestoration:afterRestoration()});
 }
 if(phase==='begin'||phase==='closing'){
  const checkpoint=phase==='closing'?census.begin():undefined,original=proto(target);let calls=0,error,returned=false;
  const hostile={*[Symbol.iterator](){calls++;}};setProto(target,hostile);
  try{if(phase==='begin')census.begin();else checkpoint.finish();returned=true;}catch(e){error=e;}
  finally{setProto(target,original);}
  cases.push({key:'[[Prototype]]',phase,error:error?.message,returned,calls,normalAfterRestoration:afterRestoration()});
 }
}finally{db.close();rmSync(root,{recursive:true,force:true});}
console.log(JSON.stringify({targetName,phase,cases}));
`;
const targets=['globals','Object','Array','String','RegExp','Map','Set','WeakMap','Number','Math','JSON','Reflect','ArrayPrototype','StringPrototype','RegExpPrototype','MapPrototype','SetPrototype','WeakMapPrototype','ArrayIterator','MapIterator','SetIterator','IteratorParent'];
for(const phase of ['begin','closing','snapshot'] as const)it.each(targets)(`actual native ${phase} refuses every replaceable own descriptor and original prototype edge: %s`,target=>{
 const root=mkdtempSync(join(tmpdir(),'registration-intrinsic-host-')),script=join(root,'probe.mjs');
 try{
  writeFileSync(script,childSource);
  const child=spawnSync(process.execPath,['--import',createRequire(import.meta.url).resolve('tsx'),script,moduleUrl.href,snapshotUrl.href,privateUrl.href,target,phase],{encoding:'utf8',timeout:4500});
  expect(child.status,child.stderr).toBe(0);const proof=JSON.parse(child.stdout.trim());
  const proofRoot=process.env.REGISTRATION_INTRINSIC_PROOF_DIR;if(proofRoot){mkdirSync(proofRoot,{recursive:true});writeFileSync(join(proofRoot,target+'-'+phase+'.json'),JSON.stringify(proof,null,2));}
  expect(proof.cases.length).toBeGreaterThan(0);
  expect(proof.cases.filter((c:any)=>c.error!=='application_registration_changed'||c.returned||c.calls!==0||!c.normalAfterRestoration)).toEqual([]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
it.each(['globals','WeakMapPrototype'])('refuses WeakMap native-brand replacement before reading a real branded database: %s',target=>{
 const root=mkdtempSync(join(tmpdir(),'registration-intrinsic-brand-')),script=join(root,'probe.mjs');
 try{
  writeFileSync(script,childSource.replace("['Object','Array','String','RegExp','Map','Set','WeakMap','Number','Math','JSON','Reflect']","['WeakMap']"));
  const child=spawnSync(process.execPath,['--import',createRequire(import.meta.url).resolve('tsx'),script,moduleUrl.href,snapshotUrl.href,privateUrl.href,target,'brand'],{encoding:'utf8',timeout:4500});
  expect(child.status,child.stderr).toBe(0);const proof=JSON.parse(child.stdout.trim());
  expect(proof.cases.filter((c:any)=>c.error!=='application_registration_changed'||c.returned||c.calls!==0||!c.normalAfterRestoration)).toEqual([]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('the original fixed lookup mapping cannot hide native rows through assignment or deletion',()=>{
 const root=mkdtempSync(join(tmpdir(),'registration-key-map-test-')),db=openPrivateVerificationDatabase(root),prior=Object.getOwnPropertyDescriptor(REGISTRATION_TABLE_KEYS,'verification_application_history')!;
 try{
  db.exec("CREATE TABLE verification_application_history(owner_key TEXT,n INTEGER);INSERT INTO verification_application_history VALUES('owner',1)");
  const census=createRegistrationCensusDatabase(db)!;let assigned=false,deleted=false;
  try{(REGISTRATION_TABLE_KEYS as any).verification_application_history='n';assigned=true;}catch{}
  try{delete (REGISTRATION_TABLE_KEYS as any).verification_application_history;deleted=true;}catch{}
  expect(assigned).toBe(false);expect(deleted).toBe(false);expect(Object.isFrozen(REGISTRATION_TABLE_KEYS)).toBe(true);
  const c=census.begin();expect(c.groups('verification_application_history',['owner']).get('owner')).toEqual([{owner_key:'owner',n:1}]);c.finish();
 }finally{if(!Object.isFrozen(REGISTRATION_TABLE_KEYS))Object.defineProperty(REGISTRATION_TABLE_KEYS,'verification_application_history',prior);db.close();rmSync(root,{recursive:true,force:true});}
});
it.each(['replace','some'] as const)('blocks the actual native 0n total_changes shadow through %s before it can hide a write',kind=>{
 const root=mkdtempSync(join(tmpdir(),'registration-shadow-regression-')),db=openPrivateVerificationDatabase(root),target=kind==='replace'?String.prototype:Array.prototype,key=kind==='replace'?'replace':'some',prior=Object.getOwnPropertyDescriptor(target,key)!,original=prior.value as Function,apply=Reflect.apply,define=Object.defineProperty;
 let nativeCalls=0,replacedCalls=0,error:unknown;const counts=new WeakMap<object,number>();
 try{
  db.exec("CREATE TABLE verification_application_history(owner_key TEXT,n INTEGER);INSERT INTO verification_application_history VALUES('owner',1)");db.function('total_changes',()=>{nativeCalls++;return 0n;});const census=createRegistrationCensusDatabase(db)!;
  const replacement=kind==='replace'?function(this:string,pattern:any,...args:unknown[]){if(this==='total_changes'&&pattern instanceof RegExp&&pattern.source==='[A-Z]'){replacedCalls++;return 'hidden_shadow';}return apply(original,this,[pattern,...args]);}:function(this:any[],predicate:unknown,...args:unknown[]){
   let functionList=false;for(let i=0;i<this.length;i++)if(this[i]?.name==='total_changes'&&Object.hasOwn(this[i],'builtin')){functionList=true;break;}
   if(functionList){const count=(counts.get(this)??0)+1;counts.set(this,count);if(count===2){replacedCalls++;return false;}}
   return apply(original,this,[predicate,...args]);
  };
  define(target,key,{...prior,value:replacement});
  try{const c=census.begin();db.prepare("UPDATE verification_application_history SET n=2 WHERE owner_key='owner'").run();c.groups('verification_application_history',['owner']);c.finish();}catch(value){error=value;}
 }finally{define(target,key,prior);db.close();rmSync(root,{recursive:true,force:true});}
 expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe('application_registration_changed');expect(nativeCalls).toBe(0);expect(replacedCalls).toBe(0);
});
it('the real unchanged Number.NaN descriptor never rejects a normal native window',()=>{
 const root=mkdtempSync(join(tmpdir(),'registration-nan-descriptor-')),db=openPrivateVerificationDatabase(root);
 try{
  db.exec("CREATE TABLE verification_application_history(owner_key TEXT,n INTEGER);INSERT INTO verification_application_history VALUES('owner',1)");
  const c=createRegistrationCensusDatabase(db)!.begin();
  expect(c.groups('verification_application_history',['owner']).get('owner')).toEqual([{owner_key:'owner',n:1}]);c.finish();
  expect(captureRegistrationSnapshot({n:1})).toEqual({n:1});
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
it.each(['begin','closing','snapshot'] as const)('actual native %s rejects the configurable Map.length +0 to -0 change',phase=>{
 const root=mkdtempSync(join(tmpdir(),'registration-negative-zero-')),db=openPrivateVerificationDatabase(root),define=Object.defineProperty,prior=Object.getOwnPropertyDescriptor(Map,'length')!;
 let error:unknown,negativeZero=false;
 try{
  db.exec("CREATE TABLE verification_application_history(owner_key TEXT,n INTEGER);INSERT INTO verification_application_history VALUES('owner',1)");
  const census=createRegistrationCensusDatabase(db)!,checkpoint=phase==='closing'?census.begin():undefined;
  define(Map,'length',{...prior,value:-0});negativeZero=Object.is(Object.getOwnPropertyDescriptor(Map,'length')!.value,-0);
  try{if(phase==='begin')census.begin();else if(phase==='closing')checkpoint!.finish();else captureRegistrationSnapshot({n:1});}catch(value){error=value;}
  finally{define(Map,'length',prior);}
  const restored=census.begin();expect(restored.groups('verification_application_history',['owner']).get('owner')).toEqual([{owner_key:'owner',n:1}]);restored.finish();
 }finally{define(Map,'length',prior);db.close();rmSync(root,{recursive:true,force:true});}
 expect(negativeZero).toBe(true);expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe('application_registration_changed');
});
const liveComparatorChild=String.raw`
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createRequire,syncBuiltinESMExports} from 'node:module';
const {createRegistrationCensusDatabase}=await import(process.argv[2]),{openPrivateVerificationDatabase}=await import(process.argv[3]);
const util=createRequire(import.meta.url)('node:util'),define=Object.defineProperty,prior=Object.getOwnPropertyDescriptor(util,'isDeepStrictEqual');
const root=mkdtempSync(join(tmpdir(),'registration-comparator-child-')),db=openPrivateVerificationDatabase(root);let result,calls=0;
try{
 db.exec("CREATE TABLE verification_application_history(owner_key TEXT,n INTEGER);INSERT INTO verification_application_history VALUES('owner',1)");const census=createRegistrationCensusDatabase(db),c=census.begin();
 define(util,'isDeepStrictEqual',{...prior,value(){calls++;return true}});syncBuiltinESMExports();
 if(process.argv[4]==='row')db.exec('UPDATE verification_application_history SET n=2');else db.exec('CREATE TABLE real_unknown_schema(n INTEGER)');
 let error,returned=false;try{c.finish();returned=true}catch(e){error=e}
 define(util,'isDeepStrictEqual',prior);syncBuiltinESMExports();
 const restored=census.begin(),rows=restored.groups('verification_application_history',['owner']).get('owner');restored.finish();
 result={error:error?.message,returned,calls,restoredRows:rows};
}finally{define(util,'isDeepStrictEqual',prior);syncBuiltinESMExports();db.close();rmSync(root,{recursive:true,force:true})}
console.log(JSON.stringify(result));
`;
it.each(['row','schema'] as const)('actual native closing fence refuses a real %s change after builtin ESM comparator synchronization',kind=>{
 const root=mkdtempSync(join(tmpdir(),'registration-comparator-host-')),script=join(root,'probe.mjs');
 try{
  writeFileSync(script,liveComparatorChild);
  const child=spawnSync(process.execPath,['--import',createRequire(import.meta.url).resolve('tsx'),script,moduleUrl.href,privateUrl.href,kind],{encoding:'utf8',timeout:4500});
  expect(child.status,child.stderr).toBe(0);const proof=JSON.parse(child.stdout.trim());
  expect(proof).toEqual({error:'application_registration_changed',returned:false,calls:0,restoredRows:[{owner_key:'owner',n:kind==='row'?2:1}]});
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('fixed schema table_list keeps its full fence around a real reconnecting unrelated virtual-table factory',()=>{
 const root=mkdtempSync(join(tmpdir(),'registration-schema-vtab-')),db=openPrivateVerificationDatabase(root);
 const prior=Object.getOwnPropertyDescriptor(Map,'length')!,define=Object.defineProperty;
 let armed=false,calls=0,error:unknown;
 try{
  db.table('schema_metadata_probe',function(){
   if(armed){calls++;define(Map,'length',{...prior,value:-0});}
   return {columns:['value'],rows:function*(){yield [1];}};
  });
  db.exec('CREATE VIRTUAL TABLE unrelated_schema_probe USING schema_metadata_probe');
  // Discard SQLite schema metadata so the original table_list must reconnect it.
  db.exec('PRAGMA writable_schema=RESET');
  const census=createRegistrationCensusDatabase(db)!;armed=true;
  try{census.begin();}catch(value){error=value;}
  finally{armed=false;define(Map,'length',prior);}
  expect(calls).toBeGreaterThan(0);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe('application_registration_changed');
  const restored=census.begin();restored.finish();
 }finally{armed=false;define(Map,'length',prior);db.close();rmSync(root,{recursive:true,force:true});}
});
it('public records still fences an actual SQL callback before copying any returned row',()=>{
 const root=mkdtempSync(join(tmpdir(),'registration-public-record-callback-')),db=openPrivateVerificationDatabase(root);
 const prior=Object.getOwnPropertyDescriptor(Map,'length')!,define=Object.defineProperty;
 let armed=true,calls=0;
 try{
  db.function('schema_metadata_callback',()=>{calls++;if(armed)define(Map,'length',{...prior,value:-0});return 1;});
  const census=createRegistrationCensusDatabase(db)!,current=census.begin();let error:unknown;
  try{current.records('SELECT schema_metadata_callback() AS value');}catch(value){error=value;}
  finally{armed=false;define(Map,'length',prior);}
  expect(calls).toBe(1);expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe('application_registration_changed');
  current.finish();const restored=census.begin();restored.finish();
 }finally{armed=false;define(Map,'length',prior);db.close();rmSync(root,{recursive:true,force:true});}
});

it('non-text sqlite_master names keep the original pre-query guard after real Buffer coercion',()=>{
 const root=mkdtempSync(join(tmpdir(),'registration-schema-name-coercion-')),db=openPrivateVerificationDatabase(root);
 const table='verification_application_history',define=Object.defineProperty,apply=Reflect.apply;
 const mapLength=Object.getOwnPropertyDescriptor(Map,'length')!,bufferString=Object.getOwnPropertyDescriptor(Buffer.prototype,'toString')!;
 let armed=false,coercions=0,error:unknown;
 try{
  db.exec('CREATE TABLE '+table+'(owner_key TEXT)');
  // Only this owned DB's malicious-fixture construction disables defensive mode.
  db.unsafeMode(true);
  try{db.pragma('writable_schema=ON');db.prepare('UPDATE main.sqlite_master SET name=CAST(name AS BLOB) WHERE name=?').run(table);}
  finally{db.unsafeMode(false);}
  define(Buffer.prototype,'toString',{...bufferString,value:function(this:Buffer,...args:unknown[]){
   const result=apply(bufferString.value,this,args);
   if(armed&&result===table&&++coercions===2)define(Map,'length',{...mapLength,value:-0});
   return result;
  }});
  const census=createRegistrationCensusDatabase(db)!;armed=true;
  try{census.begin();}catch(value){error=value;}
  finally{armed=false;define(Map,'length',mapLength);define(Buffer.prototype,'toString',bufferString);}
  expect(coercions).toBeGreaterThanOrEqual(2);expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe('application_registration_changed');
  db.unsafeMode(true);
  try{db.exec("UPDATE main.sqlite_master SET name=CAST(name AS TEXT) WHERE typeof(name)='blob'");}
  finally{db.unsafeMode(false);}
  const restored=census.begin();restored.finish();
 }finally{armed=false;define(Map,'length',mapLength);define(Buffer.prototype,'toString',bufferString);db.close();rmSync(root,{recursive:true,force:true});}
});

function transactionMetadataFixture(){
 const root=mkdtempSync(join(tmpdir(),'registration-actual-transaction-'));let db:ReturnType<typeof openPrivateVerificationDatabase>|undefined;
 try{
  db=openPrivateVerificationDatabase(root);
  const tables=[...Object.keys(REGISTRATION_TABLE_KEYS),'verification_profiles','verification_storage_features'];
  for(const table of tables)db.exec('CREATE TABLE '+table+'(owner_key TEXT,future_scalar TEXT DEFAULT(7),future_blob BLOB,constructor TEXT)');
  return {root,db,tables};
 }catch(error){try{db?.close();}finally{rmSync(root,{recursive:true,force:true});}throw error;}
}
function closeTransactionMetadataFixture(f:ReturnType<typeof transactionMetadataFixture>,peer?:ReturnType<typeof openPrivateVerificationDatabase>){
 const failures:unknown[]=[];
 try{peer?.close();}catch(error){failures.push(error);}
 try{if(f.db.open&&f.db.inTransaction)f.db.exec('ROLLBACK');}catch(error){failures.push(error);}
 try{if(f.db.open)f.db.close();}catch(error){failures.push(error);}
 if(failures.length)throw new AggregateError(failures,'owned metadata handles failed to close; root preserved: '+f.root);
 rmSync(f.root,{recursive:true,force:true});
}
it.each([false,true])('complete actual table_xinfo metadata remains equal to native SQL with existing transaction=%s',transaction=>{
 const f=transactionMetadataFixture();
 try{
  if(transaction)f.db.exec('BEGIN IMMEDIATE');
  const native=readPrivateDatabaseNativeAccess(f.db)!,getter=Object.getOwnPropertyDescriptor(native.cpp,'inTransaction')!.get!;
  expect(Reflect.apply(getter,native.cpp,[])).toBe(transaction);
  const c=createRegistrationCensusDatabase(f.db)!.begin();
  expect(Object.keys(c.evidence.columns).sort()).toEqual([...f.tables].sort());
  for(const table of f.tables){
   const actual=c.evidence.columns[table]!,expected=f.db.pragma('main.table_xinfo('+table+')');
   expect(actual).toEqual(expected);expect(actual.length).toBe(4);
   for(const row of actual)expect(Object.getPrototypeOf(row)).toBe(null);
  }
  c.finish();expect(Reflect.apply(getter,native.cpp,[])).toBe(transaction);
 }finally{closeTransactionMetadataFixture(f);}
});
it('an actual caller read transaction blocks a second connection DDL until its original census checkpoint finishes',()=>{
 const f=transactionMetadataFixture();let peer:ReturnType<typeof openPrivateVerificationDatabase>|undefined;
 try{
  const SQLite=createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3');
  peer=new SQLite(join(f.root,'authority.sqlite'),{timeout:0});
  f.db.exec('BEGIN');const owner=createRegistrationCensusDatabase(f.db)!,c=owner.begin();
  let failure:unknown;try{peer.exec('ALTER TABLE verification_application_history ADD COLUMN after_read TEXT');}catch(error){failure=error;}
  expect(failure).toMatchObject({code:'SQLITE_BUSY'});
  expect(c.evidence.columns['verification_application_history']!.some(row=>row.name==='after_read')).toBe(false);
  c.finish();f.db.exec('COMMIT');
  peer.exec('ALTER TABLE verification_application_history ADD COLUMN after_read TEXT');
  const next=owner.begin();expect(next.evidence.columns['verification_application_history']!.some(row=>row.name==='after_read')).toBe(true);next.finish();
 }finally{closeTransactionMetadataFixture(f,peer);}
});
it('an actual WAL reader keeps the original schema snapshot while a second connection commits DDL and refreshes after commit',()=>{
 const f=transactionMetadataFixture();let peer:ReturnType<typeof openPrivateVerificationDatabase>|undefined;
 try{
  f.db.pragma('journal_mode=WAL');
  const SQLite=createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3');peer=new SQLite(join(f.root,'authority.sqlite'),{timeout:0});
  f.db.exec('BEGIN');const owner=createRegistrationCensusDatabase(f.db)!,first=owner.begin();first.finish();
  peer.exec('ALTER TABLE verification_application_history ADD COLUMN after_wal_commit TEXT');
  const locked=owner.begin();expect(locked.evidence.columns['verification_application_history']!.some(row=>row.name==='after_wal_commit')).toBe(false);locked.finish();
  f.db.exec('COMMIT');
  const fresh=owner.begin();expect(fresh.evidence.columns['verification_application_history']!.some(row=>row.name==='after_wal_commit')).toBe(true);fresh.finish();
 }finally{closeTransactionMetadataFixture(f,peer);}
});
it('a real COMMIT/BEGIN true-to-true transaction ABA cannot validate a prior census after actual schema change',()=>{
 const f=transactionMetadataFixture();let peer:ReturnType<typeof openPrivateVerificationDatabase>|undefined;
 try{
  const SQLite=createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3');peer=new SQLite(join(f.root,'authority.sqlite'),{timeout:0});
  f.db.exec('BEGIN');const owner=createRegistrationCensusDatabase(f.db)!,old=owner.begin();expect(f.db.inTransaction).toBe(true);
  f.db.exec('COMMIT');peer.exec('ALTER TABLE verification_application_history ADD COLUMN new_epoch TEXT');f.db.exec('BEGIN');expect(f.db.inTransaction).toBe(true);
  expect(()=>old.finish()).toThrow('application_registration_changed');
  const fresh=owner.begin();expect(fresh.evidence.columns['verification_application_history']!.some(row=>row.name==='new_epoch')).toBe(true);fresh.finish();
 }finally{closeTransactionMetadataFixture(f,peer);}
});
it('real public and CPP transaction accessors reject a forged getter and remain bound to actual native state',()=>{
 const f=transactionMetadataFixture();let getterCalls=0;
 try{
  const native=readPrivateDatabaseNativeAccess(f.db)!,original=Object.getOwnPropertyDescriptor(native.cpp,'inTransaction')!.get!;
  expect(Reflect.apply(original,native.cpp,[])).toBe(false);
  const forged={configurable:true,get(){getterCalls++;return true;}};
  expect(Reflect.defineProperty(f.db,'inTransaction',forged)).toBe(false);
  expect(Reflect.defineProperty(native.cpp,'inTransaction',forged)).toBe(false);
  const c=createRegistrationCensusDatabase(f.db)!.begin();c.finish();
  expect(getterCalls).toBe(0);expect(Reflect.apply(original,native.cpp,[])).toBe(false);
 }finally{closeTransactionMetadataFixture(f);}
});
