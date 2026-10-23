import {it,expect} from 'vitest';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createIndependentVerifierRecipes} from '../../../src/runtime/verification/independent-recipes.js';
import {createVerificationAuthority} from '../../../src/runtime/verification/proof-authority.js';
import {createVerifiedPublicationPayloads} from '../../../src/runtime/verification/verified-publication-payload.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
const H='a'.repeat(64),sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const expected={sessionIdentity:'session',compoundOperationId:'operation',validationInvocationId:'verify',executionIdentity:'execution',scopeDigest:H};
function source(name:string){const record={kind:'error',index:0,errorId:'E1',message:`original failure ${name}`};const archive=Buffer.from([{kind:'header',version:1,runId:name,runNonce:`nonce-${name}`,recordCount:1},record,{kind:'footer',recordCount:1}].map(x=>JSON.stringify(x)).join('\n')+'\n');return {spec:{checkId:name,sourceRunId:name,runNonce:`nonce-${name}`,archiveHash:sha(archive),diagnosisPath:`${name}.json`},archive,diagnosis:Buffer.from(JSON.stringify({diagnosedErrors:[{errorId:'E1',recordHash:sha(json(record))}]}))};}
it('revalidates the full original A+B obligation, never publishes B alone, and preserves old failed attempts',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cumulative-')),database=openPrivateVerificationDatabase(root),keys=generateKeyPairSync('ed25519'),receipt=Object.freeze({}) as never;
 const sources=[source('A'),source('B')],seen:string[]=[];let omitA=false;
 const recipes=createIndependentVerifierRecipes({assertFailedRunComplete(){throw Error('protected run not configured');},verifierHash:H,assertCurrent:()=>{},quiescence:{assertQuiescent:r=>{if(r!==receipt)throw Error('physical');}},runBlackbox:async()=>{throw Error('unused');},readArtifact:async(_binding,path)=>omitA&&path==='A.json'?Buffer.from('{"diagnosedErrors":[]}'):sources.find(s=>s.spec.diagnosisPath===path)!.diagnosis,readFailedRun:async request=>{seen.push(request.sourceRunId);const s=sources.find(s=>s.spec.sourceRunId===request.sourceRunId)!;return {bytes:s.archive,exitCode:1,expected,receipt,sourceRunId:s.spec.sourceRunId,runNonce:s.spec.runNonce};}});
 const authority=createVerificationAuthority({root,database,receiverVerifier:createReceiverReplyVerifier({keyId:'receiver',receiverId:'receiver',receiverInstanceEpoch:1,publicKey:keys.publicKey}),verifierHash:H,issuerId:'issuer',keyId:'key',serviceEpoch:'boot',privateKey:keys.privateKey,clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:H}),assertQualified:()=>{},quiescence:{assertQuiescent:r=>{if(r!==receipt)throw Error('physical');}}});
 const owner={profileId:'profile',ownerKind:'task' as const,ownerId:'task'},issue=(method:string,payload:unknown)=>({requestSource:'user' as const,authorization:authority.host.issueAuthorization({owner,method,payload,requestSource:'user',principalId:'user',expiresAt:2000})});
 try{
  const plan=recipes.compile({kind:'diagnostic-coverage',sources:sources.map(s=>s.spec)});
  const registration={owner,migrationEpoch:1,obligations:[{obligationId:'cumulative',predicateId:'diagnostic',predicateVersion:'1',semantics:'cumulative' as const,definitionHash:plan.definitionHash,requiredCheckIds:plan.requiredCheckIds}]};authority.service.registerObligations(registration,issue('registerObligations',registration));
  const subject=authority.host.registerSubject({owner,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:2000,manifest:sources.map(s=>({path:s.spec.diagnosisPath,sha256:sha(s.diagnosis),size:s.diagnosis.length,role:'source'}))});
  const proposal={owner,obligationId:'cumulative',expectedAttemptEpoch:0,sourceRunId:'original-A-plus-B',runNonce:'original-set',...subject,requiredScopeId:'scope',scopeRevision:1};const first=authority.service.requestVerification(proposal,issue('requestVerification',proposal));authority.host.bindExecution(first.attemptId,expected);
  omitA=true;const failed=await recipes.evaluate(plan,{attemptId:first.attemptId,subjectId:subject.subjectId,runNonce:proposal.runNonce,expected});expect(failed.checks).toEqual([{id:'A',passed:false},{id:'B',passed:true}]);expect(()=>recipes.exportVerifiedArtifacts(failed)).toThrow(/failed/);
  authority.host.recordControllerResult(first.attemptId,{coreId:'first',coreFinalRevision:1,exitCode:1,quiescent:true,outputHashes:[]},{...failed,validUntil:1500},receipt);
  const replacement={...proposal,expectedAttemptEpoch:1,sourceRunId:'B-only'};expect(()=>authority.service.requestVerification(replacement,issue('requestVerification',replacement))).toThrow(/original_run/);
  const retry={...proposal,expectedAttemptEpoch:1},second=authority.service.requestVerification(retry,issue('requestVerification',retry));expect(second.attemptEpoch).toBe(2);expect(authority.service.inspectOwner(owner)?.currentVerification).toBe('needs_revalidation');
  const nextExpected={...expected,executionIdentity:'retry-execution'};authority.host.bindExecution(second.attemptId,nextExpected);const binding={attemptId:second.attemptId,subjectId:subject.subjectId,runNonce:proposal.runNonce,expected:nextExpected};omitA=false;
  const passed=await recipes.evaluate(plan,binding);expect(passed.checks.every(c=>c.passed)).toBe(true);expect(seen).toEqual(['A','B','A','B']);authority.host.recordControllerResult(second.attemptId,{coreId:'second',coreFinalRevision:1,exitCode:0,quiescent:true,outputHashes:[]},{...passed,validUntil:1500},receipt);
  const payloads=createVerifiedPublicationPayloads({database,recipes,getCurrentDependencies:authority.service.getCurrentDependencies,assertCurrent:()=>{}});
  const bOnly=recipes.compile({kind:'diagnostic-coverage',...sources[1].spec});const bPass=await recipes.evaluate(bOnly,binding);expect(bPass.checks[0].passed).toBe(true);expect(()=>payloads.stage({owner,evaluations:[bPass]})).toThrow();
  const full=payloads.stage({owner,evaluations:[passed]});expect(full.immutablePayloadHash).toMatch(/^[a-f0-9]{64}$/);expect(recipes.exportVerifiedArtifacts(passed).artifacts.map(a=>a.path)).toEqual(['A.json','B.json']);
  expect(database.prepare('SELECT COUNT(*) AS n FROM obligation_attempts').get()).toEqual({n:2});
 }finally{authority.service.close();database.close();rmSync(root,{recursive:true,force:true});}
});
it('rejects an ambiguous or weakened multi-source declaration before any source IO',()=>{
 const recipes=createIndependentVerifierRecipes({assertFailedRunComplete(){throw Error('protected run not configured');},verifierHash:H,assertCurrent:()=>{},quiescence:{assertQuiescent:()=>{}},readArtifact:async()=>{throw Error('must not read');},runBlackbox:async()=>{throw Error('must not execute');},readFailedRun:async()=>{throw Error('must not read');}}),a=source('A').spec,b=source('B').spec;
 expect(()=>recipes.compile({kind:'diagnostic-coverage',sources:[a]})).toThrow();
 for(const changed of [{...b,checkId:a.checkId},{...b,sourceRunId:a.sourceRunId,runNonce:a.runNonce},{...b,diagnosisPath:'a.JSON'}])expect(()=>recipes.compile({kind:'diagnostic-coverage',sources:[a,changed]})).toThrow();
 expect(()=>recipes.compile({kind:'diagnostic-coverage',sources:[a,b],...a} as never)).toThrow();
});
it('caps each original source read by the remaining aggregate budget before decoding or retaining it',async()=>{
 const large=Buffer.alloc(16*1024**2,32),requests:number[]=[];
 const recipes=createIndependentVerifierRecipes({assertFailedRunComplete(){throw Error('protected run not configured');},verifierHash:H,assertCurrent:()=>{},quiescence:{assertQuiescent:()=>{}},runBlackbox:async()=>{throw Error('unused');},readArtifact:async()=>Buffer.from('{}'),readFailedRun:async request=>{requests.push(request.maxBytes!);return {bytes:large,exitCode:1,expected,receipt:{} as never,sourceRunId:request.sourceRunId,runNonce:request.runNonce};}});
 const plan=recipes.compile({kind:'diagnostic-coverage',sources:Array.from({length:18},(_,i)=>({checkId:`c${i}`,sourceRunId:`run${i}`,runNonce:`nonce${i}`,archiveHash:H,diagnosisPath:`d${i}.json`}))});
 await expect(recipes.evaluate(plan,{attemptId:'attempt',subjectId:'subject',runNonce:'original',expected})).rejects.toThrow(/total_limit/);
 expect(requests).toHaveLength(16);expect(requests[0]).toBe(16*1024**2);expect(requests.at(-1)).toBe(16*1024**2-30);
},10000);
