import {it,expect,vi} from 'vitest';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import * as completionModule from '../../../src/runtime/verification/completion-composition.js';
import * as operationModule from '../../../src/runtime/verification/approved-verification-operation.js';
import * as artifactModule from '../../../src/runtime/verification/approved-artifact-reader.js';
import * as stackModule from '../../../src/runtime/verification/installed-execution-stack.js';
import * as publicModule from '../../../src/runtime/verification/controller-public-daemon.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
import {createInstalledProfileIndexPublisher} from '../../../src/runtime/verification/installed-migration-publisher.js';
import {startInstalledVerificationController} from '../../../src/runtime/verification/installed-controller.js';
const os=vi.hoisted(()=>({lifetime:undefined as any,engine:undefined as any,qualification:undefined as any,broker:undefined as any}));
vi.mock('../../../src/runtime/verification/installed-controller-lifetime.js',()=>({createInstalledControllerLifetime:()=>os.lifetime,assertInstalledControllerLifetime(value:unknown){if(value!==os.lifetime)throw Error('fixture lifetime identity');os.lifetime.assertCurrent();}}));
vi.mock('../../../src/runtime/verification/installed-identity.js',async original=>({...await original<any>(),assertRootProtectedFile(){},assertInstalledControllerIdentity(){}}));
vi.mock('../../../src/runtime/verification/migration-markers.js',async original=>({...await original<any>(),assertServiceProtectedMarkerPath(){}}));
vi.mock('../../../src/runtime/verification/root-broker-client.js',()=>({createInstalledRootBrokerClient:()=>os.broker,assertInstalledRootBrokerClient(value:unknown){if(value!==os.broker)throw Error('fixture broker identity');}}));
vi.mock('../../../src/runtime/verification/installed-engine.js',()=>({initializeInstalledMacEngine:async()=>os.engine,assertInstalledMacEngineHandle(value:unknown){if(value!==os.engine)throw Error('fixture engine identity');},assertInstalledEngineDatabase(value:unknown,db:unknown){if(value!==os.engine||db!==os.lifetime.database)throw Error('fixture engine database');}}));
vi.mock('../../../src/runtime/verification/installed-engine-qualification.js',()=>({createInstalledEngineQualification:()=>os.qualification,assertInstalledEngineQualification(value:unknown,engine:unknown){if(value!==os.qualification||engine!==os.engine)throw Error('fixture qualification');},assertInstalledEngineQualificationIdentity(value:unknown,engine:unknown,db:unknown){if(value!==os.qualification||engine!==os.engine||db!==os.lifetime.database)throw Error('fixture qualification identity');}}));
vi.mock('../../../src/runtime/isolated-execution/docker-engine-transport.js',()=>({DockerEngineTransport:class{async isContainerAbsent(){return true;}async isVolumeAbsent(){return true;}async create(){throw Error('fixture dispatch not enabled');}}}));
// OS lifetime, credential/ACL checks, engine qualification and root broker are
// fixture boundaries. All authority/material/raw/run/budget/operation factories,
// actual controller start and actual Unix listener below remain production code.
it.each(['prepare','rollback'] as const)('starts the actual installed core, publishes the profile and closes: %s',async mode=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'ia-'))),state=join(root,'state');mkdirSync(state);mkdirSync(join(root,'public'));mkdirSync(join(root,'migrations'));
 const database=openPrivateVerificationDatabase(state),keys=generateKeyPairSync('ed25519'),receiver=generateKeyPairSync('ed25519'),hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
 let closed=false;
 const manifest={version:2,authorityId:'authority',publicKeyPem:keys.publicKey.export({format:'pem',type:'spki'}).toString(),packageHash:'a'.repeat(64),serviceUid:502,allowedUserIds:[501]};
 os.lifetime=Object.freeze({base:root,state,release:join(root,'release'),manifest,database,...keys,serviceEpoch:'fixture-boot',peerHelper:'/fixture-peer',assertCurrent(){if(closed||!database.open)throw Error('fixture closed');},close(){database.close();closed=true;}});
 writeFileSync(join(root,'deployment.json'),JSON.stringify(manifest));writeFileSync(join(root,'receiver.json'),JSON.stringify({version:1,receiverId:'receiver',receiverInstanceEpoch:1,keyId:hash(receiver.publicKey.export({format:'der',type:'spki'})),publicKeyPem:receiver.publicKey.export({format:'pem',type:'spki'}).toString(),serviceUid:503}));
 os.engine=Object.freeze({hostSocket:'/fixture-engine.sock',imageDigest:'sha256:'+'a'.repeat(64)});
 os.qualification=Object.freeze({assertCurrent(){os.lifetime.assertCurrent();},async ensureCurrent(){os.lifetime.assertCurrent();},currentFacts(){return {engineBinding:{engineId:'fixture-engine',incarnation:'one'}};},deletionAuthority:{assertDeleted(){throw Error('fixture no deletion');}},close(){}});
 os.broker=Object.freeze({resolvePrincipal(peer:object){return {...peer,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid'};},async authorizeOwnerEnrollment(review:unknown){return {uid:501,auditSessionId:7,reviewHash:hash(json(review).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')))};},async inspectMaterial(){return {sha256:hash('x'),size:1,executable:false};},async authorizeMaterials(input:any){return {uid:input.uid,auditSessionId:input.auditSessionId,reviewHash:hash(json(input.review))};},async readMaterialPage(input:any){return {contentHash:hash('x'),totalBytes:1,offset:input.offset,bytes:Buffer.from('x').toString('base64'),executable:false};},clock(){return {domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:'a'.repeat(64)};},dispose(){}});
 const completion=vi.spyOn(completionModule,'createVerificationCompletionComposition'),operation=vi.spyOn(operationModule,'createApprovedVerificationOperations'),stack=vi.spyOn(stackModule,'createInstalledExecutionStack'),listener=vi.spyOn(publicModule,'startPublicController'),artifact=vi.spyOn(artifactModule,'createApprovedRecipeArtifactReader');
 let actual:Awaited<ReturnType<typeof startInstalledVerificationController>>|undefined;
 try{actual=await startInstalledVerificationController();expect(completion).toHaveBeenCalledOnce();expect(operation).toHaveBeenCalledOnce();expect(stack).toHaveBeenCalledOnce();expect(listener).toHaveBeenCalledOnce();expect(database.open).toBe(true);
  const actualStack=await stack.mock.results[0]!.value,actualArtifact=artifact.mock.results[0]!.value;
  stackModule.assertInstalledExecutionStack(actualStack,os.lifetime);
  artifactModule.assertApprovedRecipeArtifactReader(actualArtifact,actualStack.privateHost.execution.privateHost.raw);
  expect(()=>stackModule.assertInstalledExecutionStack({...actualStack},os.lifetime)).toThrow();
  expect(()=>stackModule.assertInstalledExecutionStack(actualStack,{} as never)).toThrow();
  expect(()=>artifactModule.assertApprovedRecipeArtifactReader({...actualArtifact},actualStack.privateHost.execution.privateHost.raw)).toThrow();
  expect(()=>artifactModule.assertApprovedRecipeArtifactReader(actualArtifact,{})).toThrow();
  expect(()=>createInstalledProfileIndexPublisher({lifetime:{...os.lifetime}})).toThrow('fixture lifetime identity');
  expect(()=>createInstalledProfileIndexPublisher({lifetime:{} as never})).toThrow('fixture lifetime identity');
  const invoke=listener.mock.calls[0]![0].invoke,peer={uid:501,gid:20,auditSessionId:7},signal=new AbortController().signal,invocation={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},recipe={kind:'artifact-content',checks:[{id:'content',path:'result',sha256:hash('result'),structure:'bytes'}]},obligation={obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',definitionHash:hash(json(recipe)),requiredCheckIds:['content']};
  const enrollment=await invoke('completion.prepare-owner',{enrollment:{ownerKind:'task',ownerId:'task',invocations:[invocation]},registration:{migrationEpoch:1,obligations:[{obligation,recipe}],source:{kind:'new-owner'}}},peer,signal) as any;
  const owner=await invoke('completion.authorize-owner',{challengeId:enrollment.challengeId},peer,signal) as any;
  const publisher=createInstalledProfileIndexPublisher({lifetime:os.lifetime});const index=JSON.parse(readFileSync(join(root,'migrations','principals','501.json'),'utf8'));expect(index.profileId).toBe(owner.owner.profileId);publisher.assertPublished(index);
  const challenge=await invoke('materials.prepare',{purpose:'isolated-command',invocation,materials:[{path:'/workspace/a',byteLimit:1}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:Date.now()+5000},peer,signal) as any;
  const grant=await invoke('materials.authorize',{challengeId:challenge.challengeId},peer,signal),staged=await invoke('materials.stage',{grantHandle:grant,invocation},peer,signal) as any;
  const baseline=database.prepare('SELECT * FROM verification_blob_reservations ORDER BY resource_id').all();
  if(mode==='rollback')database.exec("CREATE TRIGGER assembly_operation_failure BEFORE INSERT ON verification_operations BEGIN SELECT RAISE(ABORT,'assembly operation failure'); END");
  const work=invoke('verification.prepare',{mountPlanHandle:staged.mountPlanHandle,obligationId:'original',expectedAttemptEpoch:0,requestSource:'agent'},peer,signal);
  if(mode==='rollback'){
   await expect(work).rejects.toThrow('assembly operation failure');
   for(const table of ['verification_operations','obligation_attempts','execution_attempts','verification_subjects','verification_protected_runs','verification_run_producers'])expect(database.prepare('SELECT COUNT(*) n FROM '+table).get()).toEqual({n:0});
   expect(database.prepare('SELECT * FROM verification_blob_reservations ORDER BY resource_id').all()).toEqual(baseline);
  }else{const prepared=await work as any;expect(prepared.operationHandle).toBeDefined();expect(database.prepare('SELECT COUNT(*) n FROM execution_attempts').get()).toEqual({n:1});}
  expect(database.inTransaction).toBe(false);
  await actual.close();expect(closed).toBe(true);expect(()=>stackModule.assertInstalledExecutionStack(actualStack,os.lifetime)).toThrow();expect(()=>artifactModule.assertApprovedRecipeArtifactReader(actualArtifact,actualStack.privateHost.execution.privateHost.raw)).toThrow('recipe_artifact_closed');expect(()=>createInstalledProfileIndexPublisher({lifetime:os.lifetime})).toThrow('fixture closed');}
 finally{vi.restoreAllMocks();if(actual&&!closed)await actual.close();if(database.open)database.close();rmSync(root,{recursive:true,force:true});}
});
