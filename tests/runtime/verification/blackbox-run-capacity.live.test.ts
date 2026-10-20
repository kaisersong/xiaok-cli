import '../../support/installed-controller-docker-fixture.js';
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Database} from 'better-sqlite3';
import type {QuiescenceExpectation} from '../../../src/runtime/isolated-execution/physical-quiescence.js';
import type {IndependentRecipeSpec} from '../../../src/runtime/verification/independent-recipes.js';
import {installedControllerDockerFixture} from '../../support/installed-controller-docker-fixture.js';

const socket=process.env.SOL_PI_DOCKER_PROBE_SOCKET,image=process.env.SOL_PI_DOCKER_PROBE_IMAGE;
it.skipIf(!socket||!image)('rejects fourth large original case before dispatch and completes the existing actual producer census (dev Docker)',async()=>{
 const command={argv:['/bin/sh','-c','if read -r line; then head -c 3670016 /dev/zero; fi'],cwdRelative:'.'},invocation={sessionIdentity:'dev',compoundOperationId:randomUUID(),validationInvocationId:randomUUID()},bytes=Buffer.from('run\n');
 const recipe:Extract<IndependentRecipeSpec,{kind:'blackbox'}>={kind:'blackbox',cases:[0,1,2,3].map(i=>({id:'case-'+i,inputBase64:bytes.toString('base64'),expectedOutputBase64:'',sideEffects:[]}))};
 const registered:QuiescenceExpectation[]=[];let db:Database;
 const f=await installedControllerDockerFixture({socketPath:socket!,imageId:image!,command,invocation,recipe,
  onCaseAdmission(expected,same){expect(same).toBe(db);registered.push(expected);},
 });
 db=f.database;const runs=f.runs;let failure:{error:unknown}|undefined;
 try{
  // Reserve through the actual startup metadata owner before large captures.
  f.reserveControllerMetadata(32*1024**2);
  f.start();
  for(let i=0;i<3;i++){const result=await f.caseResult('case-'+i);expect(result.stdout.length).toBe(3670016);expect(result.outputTruncated).toBe(false);}
  await expect(f.caseResult('case-3')).rejects.toThrow('protected_run_archive_limit');
  expect(registered.length).toBe(3);expect(db.prepare('SELECT COUNT(*) n FROM verification_run_executions WHERE observation_json IS NULL').get()).toEqual({n:0});
  expect(db.prepare("SELECT COUNT(*) n FROM verification_blob_reservations WHERE kind IN ('guest-input','guest-output') AND state='reserved'").get()).toEqual({n:2});
  // Actual operation finally ends and seals its original producer; no test-issued capability.
  await expect(f.finish()).rejects.toThrow('protected_run_archive_limit');
  const complete=await runs.complete(f.prepared.sourceRunId);expect(complete.archiveBytes).toBeLessThan(16*1024**2);runs.assertComplete(complete.receipt,complete);
 }catch(error){failure={error};throw error;}finally{await f.close(failure);}
},60000);
