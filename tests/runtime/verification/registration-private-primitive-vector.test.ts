import {afterEach,expect,it,vi} from 'vitest';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createCompletionBoundary} from '../../../src/runtime/verification/completion-boundary.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {createProfileIndexPublisher} from '../../../src/runtime/verification/profile-index-publication.js';
import {createOwnerEnrollmentAuthority} from '../../../src/runtime/verification/owner-enrollment-authority.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
const observed=vi.hoisted(()=>({calls:[] as {input:unknown;output:unknown;freeze:boolean}[],after:undefined as undefined|((input:unknown,output:unknown,freeze:boolean)=>void)}));
vi.mock('../../../src/runtime/verification/registration-value-snapshot.js',async importOriginal=>{
 const actual=await importOriginal<typeof import('../../../src/runtime/verification/registration-value-snapshot.js')>();
 return {...actual,captureRegistrationSnapshot<T>(input:T,freeze=true):T{
  const output=actual.captureRegistrationSnapshot(input,freeze);
  observed.calls.push({input,output,freeze});observed.after?.(input,output,freeze);return output;
 }};
});
const closes:(()=>void)[]=[];
afterEach(()=>{observed.after=undefined;for(const close of closes.splice(0).reverse())close();observed.calls.length=0;});
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('expected_record');return value as Record<string,unknown>;}
function list(value:unknown):unknown[]{if(!Array.isArray(value))throw Error('expected_array');return value;}
function vectorObservation(){
 const captured=observed.calls.find(c=>Array.isArray(c.output)&&c.output.length>0&&typeof record(c.output[0]).key==='string'&&Array.isArray(record(c.output[0]).profiles));
 if(!captured)throw Error('expected_complete_registration_vector');
 return {nodes:list(captured.output),raw:list(captured.input)};
}
function fixture(population=1,enroll=false){
 const root=mkdtempSync(join(tmpdir(),'private-primitive-vector-')),database=openPrivateVerificationDatabase(root),keys=generateKeyPairSync('ed25519'),H='a'.repeat(64);
 const clock=()=>({domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:H});
 const completion=createCompletionBoundary({root,database,authority:{receiverVerifier:createReceiverReplyVerifier({keyId:'receiver',receiverId:'receiver',receiverInstanceEpoch:1,publicKey:keys.publicKey}),issuerId:'authority',verifierHash:H,keyId:'key',serviceEpoch:'boot',privateKey:keys.privateKey,clock,assertQualified(){},quiescence:{assertQuiescent(){}}}});
 const markers=join(root,'markers');mkdirSync(markers,{mode:0o755});
 const profilePublication=enroll?createProfileIndexPublisher({root:markers,database,authorityId:'authority',assertCurrent(){}}):{publish(){throw Error('not_a_publication_fixture');},assertPublished(){}};
 const authority=createOwnerEnrollmentAuthority({database,completion,authorityId:'authority',clock,resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const}),async approve(review){if(!enroll)throw Error('not_an_approval_fixture');return {uid:501,auditSessionId:7,reviewHash:createHash('sha256').update(json(review)).digest('hex')};},profilePublication});
 // An intent identity with no contract receipt exercises the real census fallback,
 // never collectFixedRegistrationData, and grants no owner/execution capability.
 const owner={profileId:'profile',ownerKind:'intent' as const,ownerId:'intent-subject-v1:root'};
 const ownerKeys=[json(owner)];
 for(let i=1;i<population;i++){const child=json({...owner,ownerId:'intent-subject-v1:child-'+i});ownerKeys.push(child);database.prepare('INSERT INTO verification_owner_dependencies(parent_key,child_key) VALUES(?,?)').run(json(owner),child);}
 closes.push(()=>{authority.close();completion.close();database.close();rmSync(root,{recursive:true,force:true});});
 observed.calls.length=0;return {database,authority,owner,ownerKeys};
}
it('real census preserves the complete owner-key population and rejects a late graph change',()=>{
 const f=fixture(8),fence=f.authority.captureRegistrationReadFence(f.owner),captured=vectorObservation();
 expect(captured.nodes.map(v=>record(v).key).sort()).toEqual([...f.ownerKeys].sort());
 expect(captured.nodes).not.toBe(captured.raw);expect(fence()).toBeUndefined();
 f.database.prepare('INSERT INTO verification_owner_dependencies(parent_key,child_key) VALUES(?,?)').run(json(f.owner),json({...f.owner,ownerId:'late-child'}));
 expect(fence).toThrow('application_registration_changed');
});
it('real profiles and repeated storage occurrences are detached independently',()=>{
 const f=fixture(2);f.database.prepare('INSERT INTO verification_profiles VALUES(?,?,?,?)').run(501,'11111111-AAAA-BBBB-CCCC-555555555555','profile','active');
 f.authority.captureRegistrationReadFence(f.owner);
 const {nodes,raw}=vectorObservation();
 expect(list(record(nodes[0]).profiles)[0]).not.toBe(list(record(raw[0]).profiles)[0]);
 expect(record(nodes[0]).storageFeatures).not.toBe(record(nodes[1]).storageFeatures);
 expect(list(record(nodes[0]).profiles)[0]).not.toBe(list(record(nodes[1]).profiles)[0]);
});
it('real unknown constructor column is ordinary own data and remains fenced',()=>{
 const f=fixture();f.database.exec('DROP TABLE verification_application_history;CREATE TABLE verification_application_history(owner_key TEXT,constructor TEXT)');
 f.database.prepare('INSERT INTO verification_application_history VALUES(?,?)').run(json(f.owner),'original');
 const fence=f.authority.captureRegistrationReadFence(f.owner);
 const node=record(vectorObservation().nodes[0]);expect(record(list(node.history)[0]).constructor).toBe('original');
 f.database.prepare('UPDATE verification_application_history SET constructor=?').run('changed');expect(fence).toThrow('application_registration_changed');
});
it('non-safe-integer cells use the original finite-number snapshot path',()=>{
 const f=fixture();f.database.exec('DROP TABLE verification_application_history;CREATE TABLE verification_application_history(owner_key TEXT,future REAL)');
 f.database.prepare('INSERT INTO verification_application_history VALUES(?,?)').run(json(f.owner),1.25);
 const fence=f.authority.captureRegistrationReadFence(f.owner);
 expect(record(list(record(vectorObservation().nodes[0]).history)[0]).future).toBe(1.25);expect(fence()).toBeUndefined();
 f.database.prepare('UPDATE verification_application_history SET future=?').run(2.5);expect(fence).toThrow('application_registration_changed');
});
it('real BLOB rejection is left to the original per-table snapshot',()=>{
 const f=fixture();f.database.exec('DROP TABLE verification_application_history;CREATE TABLE verification_application_history(owner_key TEXT,future BLOB)');
 const fence=f.authority.captureRegistrationReadFence(f.owner);expect(fence()).toBeUndefined();
 f.database.prepare('INSERT INTO verification_application_history VALUES(?,?)').run(json(f.owner),Buffer.from([0,255]));
 expect(()=>f.authority.captureRegistrationReadFence(f.owner)).toThrow('verification_invalid_record');expect(fence).toThrow('verification_invalid_record');
});
it('real finish still rejects a schema change after the detached primitive snapshot',()=>{
 const f=fixture();let injected=false;
 observed.after=(_input,_output,freeze)=>{if(!freeze&&!injected){injected=true;f.database.exec('CREATE TABLE finish_only_change(n INTEGER)');}};
 expect(()=>f.authority.captureRegistrationReadFence(f.owner)).toThrow('application_registration_changed');expect(injected).toBe(true);
});
it.each(['constructor','iterator','species','mapIterator'] as const)('retained real guards reject poisoned Array %s without invoking it',kind=>{
 const f=fixture(),target=kind==='species'?Array:kind==='mapIterator'?Map.prototype:Array.prototype,key=kind==='constructor'?'constructor':kind==='species'?Symbol.species:Symbol.iterator,prior=Object.getOwnPropertyDescriptor(target,key)!;
 let calls=0,error:unknown;Object.defineProperty(target,key,{configurable:true,get(){calls++;throw Error('hostile_array');}});
 try{try{f.authority.captureRegistrationReadFence(f.owner);}catch(value){error=value;}}finally{Object.defineProperty(target,key,prior);}
 expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe('application_registration_changed');expect(calls).toBe(0);
});

