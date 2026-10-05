import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {createIndependentVerifierRecipes} from '../../../src/runtime/verification/independent-recipes.js';
const H='a'.repeat(64),sha=(x:Buffer|string)=>createHash('sha256').update(x).digest('hex');
const expected={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v',executionIdentity:'exec',scopeDigest:H};
const binding={attemptId:'attempt',subjectId:'subject',runNonce:'nonce',expected};
it('compares actual artifact bytes, rejects fake plan and never trusts passed JSON',async()=>{
 let bytes=Buffer.from('actual approved content');const recipes=createIndependentVerifierRecipes({assertFailedRunComplete(){throw Error('protected run not configured');},verifierHash:H,assertCurrent:()=>{},quiescence:{assertQuiescent:()=>{}},readArtifact:async()=>bytes,runBlackbox:async()=>{throw Error('unused');},readFailedRun:async()=>{throw Error('unused');}});
 const plan=recipes.compile({kind:'artifact-content',checks:[{id:'content',path:'result.txt',sha256:sha(bytes),structure:'utf8'}]});
 expect(plan.definitionHash).toMatch(/^[a-f0-9]{64}$/);expect((await recipes.evaluate(plan,binding)).checks).toEqual([{id:'content',passed:true}]);
 bytes=Buffer.from('{"passed":true,"exitCode":0}');expect((await recipes.evaluate(plan,binding)).checks[0].passed).toBe(false);
 await expect(recipes.evaluate(JSON.parse(JSON.stringify(plan)),binding)).rejects.toThrow(/recipe_identity/);
});
it('runs all original blackbox cases and independently compares output plus side effect bytes',async()=>{
 const seen:string[]=[],receipts=new WeakSet<object>();
 const recipes=createIndependentVerifierRecipes({assertFailedRunComplete(){throw Error('protected run not configured');},verifierHash:H,assertCurrent:()=>{},quiescence:{assertQuiescent:(receipt:object)=>{if(!receipts.has(receipt))throw Error('receipt');}},readArtifact:async()=>{throw Error('unused');},readFailedRun:async()=>{throw Error('unused');},runBlackbox:async(request:any)=>{
 seen.push(request.caseId);const receipt={} as never;receipts.add(receipt);return {binding:request.binding,caseId:request.caseId,inputHash:sha(request.input),expected:{...expected,validationInvocationId:request.caseInvocationId,executionIdentity:request.caseId},receipt,exitCode:0,outputTruncated:false,stdout:Buffer.from(request.caseId==='one'?'OK':'{"passed":true}'),sideEffects:{'side.txt':Buffer.from('effect')}};
 }});
 const plan=recipes.compile({kind:'blackbox',cases:[{id:'one',inputBase64:Buffer.from('in1').toString('base64'),expectedOutputBase64:Buffer.from('OK').toString('base64'),sideEffects:[{path:'side.txt',sha256:sha('effect')}]},{id:'two',inputBase64:Buffer.from('in2').toString('base64'),expectedOutputBase64:Buffer.from('OK').toString('base64'),sideEffects:[]}]});
 expect((await recipes.evaluate(plan,binding)).checks).toEqual([{id:'one',passed:true},{id:'two',passed:false}]);expect(seen).toEqual(['one','two']);
});
it('requires original failed-run bytes and exact coverage of every middle error record',async()=>{
 const record={kind:'error',index:0,errorId:'E1',message:'real middle error'};
 const lines=[{kind:'header',version:1,runId:'failure-A',runNonce:'n',recordCount:1},record,{kind:'footer',recordCount:1}];
 const bytes=Buffer.from(lines.map(x=>JSON.stringify(x)).join('\n')+'\n');let archive=bytes,exitCode=1;
 const canonicalRecord='{"errorId":"E1","index":0,"kind":"error","message":"real middle error"}';
 let diagnosedErrors=[{errorId:'E1',recordHash:sha(canonicalRecord)}];
 const recipes=createIndependentVerifierRecipes({assertFailedRunComplete(){throw Error('protected run not configured');},verifierHash:H,assertCurrent:()=>{},quiescence:{assertQuiescent:()=>{}},readArtifact:async()=>Buffer.from(JSON.stringify({diagnosedErrors})),runBlackbox:async()=>{throw Error('unused');},readFailedRun:async()=>({bytes:archive,exitCode,expected,receipt:{} as never,sourceRunId:'failure-A',runNonce:'n'})});
 const plan=recipes.compile({kind:'diagnostic-coverage',checkId:'coverage',sourceRunId:'failure-A',runNonce:'n',archiveHash:sha(bytes),diagnosisPath:'diagnosis.json'});
 expect((await recipes.evaluate(plan,binding)).checks[0].passed).toBe(true);
 diagnosedErrors=[];expect((await recipes.evaluate(plan,binding)).checks[0].passed).toBe(false);diagnosedErrors=[{errorId:'E1',recordHash:sha(canonicalRecord)}];
 exitCode=0;expect((await recipes.evaluate(plan,binding)).checks[0].passed).toBe(false);
 exitCode=1;archive=Buffer.from([lines[0],lines[2]].map(x=>JSON.stringify(x)).join('\n')+'\n');expect((await recipes.evaluate(plan,binding)).checks[0].passed).toBe(false);
});
it('rejects a real receipt for a different case invocation instead of counting it as this case',async()=>{
 const recipes=createIndependentVerifierRecipes({assertFailedRunComplete(){throw Error('protected run not configured');},verifierHash:H,assertCurrent:()=>{},quiescence:{assertQuiescent:()=>{}},readArtifact:async()=>{throw Error('unused');},readFailedRun:async()=>{throw Error('unused');},runBlackbox:async(request:any)=>({binding:request.binding,caseId:request.caseId,inputHash:sha(request.input),expected,receipt:{} as never,exitCode:0,outputTruncated:false,stdout:Buffer.from('OK'),sideEffects:{}})});
 const plan=recipes.compile({kind:'blackbox',cases:[{id:'one',inputBase64:'',expectedOutputBase64:Buffer.from('OK').toString('base64'),sideEffects:[]}]});
 await expect(recipes.evaluate(plan,binding)).rejects.toThrow(/case_binding/);
});
it('detaches returned target evidence before a physical-authority callback can change bytes or exit status',async()=>{
 let observed:any;
 const recipes=createIndependentVerifierRecipes({assertFailedRunComplete(){throw Error('protected run not configured');},verifierHash:H,assertCurrent:()=>{},quiescence:{assertQuiescent:()=>{observed.stdout.write('OK');observed.exitCode=0;observed.sideEffects={};}},readArtifact:async()=>{throw Error('unused');},readFailedRun:async()=>{throw Error('unused');},runBlackbox:async(request:any)=>observed={binding:request.binding,caseId:request.caseId,inputHash:sha(request.input),expected:{...expected,validationInvocationId:request.caseInvocationId},receipt:{} as never,exitCode:1,outputTruncated:false,stdout:Buffer.from('NO'),sideEffects:{'unexpected.txt':Buffer.from('bad')}}});
 const plan=recipes.compile({kind:'blackbox',cases:[{id:'one',inputBase64:'',expectedOutputBase64:Buffer.from('OK').toString('base64'),sideEffects:[]}]});
 expect((await recipes.evaluate(plan,binding)).checks).toEqual([{id:'one',passed:false}]);
});
