import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {createIndependentVerifierRecipes} from '../../../src/runtime/verification/independent-recipes.js';
import {canonicalVerificationJson} from '../../../src/runtime/verification/protocol.js';
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const H='a'.repeat(64),expected={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v',executionIdentity:'e',scopeDigest:H};
it.each(['valid','wrong-scope','copied-receipt','extra-expected','revoked-during-read','legacy-source'] as const)('keeps original protected run receipt distinct from a child receipt: %s',async mode=>{
 const record={kind:'error',index:0,errorId:'original-error',message:'actual failed producer'},archive=Buffer.from([JSON.stringify({kind:'header',version:1,runId:'run',runNonce:'nonce',recordCount:1}),JSON.stringify(record),JSON.stringify({kind:'footer',recordCount:1})].join('\n')+'\n');
 const receipt=Object.freeze({});let live=true,checks=0,physicalChecks=0,reads=0;
 const spec={kind:'diagnostic-coverage' as const,checkId:'full',sourceRunId:'run',runNonce:'nonce',archiveHash:sha(archive),diagnosisPath:'diagnosis.json',...(mode==='legacy-source'?{}:{sourceScope:'whole-task' as const})};
 const recipes=createIndependentVerifierRecipes({verifierHash:H,assertCurrent(){},quiescence:{assertQuiescent(){physicalChecks++;throw Error('child receipt cannot prove run');}},assertFailedRunComplete(actual:any,binding:any){checks++;if(actual!==receipt||!live)throw Error('run receipt');expect(binding).toEqual({sourceRunId:'run',runNonce:'nonce',archiveHash:sha(archive),scope:'whole-task'});},async readFailedRun(request:any){expect(request.sourceScope).toBe(spec.sourceScope);return {scope:mode==='wrong-scope'?'protected-execution-run':'whole-task',bytes:archive,exitCode:1,receipt:mode==='copied-receipt'?{}:receipt,sourceRunId:'run',runNonce:'nonce',...(mode==='extra-expected'?{expected}:{})} as any;},async runBlackbox(){throw Error('unused');},async readArtifact(){reads++;if(mode==='revoked-during-read')live=false;return Buffer.from(JSON.stringify({diagnosedErrors:[{errorId:record.errorId,recordHash:sha(canonicalVerificationJson(record))}]}));}});
 const plan=recipes.compile(spec),work=recipes.evaluate(plan,{attemptId:'attempt',subjectId:'subject',runNonce:'candidate',expected});
 if(mode==='valid'){expect((await work).checks).toEqual([{id:'full',passed:true}]);expect(checks).toBeGreaterThanOrEqual(2);}else await expect(work).rejects.toThrow();
 expect(physicalChecks).toBe(0);if(['wrong-scope','copied-receipt','extra-expected','legacy-source'].includes(mode))expect(reads).toBe(0);
});