it('actual enrollment activation retains original per-table temporary copies and commits active rows',async()=>{
 const f=fixture(1,true),H='a'.repeat(64),peer={uid:501,gid:20,auditSessionId:7};
 const recipe={kind:'artifact-content' as const,checks:[{id:'content',path:'result.txt',sha256:H,structure:'utf8' as const}]};
 const draft={enrollment:{ownerKind:'task' as const,ownerId:'task',invocations:[{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'}]},registration:{migrationEpoch:1,obligations:[{obligation:{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject' as const,definitionHash:createHash('sha256').update(json(recipe)).digest('hex'),requiredCheckIds:['content']},recipe}],source:{kind:'new-owner' as const}}};
 const prepared=f.authority.prepare(draft,peer);observed.calls.length=0;
 const pending:{ownerKey:string;raw:Record<string,unknown>;temporary:Record<string,unknown>;rawBefore:unknown;temporaryBefore:unknown}[]=[];
 observed.after=(input,output,freeze)=>{
  if(freeze||!Array.isArray(input)||!Array.isArray(output))return;
  for(let i=0;i<input.length;i++){
   const raw=record(input[i]),temporary=record(output[i]);
   if(typeof raw.owner_key==='string'&&Object.hasOwn(raw,'uid')&&raw.state==='pending')pending.push({ownerKey:raw.owner_key,raw,temporary,rawBefore:raw.state,temporaryBefore:temporary.state});
  }
 };
 const result=await f.authority.authorize(prepared.challengeId,peer,new AbortController().signal),ownerKey=json(result.owner);
 expect(f.database.prepare('SELECT state FROM verification_registered_owners WHERE owner_key=?').get(ownerKey)).toEqual({state:'active'});
 const activated=pending.filter(row=>row.ownerKey===ownerKey&&row.temporary.state==='active');expect(activated.length).toBeGreaterThan(0);
 for(const row of activated){
  expect(row.rawBefore).toBe('pending');expect(row.temporaryBefore).toBe('pending');expect(row.raw.state).toBe('pending');
  expect(row.raw).not.toBe(row.temporary);expect(row.raw.owner_key).toBe(ownerKey);expect(row.temporary.owner_key).toBe(ownerKey);expect(row.temporary.state).toBe('active');
 }
});
