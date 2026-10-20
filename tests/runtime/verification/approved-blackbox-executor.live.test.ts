import '../../support/installed-controller-docker-fixture.js';
import {it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import type {Database} from 'better-sqlite3';
import type {QuiescenceExpectation} from '../../../src/runtime/isolated-execution/physical-quiescence.js';
import type {IndependentRecipeSpec} from '../../../src/runtime/verification/independent-recipes.js';
import {installedControllerDockerFixture} from '../../support/installed-controller-docker-fixture.js';

const socket=process.env.SOL_PI_DOCKER_PROBE_SOCKET,image=process.env.SOL_PI_DOCKER_PROBE_IMAGE;
it.skipIf(!socket||!image).each([false,true,'archive-failure'])('runs an actual approved blackbox case and archives before post-execution revocation (revoke=%s; dev only)',async(revoke)=>{
 const bytes=Buffer.from('actual binary\0case'),command={argv:['/bin/sh','-c',"cat; sleep 0.03; printf 'effect' > /artifacts/result"],cwdRelative:'.'},invocation={sessionIdentity:'dev',compoundOperationId:randomUUID(),validationInvocationId:randomUUID()};
 const recipe:Extract<IndependentRecipeSpec,{kind:'blackbox'}>={kind:'blackbox',cases:[{id:'original-case',inputBase64:bytes.toString('base64'),expectedOutputBase64:bytes.toString('base64'),sideEffects:[{path:'result',sha256:createHash('sha256').update('effect').digest('hex')}]}]};
 let db:Database,caseExpected:QuiescenceExpectation|undefined,caseOutput:object|undefined;
 const f=await installedControllerDockerFixture({socketPath:socket!,imageId:image!,command,invocation,recipe,
  fault:revoke==='archive-failure'?'archive-failure':revoke?'revoke-after-capture':undefined,
  onCaseAdmission(expected,same){expect(same).toBe(db);expect(db.inTransaction).toBe(true);caseExpected=expected;db.prepare('INSERT INTO case_admission VALUES(?)').run(JSON.stringify(expected));},
  onCaseCapture(result){caseOutput=result.output;db.prepare('INSERT INTO case_capture VALUES(?)').run(JSON.stringify(result.expected));},
 });
 db=f.database;const raw=f.raw;let failure:{error:unknown}|undefined;
 function capturedCase(){if(!caseExpected||!caseOutput)throw Error('missing actual case capture');return {expected:caseExpected,output:caseOutput};}
 try{
  db.exec('CREATE TABLE case_admission(expected_json TEXT);CREATE TABLE case_capture(expected_json TEXT)');
  f.start();const work=f.caseResult('original-case');
  if(revoke==='archive-failure'){
   await expect(work).rejects.toThrow('archive durable capacity rejected');
   expect(db.prepare("SELECT COUNT(*) n FROM verification_blob_reservations WHERE kind IN ('guest-input','guest-output') AND state='reserved'").get()).toEqual({n:2});
   const captured=capturedCase();expect(raw.readCapturedOutput(captured.output,{expected:captured.expected}).stdout).toEqual(bytes);
   expect((await raw.inspectExecutionFacts(captured.expected)).exitCode).toBe(0);return;
  }
  if(revoke){
   await expect(work).rejects.toThrow('actual approval revoked');
   expect(db.prepare('SELECT COUNT(*) n FROM case_capture').get()).toEqual({n:1});
   expect((await raw.inspectExecutionFacts(capturedCase().expected)).exitCode).toBe(0);return;
  }
  const result=await work;expect(result.stdout).toEqual(bytes);expect(result.sideEffects.result.toString()).toBe('effect');expect(result.exitCode).toBe(0);expect(result.outputTruncated).toBe(false);
  expect(db.prepare('SELECT COUNT(*) n FROM case_admission').get()).toEqual({n:1});expect(db.prepare('SELECT COUNT(*) n FROM case_capture').get()).toEqual({n:1});
  await f.finish();await raw.cleanupExecution(capturedCase().expected);await raw.cleanupExecution(result.binding.expected);
 }catch(error){failure={error};throw error;}finally{await f.close(failure);}
},30000);
