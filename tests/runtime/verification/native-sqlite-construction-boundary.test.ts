import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {expect,it} from 'vitest';

const source=new URL('../../../src/runtime/verification/private-database.js',import.meta.url);
if(!existsSync(source))source.pathname=source.pathname.replace(/\.js$/,'.ts');
const extension=source.pathname.endsWith('.ts')?'.ts':'.js';
const census=new URL('./registration-census-database'+extension,source);
const native=new URL('./native-sqlite-census'+extension,source);
// Every case runs actual production and the actual SDK in a separate native
// Node process. Prototype attacks never enter the Vitest harness.
const probe=String.raw`
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {openPrivateVerificationDatabase}=await import(process.argv[2]);
const {createRegistrationCensusDatabase}=await import(process.argv[3]);
const native=await import(process.argv[4]);
const {entry,field,shape,legal}=JSON.parse(process.argv[5]);
const define=Object.defineProperty,descriptor=Object.getOwnPropertyDescriptor;
const root=mkdtempSync(join(tmpdir(),'sqlite-construction-native-')),db=openPrivateVerificationDatabase(root);
let calls=0,callbackCalls=0,error,result,frame,restored=false;
const target=entry==='callback'&&field.startsWith('array-')?Array.prototype:Object.prototype;
const key=field==='symbol'?Symbol('safe-native-field'):field.startsWith('array-')?field.slice(6):field;
const prior=descriptor(target,key);
const restore=()=>{if(restored)return;restored=true;if(prior)define(target,key,prior);else delete target[key];};
const install=()=>{
 const attributes={__proto__:null,configurable:true};
 if(shape==='data'){attributes.value=17;attributes.writable=false;}
 else if(shape==='get')attributes.get=function(){calls++;return undefined;};
 else if(key==='push')attributes.value=function(){calls++;return 0;};
 else attributes.set=function(value){calls++;if(key==='1024'&&Array.isArray(value)){const row=[...value];row[0]=7777777n;row[2]=Buffer.from('7777777');define(this,key,{__proto__:null,value:row,writable:true,configurable:true,enumerable:true});}};
 define(target,key,attributes);
};
try{
 db.exec("CREATE TABLE verification_profiles(uid INTEGER PRIMARY KEY,account_id TEXT,profile_id TEXT,state TEXT);WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1025) INSERT INTO verification_profiles SELECT n,'account','profile','ready' FROM seq;CREATE TABLE verification_application_history(owner_key TEXT,value INTEGER);WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1025) INSERT INTO verification_application_history SELECT 'Owner',n FROM seq");
 const reader=createRegistrationCensusDatabase(db);
 if(entry==='records'||entry==='groups'||entry==='finish'||entry==='callback')frame=reader.begin();
 if(entry==='callback')db.function('actual_callback',()=>{callbackCalls++;if(!legal)install();return 23;});
 if(!legal||field!=='normal'){if(entry!=='callback')install();}
 try{
  if(entry==='begin')result=reader.begin();
  else if(entry==='records')result=frame.records('SELECT * FROM main.verification_application_history');
  else if(entry==='groups')result=frame.groups('verification_application_history',['Owner']).get('Owner');
  else if(entry==='finish'){frame.finish();result=true;}
  else if(entry==='callback')result=frame.records('SELECT actual_callback() AS value');
  else if(entry==='single')result=native.readNativeSqliteCensus(db,'verification_profiles');
  else if(entry==='enrollment')result=native.readNativeEnrollmentCensus(db);
  else if(entry==='kswarm')result=native.readNativeKSwarmCensus(db,'Owner','profile');
  else if(entry==='producer-kinds'){native.assertNativeSqliteProducerTableKinds(db);result=true;}
  else if(entry==='producer-columns'){native.assertNativeSqliteStoredProducerColumns(db,'verification_profiles');result=true;}
  else throw Error('unknown actual entry');
 }catch(failure){error=failure.message;}
}finally{restore();}
const receipt={accepted:error===undefined,error:error??null,calls,callbackCalls};
if(legal&&error===undefined){
 if(entry==='single'||entry==='enrollment'||entry==='kswarm'){
  const facts=entry==='single'?result:entry==='enrollment'?result.find(f=>f.table==='verification_profiles'):result.profile;
  receipt.rowCount=facts.rows.length;receipt.originalUid=facts.rows.some(row=>row.uid===1025);receipt.forgedUid=facts.rows.some(row=>row.uid===7777777);
 }else if(entry==='records'||entry==='groups'){receipt.rowCount=result.length;receipt.originalLastValue=result[1024].value;}
 else if(entry==='callback')receipt.value=result[0].value;
 // Safe inherited names/index-like strings preserve the entire closing fence.
 if(frame&&entry!=='finish')frame.finish();
 if(entry==='begin')result.finish();
}
db.close();rmSync(root,{recursive:true,force:true,maxRetries:3});
process.stdout.write(JSON.stringify(receipt));
`;
type Case={entry:string;field:string;shape:string;legal:boolean};
function run(test:Case){
 const root=mkdtempSync(join(tmpdir(),'sqlite-construction-probe-'));
 try{
  const entry=join(root,'probe.mjs');writeFileSync(entry,probe);
  const loader=extension==='.ts'?['--import',createRequire(import.meta.url).resolve('tsx')]:[];
  const child=spawnSync(process.execPath,[...loader,entry,source.href,census.href,native.href,JSON.stringify(test)],{encoding:'utf8',timeout:4500});
  expect(child.status,child.stderr).toBe(0);return JSON.parse(child.stdout);
 }finally{rmSync(root,{recursive:true,force:true,maxRetries:3});}
}
const rejected:Case[]=[];
for(const entry of ['begin','records','groups','finish'])for(const field of ['0','1','4294967294','name','column','table','database','type'])rejected.push({entry,field,shape:'set',legal:false});
for(const shape of ['get','data'])for(const field of ['0','name'])rejected.push({entry:'records',field,shape,legal:false});
for(const entry of ['single','enrollment','kswarm','producer-kinds','producer-columns'])rejected.push({entry,field:'1024',shape:'set',legal:false});
it.each(rejected)('rejects actual native construction before callbacks: $entry $field $shape',test=>{
 expect(run(test)).toEqual({accepted:false,error:'application_registration_changed',calls:0,callbackCalls:0});
});
const legal:Case[]=[];
for(const entry of ['begin','records','groups','finish'])for(const field of ['00','-0','1.5','4294967295','symbol','owner_key'])legal.push({entry,field,shape:'set',legal:true});
for(const entry of ['single','enrollment','kswarm'])for(const field of ['normal','name'])legal.push({entry,field,shape:'set',legal:true});
it.each(legal)('retains actual safe native rows and closing fences: $entry $field',test=>{
 const proof=run(test);expect(proof).toMatchObject({accepted:true,error:null,calls:0,callbackCalls:0});
 if(['single','enrollment','kswarm'].includes(test.entry))expect(proof).toMatchObject({rowCount:1025,originalUid:true,forgedUid:false});
 if(test.entry==='records'||test.entry==='groups')expect(proof).toMatchObject({rowCount:1025,originalLastValue:1025});
});
it.each(['0','name','array-0','array-push'])('rejects actual SQL callback drift after native all: %s',field=>{
 expect(run({entry:'callback',field,shape:'set',legal:false})).toEqual({accepted:false,error:'application_registration_changed',calls:0,callbackCalls:1});
});
it('retains actual SQL callback results when primitives do not change',()=>{
 expect(run({entry:'callback',field:'normal',shape:'set',legal:true})).toEqual({accepted:true,error:null,calls:0,callbackCalls:1,value:23});
});
