import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {expect,it} from 'vitest';
import {canonicalVerificationJson} from '../../../src/runtime/verification/protocol.js';

const protocolUrl=new URL('../../../src/runtime/verification/protocol.js',import.meta.url);
if(!existsSync(protocolUrl))protocolUrl.pathname=protocolUrl.pathname.replace(/\.js$/,'.ts');
const snapshotUrl=new URL('./registration-value-snapshot.js',protocolUrl);
if(!existsSync(snapshotUrl))snapshotUrl.pathname=snapshotUrl.pathname.replace(/\.js$/,'.ts');
const childSource=String.raw`
import {createRequire,syncBuiltinESMExports} from 'node:module';
const mode=process.argv[4];let growable,keysRestore;
if(mode==='canonical-growable-sab'){
 const {Worker}=await import('node:worker_threads');
 const buffer=new SharedArrayBuffer(1,{maxByteLength:2}),signal=new Int32Array(new SharedArrayBuffer(8)),view=new Uint8Array(buffer);
 Object.setPrototypeOf(view,null);
 const worker=new Worker(new URL(process.argv[5]),{workerData:{buffer,signal:signal.buffer}});
 await new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('message',message=>message.ready?resolve(undefined):reject(Error('growth worker not ready')));});
 const original=Object.getOwnPropertyDescriptor(Object,'keys'),keys=original.value;
 // Diagnostic-only forwarding barrier. Descriptors, values and key results
 // remain actual native data; the worker performs the actual SAB growth.
 Object.defineProperty(Object,'keys',{...original,value(input){
  if(input===view){Atomics.store(signal,0,1);Atomics.notify(signal,0);if(Atomics.wait(signal,1,0,2000)==='timed-out')throw Error('native growth barrier timeout');}
  return keys(input);
 }});
 keysRestore=()=>Object.defineProperty(Object,'keys',original);growable={buffer,signal,view,worker};
}
const p=await import(process.argv[2]);
keysRestore?.();
const s=await import(process.argv[3]);
const json=p.canonicalVerificationJson,capture=s.captureRegistrationSnapshot;
const define=Object.defineProperty,descriptor=Object.getOwnPropertyDescriptor,apply=Reflect.apply,NativeError=Error;
const crypto=createRequire(import.meta.url)('node:crypto');
function tuple(){const h='a'.repeat(64);return {schemaVersion:1,profileId:'profile',ownerKind:'task',ownerId:'task1',migrationEpoch:1,expectedBusinessRevision:2,obligationSetRevision:3,obligationSetHash:h,obligations:[{obligationId:'check1',predicateId:'original',predicateVersion:'1',definitionHash:h,activeAttemptId:'attempt1',attemptEpoch:1,sourceRunId:'run1',runNonce:'nonce1',subjectId:'subject1',contentRoot:h,coreId:'core1',coreHash:h,coreFinalRevision:1,proofId:'proof1',proofHash:h,proofRevision:1,requiredScopeId:'scope1',scopeRevision:1,invalidationEpoch:1}],operationId:'operation1',immutablePayloadHash:h,receiverId:'receiver1',receiverProtocolVersion:1,receiverInstanceEpoch:1,reservationId:'reservation1',nonce:'nonce2',notBefore:1000,validUntil:2000,clockDomainId:'clock1',clockQualificationEpoch:1};}
const baselineHash=p.hashVerificationTuple(tuple()),baselineTupleJson=json(p.parseVerificationTuple(tuple()));
let calls=0,traps=0,reads=0,error,result,nativeError=false;const restores=[];
function change(target,key,fields){const old=descriptor(target,key);restores.push(()=>old?define(target,key,old):delete target[key]);define(target,key,{__proto__:null,configurable:true,...fields});}
function accessor(){return define({},'secret',{__proto__:null,enumerable:true,get(){reads++;return 'SECRET';}});}
function proxy(value){return new Proxy(value,{get(t,k,r){traps++;return Reflect.get(t,k,r);},getPrototypeOf(t){traps++;return Reflect.getPrototypeOf(t);},ownKeys(t){traps++;return Reflect.ownKeys(t);},getOwnPropertyDescriptor(t,k){traps++;return Reflect.getOwnPropertyDescriptor(t,k);}});}
try{
 if(mode==='canonical-growable-sab'){
  const {buffer,signal,view,worker}=growable;
  try{
   try{result=json(view);}finally{if(Atomics.load(signal,1)!==1||buffer.byteLength!==2)throw new NativeError('actual native growth missing');}
  }finally{await worker.terminate();}
 }else if(mode.startsWith('canonical-new-native-')){
  const key=mode.slice('canonical-new-native-'.length);
  change(Object,key,{writable:true,value:function(){calls++;throw new NativeError('mutated new native');}});result=json({n:1,rows:[1,2]});
 }else if(mode.startsWith('canonical-toJSON-prototype-')){
  change(mode.endsWith('array')?Array.prototype:Object.prototype,'toJSON',{get(){calls++;throw new NativeError('inherited toJSON');}});result=json({n:1,rows:[1,2]});
 }else if(mode==='canonical-numeric-setter'){
  change(Object.prototype,'0',{set(){calls++;}});result=json({n:1,rows:[1,2]});
 }else if(mode.startsWith('inherited-value-')){
  const kind=mode.split('-')[2],entry=mode.split('-')[3];
  change(Object.prototype,'value',kind==='data'?{value:'HIDDEN'}:{get(){calls++;return 'HIDDEN';}});
  result=entry==='snapshot'?capture(accessor()):json(accessor());
 }else if(mode.startsWith('snapshot-option-')){
  change(Object.prototype,mode.slice('snapshot-option-'.length),{get(){calls++;return undefined;}});
  result=capture({n:1,rows:[1,2]});
 }else if(mode.startsWith('canonical-frame-')){
  change(Object.prototype,mode.slice('canonical-frame-'.length),{get(){calls++;throw new NativeError('inherited frame getter');}});
  result=json({n:1,rows:[1,2]});
 }else if(mode==='canonical-deep-legal'){
  let value={n:1};for(let i=0;i<500;i++)value={next:value};
  result=json(value)==='{"next":'.repeat(500)+'{"n":1}'+'}'.repeat(500);
 }else if(mode==='canonical-deep-cycle'){
  const root={};let current=root;for(let i=0;i<40;i++){current.next={};current=current.next;}current.next=root;result=json(root);
 }else if(mode==='canonical-deep-alias'){
  const shared={n:1};let value=shared;for(let i=0;i<40;i++)value={next:value};
  result=json([value,shared])==='['+'{"next":'.repeat(40)+'{"n":1}'+'}'.repeat(40)+',{"n":1}]';
 }else if(mode.startsWith('canonical-deep-native-')){
  const key=mode.slice('canonical-deep-native-'.length);let value={n:1};for(let i=0;i<40;i++)value={next:value};
  change(key==='constructor'?globalThis:WeakSet.prototype,key==='constructor'?'WeakSet':key,{writable:true,value:function(){calls++;throw new NativeError('mutated native ancestor');}});
  result=json(value)==='{"next":'.repeat(40)+'{"n":1}'+'}'.repeat(40);
 }else if(mode==='snapshot-numeric-setter'){
  change(Object.prototype,'0',{set(){calls++;}});result=capture([1,2]);
 }else if(mode.startsWith('inherited-hole-')){
  const value=new Array(1);change(Object.prototype,'0',{get(){calls++;return 1;}});const entry=mode.slice('inherited-hole-'.length);if(entry==='tuple'){const t=tuple();t.obligations=value;result=p.parseVerificationTuple(t);}else result=entry==='snapshot'?capture(value):json(value);
 }else if(mode.startsWith('proxy-')){
  const parts=mode.split('-'),entry=parts[1],kind=parts[2];let value;
  if(entry==='tuple'){value=tuple();if(kind==='root')value=proxy(value);else value.obligations=proxy(value.obligations);result=p.parseVerificationTuple(value);}
  else if(entry==='key'||entry==='compare'){value=proxy(tuple().obligations[0]);result=entry==='key'?p.verificationDependencyKey(value):p.compareVerificationDependencies(value,tuple().obligations[0]);}
  else {value=kind==='array'?proxy([1]):kind==='nested'?{n:proxy({x:1})}:proxy({n:1});result=entry==='snapshot'?capture(value):json(value);}
 }else if(mode.startsWith('tuple-accessor-')){
  const kind=mode.slice('tuple-accessor-'.length),value=tuple();
  if(kind==='root')define(value,'ownerId',{__proto__:null,enumerable:true,get(){reads++;return 'task1';}});
  else if(kind==='index')define(value.obligations,'0',{__proto__:null,enumerable:true,get(){reads++;return tuple().obligations[0];}});
  else if(kind==='item')define(value.obligations[0],'obligationId',{__proto__:null,enumerable:true,get(){reads++;return 'check1';}});
  else if(kind==='species')define(value.obligations,'constructor',{__proto__:null,get(){reads++;return Array;}});
  result=p.parseVerificationTuple(value);
 }else if(mode==='tuple-custom-map'){
  const value=tuple();value.obligations.map=function(){calls++;return [];};result=p.parseVerificationTuple(value).obligations.length;
 }else if(mode==='canonical-custom-map'){
  const value=[1,2];value.map=function(){calls++;return [999];};result=json(value);
 }else if(mode.startsWith('inherited-kind-')){
  change(Object.prototype,'kind',{get(){calls++;return 'inherited';}});const value=tuple();
  const entry=mode.slice('inherited-kind-'.length);result=entry==='tuple'?p.parseVerificationTuple(value).obligations.length:entry==='key'?p.verificationDependencyKey(value.obligations[0]):p.compareVerificationDependencies(value.obligations[0],value.obligations[0]);
 }else if(mode.startsWith('accessor-')){
  const entry=mode.slice('accessor-'.length),value=tuple().obligations[0];define(value,'obligationId',{__proto__:null,enumerable:true,get(){reads++;return 'check1';}});
  result=entry==='key'?p.verificationDependencyKey(value):p.compareVerificationDependencies(value,value);
 }else if(mode.startsWith('cycle-')){
  const entry=mode.slice('cycle-'.length),value={};value.self=value;
  if(entry==='canonical')result=json(value);else if(entry==='snapshot')result=capture(value);
  else {const dependency=tuple().obligations[0];dependency.obligationId=value;result=entry==='key'?p.verificationDependencyKey(dependency):p.compareVerificationDependencies(dependency,dependency);}
 }else if(mode.startsWith('symbol-accessor-')){
  const value={n:1};define(value,Symbol('hidden'),{__proto__:null,get(){reads++;return 1;}});result=mode.endsWith('snapshot')?capture(value):json(value);
 }else if(mode.startsWith('captured-native-')){
  const key=mode.slice('captured-native-'.length),value=tuple();
  const targets={'bind':[Function.prototype,'bind'],'call':[Function.prototype,'call'],'apply':[Function.prototype,'apply'],
   'weak-has':[WeakSet.prototype,'has'],'weak-add':[WeakSet.prototype,'add'],'weak-delete':[WeakSet.prototype,'delete'],
   'set-has':[Set.prototype,'has'],'set-add':[Set.prototype,'add'],'sort':[Array.prototype,'sort'],
   'includes':[Array.prototype,'includes'],'regex-test':[RegExp.prototype,'test']};
  const [target,field]=targets[key];change(target,field,{writable:true,value:function(){calls++;throw new NativeError('mutated native method');}});
  result=json(p.parseVerificationTuple(value));
 }else if(mode==='canonical-key-prefix-known-prototype'){
  change(Object.prototype,'artifactId',{get(){calls++;throw new NativeError('inherited cached key');}});
  result=json({summary:null,kind:'file',artifactId:7});
 }else if(mode==='canonical-key-prefix-reserved-prototype'){
  for(const key of ['constructor','toString'])change(Object.prototype,key,{get(){calls++;throw new NativeError('inherited reserved key');}});
  result=json(JSON.parse('{"toString":8,"constructor":7,"__proto__":9}'));
 }else if(mode.startsWith('hash-')){
  const key=mode.slice('hash-'.length),target=key==='createHash'?crypto:crypto.Hash.prototype,original=descriptor(target,key).value;
  change(target,key,{writable:true,value:function(...args){calls++;return apply(original,this,args);}});syncBuiltinESMExports();result=p.hashVerificationTuple(tuple());
 }else if(mode.startsWith('error-')){
  change(globalThis,'Error',{writable:true,value:function(message){calls++;return new NativeError(message);}});
  const entry=mode.slice('error-'.length);result=entry==='canonical'?json(accessor()):entry==='snapshot'?capture(accessor()):p.parseVerificationTuple(proxy(tuple()));
 }
}catch(e){error=e.message;nativeError=e instanceof NativeError;}
finally{for(let i=restores.length-1;i>=0;i--)restores[i]();syncBuiltinESMExports();}
console.log(JSON.stringify({error,nativeError,calls,traps,reads,result,baselineHash,baselineTupleJson,restoredHash:p.hashVerificationTuple(tuple()),normalSnapshot:capture({n:1})}));
`;
const cases:{mode:string;error?:string;result?:unknown;hash?:boolean;tupleJson?:boolean}[]=[];
cases.push({mode:'canonical-growable-sab',error:"Cannot read properties of undefined (reading 'value')"});
for(const key of ['create','setPrototypeOf'])cases.push({mode:`canonical-new-native-${key}`,result:'{"n":1,"rows":[1,2]}'});
for(const kind of ['object','array'])cases.push({mode:`canonical-toJSON-prototype-${kind}`,result:'{"n":1,"rows":[1,2]}'});
cases.push({mode:'canonical-numeric-setter',result:'{"n":1,"rows":[1,2]}'});
for(const kind of ['data','getter'])for(const entry of ['snapshot','canonical'])cases.push({mode:`inherited-value-${kind}-${entry}`,error:'verification_accessor_denied'});
for(const key of ['get','set','writable','enumerable','configurable'])cases.push({mode:`snapshot-option-${key}`,result:{n:1,rows:[1,2]}});
cases.push({mode:'snapshot-numeric-setter',result:[1,2]});
for(const field of ['value','parent','depth'])cases.push({mode:`canonical-frame-${field}`,result:'{"n":1,"rows":[1,2]}'});
cases.push({mode:'canonical-deep-legal',result:true},{mode:'canonical-deep-cycle',error:'verification_invalid_record'},{mode:'canonical-deep-alias',result:true});
for(const key of ['constructor','has','add','delete'])cases.push({mode:`canonical-deep-native-${key}`,result:true});
for(const entry of ['snapshot','canonical','tuple'])cases.push({mode:`inherited-hole-${entry}`,error:'verification_invalid_record'});
for(const entry of ['snapshot','canonical'])for(const kind of ['root','nested','array'])cases.push({mode:`proxy-${entry}-${kind}`,error:'verification_invalid_record'});
for(const kind of ['root','obligations'])cases.push({mode:`proxy-tuple-${kind}`,error:'verification_invalid_record'});
for(const entry of ['key','compare'])cases.push({mode:`proxy-${entry}-root`,error:'verification_invalid_record'});
for(const kind of ['root','index','item','species'])cases.push({mode:`tuple-accessor-${kind}`,error:'verification_accessor_denied'});
cases.push({mode:'tuple-custom-map',result:1},{mode:'canonical-custom-map',result:'[1,2]'});
cases.push({mode:'inherited-kind-tuple',result:1},{mode:'inherited-kind-key',result:'["direct","check1"]'},{mode:'inherited-kind-compare',result:0});
for(const entry of ['key','compare'])cases.push({mode:`accessor-${entry}`,error:'verification_accessor_denied'});
for(const entry of ['canonical','snapshot','key','compare'])cases.push({mode:`cycle-${entry}`,error:'verification_invalid_record'});
for(const entry of ['canonical','snapshot'])cases.push({mode:`symbol-accessor-${entry}`,error:'verification_accessor_denied'});
for(const key of ['update','digest','createHash'])cases.push({mode:`hash-${key}`,hash:true});
cases.push({mode:'canonical-key-prefix-known-prototype',result:'{"artifactId":7,"kind":"file","summary":null}'},
 {mode:'canonical-key-prefix-reserved-prototype',result:'{"__proto__":9,"constructor":7,"toString":8}'});
