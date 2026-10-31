import {afterEach,expect,it,vi} from 'vitest';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as censusDatabase from '../../../src/runtime/verification/registration-census-database.js';
import * as privateDatabase from '../../../src/runtime/verification/private-database.js';
import * as registrationSnapshot from '../../../src/runtime/verification/registration-value-snapshot.js';
import * as intentSqlParsing from '../../../src/runtime/verification/intent-sql-parsing-context.js';
import {createCompletionBoundary} from '../../../src/runtime/verification/completion-boundary.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {createOwnerEnrollmentAuthority} from '../../../src/runtime/verification/owner-enrollment-authority.js';
import {parseIntentContractEnrollment} from '../../../src/runtime/verification/intent-contract-enrollment.js';
import {intentHostSubjectOwner} from '../../../src/runtime/verification/intent-host-subject.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
import type {VerificationOwner} from '../../../src/runtime/verification/proof-authority.js';
import {intentApplicationCandidate} from '../../support/intent-application-fixture.js';

const H='a'.repeat(64),cleanups:(()=>void)[]=[];
afterEach(()=>{for(const close of cleanups.splice(0).reverse())close();vi.restoreAllMocks();});

type Branch='collector'|'generic';
type NativeRead=Readonly<{operation:'prepare';sql:unknown}|{operation:string;sql:unknown;arguments:readonly unknown[]}>;
interface Observation {
 mode:Branch;
 native:NativeRead[];
 contractReads:string[];
 vector:unknown;
 evidence:unknown;
 genericFinished:boolean;
}
interface Result {
 readonly native:readonly NativeRead[];
 readonly contractReads:readonly string[];
 readonly vector:unknown;
 readonly evidence:unknown;
 readonly error:Readonly<{name:string;message:string}>|undefined;
}

function errorValue(value:unknown):Result['error']{
 if(value===undefined)return undefined;
 return value instanceof Error?{name:value.name,message:value.message}:{name:typeof value,message:String(value)};
}

function fixture(){
 const root=mkdtempSync(join(tmpdir(),'intent-collector-equivalence-')),database=privateDatabase.openPrivateVerificationDatabase(root),keys=generateKeyPairSync('ed25519'),clock=()=>({domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:H});
 const completion=createCompletionBoundary({root,database,authority:{receiverVerifier:createReceiverReplyVerifier({keyId:'receiver',receiverId:'receiver',receiverInstanceEpoch:1,publicKey:keys.publicKey}),issuerId:'authority',verifierHash:H,keyId:'key',serviceEpoch:'boot',privateKey:keys.privateKey,clock,assertQualified(){},quiescence:{assertQuiescent(){}}}});
 let active:Observation|undefined;
 const statementSql=new WeakMap<object,unknown>();
 const readNative=privateDatabase.readPrivateDatabaseNativeAccess;
 const nativeSpy=vi.spyOn(privateDatabase,'readPrivateDatabaseNativeAccess').mockImplementation(((candidate:Parameters<typeof readNative>[0])=>{
  const actual=readNative(candidate);if(candidate!==database||!actual)return actual;
  const statement=Object.fromEntries(Object.entries(actual.statement).map(([operation,method])=>[operation,function(this:object,...args:unknown[]){
   if(active)active.native.push({operation,sql:statementSql.get(this),arguments:[...args]});
   return Reflect.apply(method,this,args);
  }])) as typeof actual.statement;
  const prepare=function(this:object,...args:unknown[]){
   if(active)active.native.push({operation:'prepare',sql:args[0]});
   const prepared=Reflect.apply(actual.prepare,this,args) as object;statementSql.set(prepared,args[0]);return prepared;
  };
  return Object.freeze({...actual,prepare,statement:Object.freeze(statement)}) as typeof actual;
 }) as typeof readNative);

 const createCensus=censusDatabase.createRegistrationCensusDatabase;
 const censusSpy=vi.spyOn(censusDatabase,'createRegistrationCensusDatabase').mockImplementation(((candidate:Parameters<typeof createCensus>[0])=>{
  const actual=createCensus(candidate);if(candidate!==database||!actual)return actual;
  const wrapped={
   begin(){
    const current=actual.begin();
    return Object.freeze({...current,finish(){current.finish();if(active?.mode==='generic'){active.evidence=current.evidence;active.genericFinished=true;}}});
   },
   collectFixedRegistrationData(raw:Parameters<typeof actual.collectFixedRegistrationData>[0]){return actual.collectFixedRegistrationData(raw);},
   collectIntentRegistrationData(raw:Parameters<typeof actual.collectIntentRegistrationData>[0]){
    if(active?.mode==='generic')return undefined;
    const data=actual.collectIntentRegistrationData(raw);if(active?.mode==='collector'&&data){active.vector=data.vector;active.evidence=data.evidence;}return data;
   },
  };
  return Object.freeze(wrapped) as typeof actual;
 }) as typeof createCensus);

 const captureSnapshot=registrationSnapshot.captureRegistrationSnapshot;
 const snapshotSpy=vi.spyOn(registrationSnapshot,'captureRegistrationSnapshot').mockImplementation(((input:unknown,freeze?:boolean)=>{
  const result=captureSnapshot(input,freeze);
  if(active?.mode==='generic'&&active.genericFinished&&active.vector===undefined){active.vector=result;active.genericFinished=false;}
  return result;
 }) as typeof captureSnapshot);
 const readContract=intentSqlParsing.readIntentSqlContract;
 const contractSpy=vi.spyOn(intentSqlParsing,'readIntentSqlContract').mockImplementation(((candidate,raw)=>{if(active)active.contractReads.push(raw);return readContract(candidate,raw);}) as typeof readContract);

 let authority:ReturnType<typeof createOwnerEnrollmentAuthority>|undefined;
 try{
  authority=createOwnerEnrollmentAuthority({database,completion,authorityId:'authority',clock,resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const}),async approve(){throw Error('not an approval fixture');},profilePublication:{publish(){throw Error('not a publication fixture');},assertPublished(){}}});
 }catch(error){contractSpy.mockRestore();snapshotSpy.mockRestore();censusSpy.mockRestore();nativeSpy.mockRestore();completion.close();database.close();rmSync(root,{recursive:true,force:true});throw error;}
 const currentAuthority=authority!;
 function observe(mode:Branch,owner:VerificationOwner):Result{
  const observation:Observation={mode,native:[],contractReads:[],vector:undefined,evidence:undefined,genericFinished:false};let error:unknown;
  active=observation;try{currentAuthority.captureRegistrationReadFence(owner);}catch(value){error=value;}finally{active=undefined;}
  return {native:observation.native,contractReads:observation.contractReads,vector:observation.vector,evidence:observation.evidence,error:errorValue(error)};
 }
 cleanups.push(()=>{contractSpy.mockRestore();snapshotSpy.mockRestore();censusSpy.mockRestore();nativeSpy.mockRestore();currentAuthority.close();completion.close();database.close();rmSync(root,{recursive:true,force:true});});
 return {database,observe};
}

