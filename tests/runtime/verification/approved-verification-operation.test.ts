import '../../support/installed-controller-fixture.js';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import * as installedPorts from '../../../src/runtime/verification/installed-controller.js';
import {createApprovedProtectedSourceReader} from '../../../src/runtime/verification/approved-protected-source-reader.js';
import {createExecutionTranscriptStore} from '../../../src/runtime/verification/execution-transcripts.js';
import {it,expect,vi} from 'vitest';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createVerificationCompletionComposition} from '../../../src/runtime/verification/completion-composition.js';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createProfileIndexPublisher} from '../../../src/runtime/verification/profile-index-publication.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
const H='a'.repeat(64),peer={uid:501,gid:20,auditSessionId:7},hash=(text:string)=>createHash('sha256').update(text).digest('hex');
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'completion-composition-')),database=openPrivateVerificationDatabase(root),keys=generateKeyPairSync('ed25519'),markers=join(root,'markers');mkdirSync(markers,{mode:0o755});
 const clock=()=>({domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:H});
 const composition=createVerificationCompletionComposition({root,database,authorityId:'authority',authority:{receiverVerifier:createReceiverReplyVerifier({keyId:'receiver',receiverId:'receiver',receiverInstanceEpoch:1,publicKey:keys.publicKey}),issuerId:'authority',verifierHash:H,keyId:'key',serviceEpoch:'boot',privateKey:keys.privateKey,clock,assertQualified(){},quiescence:{assertQuiescent(){}}},enrollment:{resolvePrincipal:(p:typeof peer)=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const}),approve:async(review:any)=>({uid:peer.uid,auditSessionId:peer.auditSessionId,reviewHash:hash(json(review).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')))}),profilePublication:createProfileIndexPublisher({root:markers,database,authorityId:'authority',assertCurrent(){}})},recipePorts:{assertFailedRunComplete(){throw Error('protected run not configured');},assertCurrent(){},async readArtifact(){return Buffer.from('result');},async runBlackbox(){throw Error('unused');},async readFailedRun(){throw Error('unused');}}});
 return{root,clock,composition,database,close(){composition.close();database.close();rmSync(root,{recursive:true,force:true});}};
}

import {createApprovedVerificationOperations} from '../../../src/runtime/verification/approved-verification-operation.js';
import {createControllerMaterialPipeline} from '../../../src/runtime/verification/material-pipeline.js';
import {buildInputFileArchive} from '../../../src/runtime/isolated-execution/input-tar.js';
import {createDockerRunner} from '../../../src/runtime/isolated-execution/docker-runner.js';
import {createVerificationBlobBudget} from '../../../src/runtime/verification/blob-budget.js';
import {createApprovedSourceCapabilities} from '../../../src/runtime/verification/approved-source-capabilities.js';
import {createProtectedRunLedger} from '../../../src/runtime/verification/protected-run-ledger.js';
const invocation={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'};
it.each(['prepared','close-prepared','rollback','consumed-on-error','deadline','wrong-peer','recipe-reentry','close-during-prepare','dispatch','archive-failure','revoked-result','repeat-dispatch','incomplete-output','pre-dispatch-failure','restart','revoked-after-pass','cross-db-raw','cross-db-completion','cross-db-material','forged-raw','forged-completion','forged-material','forged-source','image-mismatch','verifier-mismatch'] as const)('assembles actual enrollment/subject/attempt/raw reserve with one material handle: %s',async mode=>{
 let operations:ReturnType<typeof createApprovedVerificationOperations>|undefined,qualifiedHook:(()=>void|Promise<void>)|undefined;
 const f=await installedControllerFixture({incompleteOutput:mode==='incomplete-output',onQualified:()=>qualifiedHook?.()}),other=await installedControllerFixture(),command={argv:['/bin/true'],cwdRelative:'.'};
 const material=f.material,raw=f.raw,runs=f.runs,budget=f.stack.privateHost.budget,capabilities=f.operationInput.capabilities,quiescence=f.stack.privateHost.execution.privateHost.quiescence,containers=f.containers,volumes=f.volumes;
 let archived=0,qualificationCalls=0,serial=0;
 const originalArchive=installedPorts.recordInstalledVerificationResult;
 const archiveSpy=vi.spyOn(installedPorts,'recordInstalledVerificationResult').mockImplementation((...args)=>{archived++;if(mode==='archive-failure')throw Error('archive unavailable');const result=originalArchive(...args);if(mode==='revoked-result')material.revoke((f.database.prepare('SELECT id FROM material_authority_challenges LIMIT 1').get() as {id:string}).id,peer);return result;});

 try{
  const recipe={kind:'artifact-content',checks:[{id:'content',path:'result',sha256:hash('result'),structure:'bytes'}]},obligation={obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',definitionHash:hash(json(recipe)),requiredCheckIds:['content']};
  const enrollment=await f.composition.public.invoke('completion.prepare-owner',{enrollment:{ownerKind:'task',ownerId:'task',invocations:[invocation]},registration:{migrationEpoch:1,obligations:[{obligation,recipe}],source:{kind:'new-owner'}}},peer) as any;
  const {owner}=await f.composition.public.invoke('completion.authorize-owner',{challengeId:enrollment.challengeId},peer) as any;
  const challenge=await material.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/a',byteLimit:1}],exactCommand:command,expiresAt:105000},peer,new AbortController().signal),grant=await material.authorize(challenge.challengeId,peer,new AbortController().signal),staged=await material.stage({grantHandle:grant,invocation},peer,new AbortController().signal);
  let resume!:()=>void;const hold=new Promise<void>(resolve=>{resume=resolve;});let reentered:Promise<unknown>|undefined;
  qualifiedHook=()=>{qualificationCalls++;if(mode==='pre-dispatch-failure'&&qualificationCalls===2)throw Error('qualification unavailable');if(mode==='consumed-on-error')throw Error('qualification unavailable');if(mode==='recipe-reentry')reentered=operations!.prepare(request,peer,new AbortController().signal);if(mode==='close-during-prepare')return hold;};
  if(mode==='deadline')f.setTime(7000);
  const original=f.operationInput;
  const options={...original,sourceReader:mode==='forged-source'?{...original.sourceReader}:original.sourceReader,completion:mode==='cross-db-completion'?other.composition.privateHost:mode==='forged-completion'?{...original.completion}:original.completion,materials:mode==='cross-db-material'?other.material:mode==='forged-material'?{...material}:material,raw:mode==='cross-db-raw'?other.raw:mode==='forged-raw'?{...raw}:raw,imageId:'sha256:'+(mode==='image-mismatch'?'b'.repeat(64):H),verifierHash:mode==='verifier-mismatch'?'b'.repeat(64):H};
  if(mode.startsWith('cross-db-')||mode.startsWith('forged-')||mode.endsWith('-mismatch')){
   const before=f.database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
   expect(()=>createApprovedVerificationOperations(options)).toThrow(/database|image|verifier|protected_source_reader_brand|installed_assembly_binding/);
   expect(f.database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).toEqual(before);
   expect(qualificationCalls).toBe(0);expect(serial).toBe(0);
   expect(()=>material.consumeMountPlan(staged.mountPlanHandle,peer)).not.toThrow();
   return;
  }
  const blobBaseline=f.database.prepare('SELECT * FROM verification_blob_reservations ORDER BY resource_id').all();
  operations=f.operations;const request={mountPlanHandle:staged.mountPlanHandle,obligationId:'original',expectedAttemptEpoch:0,requestSource:'agent'};
  if(mode==='rollback')f.database.exec("CREATE TRIGGER operation_failure BEFORE INSERT ON verification_operations BEGIN SELECT RAISE(FAIL,'operation disk failure'); END");
  const work=operations.prepare(request,mode==='wrong-peer'?{...peer,uid:502}:peer,new AbortController().signal);
  if(mode==='close-during-prepare'){const closing=operations.close();resume();await expect(work).rejects.toThrow();await closing;}
  else if(['rollback','consumed-on-error','deadline','wrong-peer'].includes(mode))await expect(work).rejects.toThrow();
  else{
   const result=await work;expect(f.database.prepare('SELECT count(*) n FROM verification_run_executions').get()).toEqual({n:1});expect(result).toHaveProperty('sourceRunId');expect(result.attemptEpoch).toBe(1);expect(f.database.prepare('SELECT state FROM verification_operations').get()).toEqual({state:'prepared'});expect(f.database.prepare('SELECT state FROM obligation_attempts').get()).toEqual({state:'running'});expect(f.database.prepare('SELECT state FROM execution_attempts').get()).toEqual({state:'prepared'});
   const admitted=JSON.parse((f.database.prepare('SELECT record_json FROM verification_operations').get() as {record_json:string}).record_json).binding;expect(()=>operations!.getOriginalPlan(admitted)).toThrow('not_dispatching');expect(()=>operations!.signalForBinding(admitted)).toThrow('not_dispatching');
   if(mode==='close-prepared'){const first=operations.close();expect(operations.close()).toBe(first);await first;expect(raw.readExecution(admitted.expected)).toMatchObject({state:'terminal',cancelledBeforeStart:true});expect(containers.size).toBe(0);expect(volumes.size).toBe(0);expect(f.database.prepare('SELECT state FROM verification_protected_runs').get()).toEqual({state:'sealed'});expect(JSON.parse((f.database.prepare('SELECT observation_json FROM verification_run_executions').get() as {observation_json:string}).observation_json)).toMatchObject({cancelledBeforeStart:true,exitCode:null});return;}
   const subject=f.database.prepare('SELECT manifest_json FROM verification_subjects').get() as any;expect(JSON.parse(subject.manifest_json)[0]).toMatchObject({path:'__xiaok_verification_runtime__.json',role:'runtime-contract'});
   expect(f.composition.privateHost.authorityService.inspectOwner(owner)?.currentVerification).toBe('needs_revalidation');
   if(['dispatch','archive-failure','revoked-result','repeat-dispatch','incomplete-output','pre-dispatch-failure','restart','revoked-after-pass'].includes(mode)){
    const dispatch=()=>operations!.dispatch({operationHandle:result.operationHandle},peer,new AbortController().signal);
    if(mode==='restart'){await operations.close();operations=createApprovedVerificationOperations(options);await expect(dispatch()).rejects.toThrow('unknown');expect(archived).toBe(0);}
    else if(mode==='archive-failure'||mode==='revoked-result'||mode==='pre-dispatch-failure'){await expect(dispatch()).rejects.toThrow();expect(f.composition.privateHost.authorityService.inspectOwner(owner)?.currentVerification).not.toBe('valid');expect(f.database.prepare('SELECT core_json FROM obligation_attempts').get()).toMatchObject({core_json:expect.any(String)});}
    else if(mode==='incomplete-output'){expect((await dispatch()).currentVerification).not.toBe('valid');expect(()=>operations!.stageVerifiedPayload(owner)).toThrow();}
    else{const completed=await dispatch();expect(completed.currentVerification).toBe('valid');expect(completed.sourceRun).toMatchObject({sourceRunId:result.sourceRunId,runNonce:result.runNonce,scope:'protected-execution-run'});expect(f.database.prepare('SELECT state FROM verification_protected_runs').get()).toEqual({state:'complete'});expect(containers.size).toBe(0);expect(volumes.size).toBe(0);expect(()=>operations!.getOriginalPlan(admitted)).toThrow('not_dispatching');const staged=operations.stageVerifiedPayload(owner);expect(staged).toHaveProperty('immutablePayloadHash');if(mode==='revoked-after-pass'){material.revoke(challenge.challengeId,peer);expect(f.composition.privateHost.authorityService.inspectOwner(owner)?.currentVerification).not.toBe('valid');expect(()=>operations!.stageVerifiedPayload(owner)).toThrow();}}
    if(mode==='archive-failure'){expect(containers.size).toBe(0);expect(volumes.size).toBe(0);}
    if(mode==='archive-failure'||mode==='dispatch'){
     const sourceReader=createApprovedProtectedSourceReader({database:f.database,completion:f.composition.privateHost,capabilities,runs});
     try{const d=runs.describeArchive(result.sourceRunId),descriptor={kind:'protected-run' as const,sourceRunId:d.sourceRunId,runNonce:d.runNonce,rootInvocation:d.rootInvocation,state:d.state as 'sealed'|'complete',archiveHash:d.archiveHash,archiveBytes:d.archiveBytes,memberCount:d.memberCount,censusHash:d.censusHash};expect(()=>f.composition.privateHost.assertSourceDeletionUnreferenced(owner,descriptor)).toThrow(mode==='archive-failure'?'source_operation_recovery_reference':'verification_source_attempt_active');}
     finally{sourceReader.close();}
    }

    const expectedArchives=['pre-dispatch-failure','restart'].includes(mode)?0:1;expect(archived).toBe(expectedArchives);await expect(dispatch()).rejects.toThrow('unknown');expect(archived).toBe(expectedArchives);
   }
  }
  if(reentered)await expect(reentered).rejects.toThrow('reentrant');
  if(mode==='rollback')for(const table of ['verification_operations','obligation_attempts','execution_attempts','verification_subjects','verification_protected_runs','verification_run_producers'])expect(f.database.prepare('SELECT COUNT(*) n FROM '+table).get()).toEqual({n:0});
  if(mode==='rollback')expect(f.database.prepare('SELECT * FROM verification_blob_reservations ORDER BY resource_id').all()).toEqual(blobBaseline);
  if(mode!=='wrong-peer')expect(()=>material.consumeMountPlan(staged.mountPlanHandle,peer)).toThrow();
 }finally{qualifiedHook=undefined;archiveSpy.mockRestore();await operations?.close();await f.close();await other.close();}
});