for(const key of ['bind','call','apply','weak-has','weak-add','weak-delete','set-has','set-add','sort','includes','regex-test'])cases.push({mode:`captured-native-${key}`,tupleJson:true});
for(const entry of ['canonical','snapshot','tuple'])cases.push({mode:`error-${entry}`,error:entry==='tuple'?'verification_invalid_record':'verification_accessor_denied'});
it.each(cases)('actual own-data production boundary: $mode',({mode,error,result,hash,tupleJson})=>{
 const root=mkdtempSync(join(tmpdir(),'verification-own-data-')),script=join(root,'probe.mjs');
 try{
  let actualProtocol=protocolUrl,actualSnapshot=snapshotUrl;
  if(protocolUrl.pathname.endsWith('.ts')){
   // Compile the entire actual source modules. tsx's keepNames wrappers themselves
   // read inherited descriptor flags; they must not become the tested boundary.
   writeFileSync(join(root,'package.json'),'{"type":"module"}');
   for(const name of ['protocol','registration-value-snapshot','registration-intrinsics']){
    const source=new URL('./'+name+'.ts',protocolUrl);
    writeFileSync(join(root,name+'.js'),ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
   }
   actualProtocol=pathToFileURL(join(root,'protocol.js'));actualSnapshot=pathToFileURL(join(root,'registration-value-snapshot.js'));
  }
  const grower=new URL('../../support/canonical-growable-sab-worker.mjs',import.meta.url);
  writeFileSync(script,childSource);const child=spawnSync(process.execPath,[script,actualProtocol.href,actualSnapshot.href,mode,grower.href],{encoding:'utf8',timeout:4500});
  expect(child.status,child.stderr).toBe(0);const proof=JSON.parse(child.stdout);
  expect(proof.calls).toBe(0);expect(proof.traps).toBe(0);expect(proof.reads).toBe(0);
  expect(proof.error,JSON.stringify(proof)).toBe(error);if(error)expect(proof.nativeError).toBe(true);
  else expect(proof.result).toEqual(hash?proof.baselineHash:tupleJson?proof.baselineTupleJson:result);
  expect(proof.restoredHash).toBe(proof.baselineHash);expect(proof.normalSnapshot).toEqual({n:1});
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('keeps exact original legal JSON bytes including null prototypes, Unicode and negative zero',()=>{
 const value=Object.assign(Object.create(null),{z:'长\n"',a:[-0,null,true,false,'é'],b:{z:2,a:1}});
 expect(canonicalVerificationJson(value)).toBe('{"a":[0,null,true,false,"é"],"b":{"a":1,"z":2},"z":"长\\n\\\""}');
});
it('keeps native JSON bytes for all fixed schema key labels',()=>{
 const ordered={artifactId:1,candidateId:1,candidateRevision:1,content:1,createdAt:1,deliverable:1,intentId:1,intentType:1,kind:1,label:1,obligationId:1,obligations:1,order:1,originOwner:1,originalObligationId:1,originalPath:1,ownerId:1,ownerKind:1,path:1,predicateId:1,profileId:1,riskTier:1,selection:1,sessionId:1,sha256:1,size:1,stageId:1,subject:1,summary:1,templateId:1,verification:1,version:1};
 const input=Object.fromEntries(Object.entries(ordered).reverse());
 expect(canonicalVerificationJson(input)).toBe(JSON.stringify(ordered));
});
it('keeps exact bytes for unknown escaped, Unicode, reserved and surrogate key labels',()=>{
 const ordered={'"\\\n':1,['__proto__']:9,kind:4,é:2,['\ud800']:3};
 const input=Object.fromEntries(Object.entries(ordered).reverse());
 expect(canonicalVerificationJson(input)).toBe(JSON.stringify(ordered));
});
it('rejects object and array toJSON accessors without invoking them',()=>{
 let calls=0;
 for(const input of [{kind:'file'},[1]]){
  Object.defineProperty(input,'toJSON',{get(){calls++;return ()=>null;}});
  expect(()=>canonicalVerificationJson(input)).toThrow('verification_accessor_denied');
 }
 expect(calls).toBe(0);
});
it('ignores nonenumerable object and extra array toJSON data functions',()=>{
 let calls=0;const fn=()=>{calls++;return null;};
 const object={kind:'file'},array=[1];
 Object.defineProperty(object,'toJSON',{value:fn});Object.defineProperty(array,'toJSON',{value:fn,enumerable:true});
 expect(canonicalVerificationJson(object)).toBe('{"kind":"file"}');
 expect(canonicalVerificationJson(array)).toBe('[1]');expect(calls).toBe(0);
});
it('rejects an enumerable object toJSON data function without invoking it',()=>{
 let calls=0;const input={kind:'file',toJSON(){calls++;return null;}};
 expect(()=>canonicalVerificationJson(input)).toThrow('verification_invalid_record');expect(calls).toBe(0);
});