const cases=['root','full-stages','mixed-graph','no-receipt','malformed'] as const;
it.each(cases)('private intent collector is exactly equivalent to the actual owner-authority generic branch: %s',kind=>{
 const f=fixture(),candidate=intentApplicationCandidate(),binding=parseIntentContractEnrollment({subject:candidate.subject,contract:candidate.contract}),root={...intentHostSubjectOwner(binding.subject),profileId:'profile'};
 const members=[null,...binding.contract.stages.map(stage=>stage.stageId)].map(stageId=>({...intentHostSubjectOwner({...binding.subject,stageId}),profileId:root.profileId}));
 const expected=new Set<string>(kind==='no-receipt'?[json(root)]:members.map(json));
 const receipt=f.database.prepare('INSERT INTO owner_enrollment_intent_contracts(logical_owner_key,owner_key,contract_json,registration_json) VALUES(?,?,?,?)');
 const history=f.database.prepare('INSERT INTO verification_application_history(owner_key,revision,binding_hash,binding_json,registration_hash) VALUES(?,?,?,?,?)');
 const addHistory=(owner:VerificationOwner,label:string)=>history.run(json(owner),1,H,json({label}),H);
 if(kind!=='no-receipt')receipt.run('root-logical',json(root),kind==='malformed'?'{':json(binding),'{}');
 if(kind==='root')addHistory(root,'root');
 if(kind==='full-stages')for(const owner of members)addHistory(owner,owner.ownerId);
 if(kind==='mixed-graph'){
  const task={profileId:root.profileId,ownerKind:'task' as const,ownerId:'mixed-task'},goal={profileId:root.profileId,ownerKind:'goal' as const,ownerId:'mixed-goal'};
  f.database.prepare('INSERT INTO verification_owner_dependencies(parent_key,child_key) VALUES(?,?)').run(json(root),json(task));
  f.database.prepare('INSERT INTO verification_owner_dependencies(parent_key,child_key) VALUES(?,?)').run(json(task),json(goal));
  f.database.prepare('INSERT INTO verification_owner_dependencies(parent_key,child_key) VALUES(?,?)').run(json(goal),json(members[0]!));
  addHistory(task,'task');addHistory(goal,'goal');expected.add(json(task));expected.add(json(goal));
 }
 if(kind==='no-receipt'){addHistory(root,'root');addHistory(members.find(owner=>json(owner)!==json(root))!,'unrelated-contract-member');}

 const collector=f.observe('collector',root),generic=f.observe('generic',root);
 expect(generic.native).toEqual(collector.native);
 expect(generic.contractReads).toEqual(collector.contractReads);
 expect(generic.vector).toEqual(collector.vector);
 expect(generic.evidence).toEqual(collector.evidence);
 expect(generic.error).toEqual(collector.error);
 expect(collector.native.length).toBeGreaterThan(0);
 if(kind!=='no-receipt'&&kind!=='malformed')expect(collector.native.filter(event=>event.operation==='prepare'&&typeof event.sql==='string'&&event.sql.startsWith('WITH wanted(lookup) AS ')&&event.sql.includes(' JOIN main.owner_enrollment_intent_contracts AS item '))).toHaveLength(2);
 if(kind==='malformed'){
  expect(collector.contractReads).toEqual(['{']);expect(collector.vector).toBeUndefined();expect(collector.evidence).toBeUndefined();expect(collector.error?.name).toBe('SyntaxError');
 }else{
  expect(collector.error).toBeUndefined();expect(collector.evidence).toBeDefined();expect(collector.contractReads).toHaveLength(kind==='no-receipt'?0:1);
  expect((collector.vector as Array<{key:string}>).map(row=>row.key)).toEqual([...expected].sort());
 }
});
