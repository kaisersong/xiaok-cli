import * as sharedCapacityModule from '../../src/runtime/verification/installed-shared-capacity.js';
import * as metadataSourceModule from '../../src/runtime/verification/installed-metadata-source.js';
import {reserveOriginalFixtureControllerMetadata} from './original-fixture-controller-metadata.js';
import {vi} from 'vitest';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createHash,generateKeyPairSync,createPrivateKey,createPublicKey,randomUUID,type KeyObject} from 'node:crypto';
import {openPrivateVerificationDatabase} from '../../src/runtime/verification/private-database.js';
import {canonicalVerificationJson as json} from '../../src/runtime/verification/protocol.js';
import {buildInputFileArchive} from '../../src/runtime/isolated-execution/input-tar.js';
import * as completionModule from '../../src/runtime/verification/completion-composition.js';
import * as operationModule from '../../src/runtime/verification/approved-verification-operation.js';
import * as stackModule from '../../src/runtime/verification/installed-execution-stack.js';
import * as artifactModule from '../../src/runtime/verification/approved-artifact-reader.js';
import * as publicModule from '../../src/runtime/verification/controller-public-daemon.js';
import {startInstalledVerificationController} from '../../src/runtime/verification/installed-controller.js';
import * as installedControllerModule from '../../src/runtime/verification/installed-controller.js';
import type {BlackboxObservation,RecipeBinding} from '../../src/runtime/verification/independent-recipes.js';
type BlackboxRequest={binding:RecipeBinding;caseId:string;caseInvocationId:string;input:Buffer};
function returned<T>(result:{type:'return';value:T}|{type:'throw'|'incomplete';value:unknown}|undefined):NonNullable<T>{
 if(result?.type==='throw')throw result.value;
 if(!result||result.type!=='return'||result.value===null||result.value===undefined)throw Error('fixture_constructor_observation');
 return result.value;
}
const boundary=vi.hoisted(()=>({next:undefined as any,lifetimes:new WeakSet<object>(),engines:new WeakMap<object,any>(),qualifications:new WeakMap<object,any>(),brokers:new WeakMap<object,any>(),transports:new Map<string,any>()}));
// Unknown fresh-start drains retain their actual owner and physical root.
const retainedFreshStarts=new Set<object>();
vi.mock('../../src/runtime/verification/installed-controller-lifetime.js',()=>({createInstalledControllerLifetime:()=>boundary.next.lifetime,assertInstalledControllerLifetime(value:any){if(!boundary.lifetimes.has(value))throw Error('fixture lifetime identity');value.assertCurrent();}}));
vi.mock('../../src/runtime/verification/installed-identity.js',async original=>{const actual=await original<any>();return {...actual,assertRootProtectedFile(){},assertRootProtectedExecutable(path:string){if(boundary.next?.logicalOS)return boundary.next.logicalOS.assertExecutable(path);return actual.assertRootProtectedExecutable(path);},assertInstalledControllerIdentity(){}};});
vi.mock('../../src/runtime/verification/migration-markers.js',async original=>({...await original<any>(),assertServiceProtectedMarkerPath(){}}));
vi.mock('../../src/runtime/verification/root-broker-client.js',()=>({createInstalledRootBrokerClient:()=>boundary.next.broker,assertInstalledRootBrokerClient(value:object,lifetime:object){if(boundary.brokers.get(value)!==lifetime)throw Error('fixture broker identity');}}));
vi.mock('../../src/runtime/verification/installed-engine.js',()=>({initializeInstalledMacEngine:async()=>boundary.next.engine,assertInstalledMacEngineHandle(value:object){const f=boundary.engines.get(value);if(!f)throw Error('fixture engine identity');f.current();},assertInstalledEngineDatabase(value:object,db:object){const f=boundary.engines.get(value);if(!f||f.database!==db)throw Error('fixture engine database');f.current();}}));
// This legacy fake qualification never issues a probe cleanup command. Reject
// every candidate; the separate real-probe fixture uses the actual inspector.
vi.mock('../../src/runtime/verification/installed-engine-qualification.js',()=>({inspectQualificationCleanupHandoffCommand(){return undefined;},createInstalledEngineQualification:()=>boundary.next.qualification,assertInstalledEngineQualification(value:object,engine:object){const f=boundary.qualifications.get(value);if(!f||f.engine!==engine)throw Error('fixture qualification');f.current();},assertInstalledEngineQualificationIdentity(value:object,engine:object,db:object){const f=boundary.qualifications.get(value);if(!f||f.engine!==engine||f.database!==db)throw Error('fixture qualification identity');f.current();}}));
vi.mock('../../src/runtime/isolated-execution/docker-engine-transport.js',()=>({DockerEngineTransport:class{constructor(input:{socketPath:string}){const transport=boundary.transports.get(input.socketPath);if(!transport)throw Error('fixture transport');return transport;}}}));
const H='a'.repeat(64),hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
/** Test-only OS/engine leaves. The only operation issuer is actual installed start;
 * no production callback overload or private token factory is exposed to tests. */
type FixtureEnginePreparation=(input:{physicalRoot:string;database:ReturnType<typeof openPrivateVerificationDatabase>;manifest:{packageHash:string;serviceUid:number};reopening:boolean})=>{hostSocket:string;engineBinding:{engineId:string;incarnation:string}};
export type InstalledControllerFixtureOptions={normalEngineBaseline?:FixtureEnginePreparation;logicalOS?:{base:'/Library/Application Support/xiaok-verification';prepare:FixtureEnginePreparation;assertExecutable(path:string):void};materialBytes?:Buffer;completionOwnerSchema?:2;artifact?:Buffer;incompleteOutput?:boolean;onClock?:()=>void;onPrincipal?:()=>void;onQualified?:()=>void|Promise<void>;onCurrent?:()=>void;onAuthorityQualified?:()=>void;onQualificationClose?:()=>void;existingRoot?:string;expectedReceiverKeys?:{publicKey:KeyObject;privateKey:KeyObject};recoveryOnly?:boolean;docker?:{socketPath:string;imageId:string};onBlackboxResult?:(result:BlackboxObservation)=>void|Promise<void>;onBlackboxError?:(error:unknown,request:BlackboxRequest)=>void|Promise<void>};
async function createInstalledControllerFixture(options:InstalledControllerFixtureOptions&{startupOnly?:true}={}){ // Load/validate the explicitly selected live endpoint before allocating a DB.
 const dockerTransport=options.docker?new (await vi.importActual<typeof import('../../src/runtime/isolated-execution/docker-engine-transport.js')>('../../src/runtime/isolated-execution/docker-engine-transport.js')).DockerEngineTransport({socketPath:options.docker.socketPath}):undefined;
 if(dockerTransport&&(options.logicalOS||options.normalEngineBaseline)){
  const actualTransport=dockerTransport;
  // Production binds this stable leaf at construction. The original test's later
  // prototype spy still performs actual removal before changing attachment facts.
  Object.defineProperty(actualTransport,'removeVolume',{configurable:true,writable:true,value:function(volume:Parameters<typeof actualTransport.removeVolume>[0]){
   return Reflect.apply(Object.getPrototypeOf(actualTransport).removeVolume,actualTransport,[volume]);
  }});
 }
 const root=options.existingRoot??realpathSync(mkdtempSync(join(tmpdir(),'ia-'))),state=join(root,'state');if(!options.existingRoot)for(const path of [state,join(root,'public'),join(root,'migrations')])mkdirSync(path);
 const pair=(name:string)=>{const path=join(root,name);if(options.existingRoot){const privateKey=createPrivateKey(readFileSync(path));return {privateKey,publicKey:createPublicKey(privateKey)};}const keys=generateKeyPairSync('ed25519');writeFileSync(path,keys.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});return keys;};
 const database=openPrivateVerificationDatabase(state),controllerKeys=pair('.fixture-controller-key.pem'),keys=pair('.fixture-receiver-key.pem');if(options.expectedReceiverKeys&&!keys.publicKey.export({format:'der',type:'spki'}).equals(options.expectedReceiverKeys.publicKey.export({format:'der',type:'spki'})))throw Error('fixture receiver key changed');let closed=false,time=1000,qualificationCalls=0;
 const clock=()=>{options.onClock?.();return {domainId:'clock',qualificationEpoch:1,lowerBound:time,upperBound:time+1,evidenceHash:H};};
 const current=()=>{options.onCurrent?.();if(closed||!database.open)throw Error('fixture closed');};
 const manifest={...(options.completionOwnerSchema===2?{version:3 as const,completionOwnerSchema:2 as const}:{version:2 as const}),authorityId:'authority',publicKeyPem:controllerKeys.publicKey.export({format:'pem',type:'spki'}).toString(),packageHash:H,serviceUid:502,allowedUserIds:[501]};
 let osFacts:ReturnType<NonNullable<InstalledControllerFixtureOptions['logicalOS']>['prepare']>|undefined;
 try{if(options.logicalOS&&options.normalEngineBaseline)throw Error('fixture_conflicting_engine_leaf_modes');osFacts=(options.logicalOS?.prepare??options.normalEngineBaseline)?.({physicalRoot:root,database,manifest,reopening:!!options.existingRoot});}
 catch(error){const failures:unknown[]=[error];try{database.close();}catch(cleanup){failures.push(cleanup);}throw new AggregateError(failures,'fixture_os_leaf_preparation:'+root);}
 const lifetime=Object.freeze({base:options.logicalOS?.base??root,state:options.logicalOS?join(options.logicalOS.base,'state'):state,release:options.logicalOS?join(options.logicalOS.base,'releases',manifest.packageHash):join(root,'release'),manifest,database,...controllerKeys,serviceEpoch:randomUUID(),peerHelper:'/fixture-peer',assertCurrent:current,close(){database.close();closed=true;}});boundary.lifetimes.add(lifetime);
 const receiverIdentity={receiverId:'receiver',receiverInstanceEpoch:1,keyId:hash(keys.publicKey.export({format:'der',type:'spki'}))};
 writeFileSync(join(root,'deployment.json'),JSON.stringify(manifest));writeFileSync(join(root,'receiver.json'),JSON.stringify({version:1,...receiverIdentity,publicKeyPem:keys.publicKey.export({format:'pem',type:'spki'}).toString(),serviceUid:503}));
 const engine=Object.freeze({hostSocket:osFacts?.hostSocket??options.docker?.socketPath??join(root,'engine.sock'),imageDigest:options.docker?.imageId??'sha256:'+H});boundary.engines.set(engine,{database,current});
 const qualification=Object.freeze({assertCurrent(){options.onAuthorityQualified?.();current();},async ensureCurrent(){qualificationCalls++;await options.onQualified?.();current();},currentFacts(){current();return {engineBinding:osFacts?.engineBinding??{engineId:'e',incarnation:'one'}};},deletionAuthority:{assertDeleted(){throw Error('fixture no qualification deletion');}},close(){options.onQualificationClose?.();}});boundary.qualifications.set(qualification,{engine,database,current});
 const customMaterial=options.materialBytes!==undefined,materialBytes=Buffer.from(options.materialBytes??Buffer.from('x'));
 const broker=Object.freeze({resolvePrincipal(peer:object){options.onPrincipal?.();return {...peer,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const};},async authorizeOwnerEnrollment(review:unknown){if(options.recoveryOnly)throw Error('unexpected fresh authority or execution');return {uid:501,auditSessionId:7,reviewHash:hash(json(review).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')))};},async inspectMaterial(){return {sha256:hash(materialBytes),size:materialBytes.length,executable:false};},async authorizeMaterials(input:any){return {uid:input.uid,auditSessionId:input.auditSessionId,reviewHash:hash(json(input.review))};},async readMaterialPage(input:any){return {contentHash:hash(materialBytes),totalBytes:materialBytes.length,offset:input.offset,bytes:(customMaterial?materialBytes.subarray(input.offset,input.offset+input.length):materialBytes).toString('base64'),executable:false};},clock,dispose(){}});boundary.brokers.set(broker,lifetime);
 const inputFiles=new Map<string,{path:string;bytes:Buffer;executable:boolean}>(),containers=new Map<string,any>(),volumes=new Set<string>();let serial=0;
 const transport={async populateInputFile(_id:string,file:{path:string;bytes:Buffer;executable:boolean}){inputFiles.set(file.path,{...file,bytes:Buffer.from(file.bytes)});},async readInputArchive(_id:string,path:string){return buildInputFileArchive(inputFiles.get(path)!);},async createVolume(v:any){volumes.add(v.name);},async inspectVolume(v:any){if(!volumes.has(v.name))throw Error('missing');},async createMounted(body:any){if(options.recoveryOnly)throw Error('unexpected fresh authority or execution');const Id=(++serial).toString(16).padStart(64,'0');containers.set(Id,{Id,Image:body.Image,HostConfig:body.HostConfig,Config:body,State:{Running:false,Pid:0,Status:'created',ExitCode:0}});return {Id};},async inspect(id:string){return containers.get(id);},async attachOutput(){return {completed:Promise.resolve({complete:!options.incompleteOutput,truncated:false,stdout:Buffer.from('finished'),stderr:Buffer.alloc(0)}),cancel(){}};},async start(id:string){Object.assign(containers.get(id).State,{Running:true,Pid:1,Status:'running'});},async wait(id:string){Object.assign(containers.get(id).State,{Running:false,Pid:0,Status:'exited'});},async kill(id:string){Object.assign(containers.get(id).State,{Running:false,Pid:0,Status:'exited'});},async isContainerAbsent(id:string){return !containers.has(id);},async remove(id:string){containers.delete(id);},async isVolumeAbsent(v:any){return !volumes.has(v.name);},async removeVolume(v:any){volumes.delete(v.name);},async readArtifactArchive(_id:string,path:string){return buildInputFileArchive({path,bytes:options.artifact??Buffer.from('result'),executable:false});}};
 boundary.transports.set(engine.hostSocket,dockerTransport??transport);boundary.next={lifetime,engine,qualification,broker,logicalOS:options.logicalOS};
 if(options.startupOnly){
  // The real root's same startup promise is retained before it can reach the
  // maintenance builder observer. No normal stack unpacking or forced DB close.
  const startupPromise=startInstalledVerificationController();
  const clear=()=>{boundary.transports.delete(engine.hostSocket);if(boundary.next?.lifetime===lifetime)boundary.next=undefined;};
  if(!options.existingRoot){
   const held={startupPromise,root,database,lifetime,engine,broker};let closing:Promise<void>|undefined;
   retainedFreshStarts.add(held);
   void startupPromise.catch(error=>{if(isInstalledControllerShutdownUnresolved(error))retainedFreshStarts.add(held);});
   return {startupPromise,root,state,database,lifetime,keys,controllerKeys,receiverIdentity,
    close(preserveRoot=true){return closing??=(async()=>{
     let installed:Awaited<typeof startupPromise>;
     try{installed=await startupPromise;}catch(error){
      if(isInstalledControllerShutdownUnresolved(error)){retainedFreshStarts.add(held);throw error;}
      // The real root already joined all component/finalizer cleanup. Its known
      // startup rejection is retained; only this fixture's lifetime is closed.
      try{if(database.open)lifetime.close();}catch(cleanup){retainedFreshStarts.add(held);throw new AggregateError([error,cleanup],'fixture_fresh_startup_close_unknown:'+root,{cause:error});}
      clear();retainedFreshStarts.delete(held);if(!preserveRoot)rmSync(root,{recursive:true,force:true});throw error;
     }
     try{await installed.close();if(database.open)throw Error('fixture_fresh_startup_lifetime_open');}
     catch(error){retainedFreshStarts.add(held);throw error;}
     clear();retainedFreshStarts.delete(held);if(!preserveRoot)rmSync(root,{recursive:true,force:true});
    })();},
   };
  }
  void startupPromise.then(clear,clear);
  let closing:Promise<void>|undefined;
  return {startupPromise,root,state,database,lifetime,keys,controllerKeys,receiverIdentity,
   close(preserveRoot=true){return closing??=(async()=>{const installed=await startupPromise;await installed.close();if(!preserveRoot)rmSync(root,{recursive:true,force:true});})();},
  };
 }
 const createCompletion=completionModule.createVerificationCompletionComposition;
 const completion=vi.spyOn(completionModule,'createVerificationCompletionComposition'),operation=vi.spyOn(operationModule,'createApprovedVerificationOperations'),stack=vi.spyOn(stackModule,'createInstalledExecutionStack'),artifact=vi.spyOn(artifactModule,'createApprovedRecipeArtifactReader'),listener=vi.spyOn(publicModule,'startPublicController');
 if(options.onBlackboxResult||options.onBlackboxError)completion.mockImplementation(input=>createCompletion({...input,recipePorts:{...input.recipePorts,async runBlackbox(request){
  let result:BlackboxObservation;try{result=await input.recipePorts.runBlackbox(request);}catch(error){await options.onBlackboxError?.(error,request);throw error;}
  await options.onBlackboxResult?.(result);return result;
 }}}));
 let restoreSharedCapacityObserver:(()=>void)|undefined,restoreMetadataSourceObserver:(()=>void)|undefined;
 let originalInstalledRoot:Awaited<ReturnType<typeof startInstalledVerificationController>>|undefined;
 const actualWallNow=Date.now;Date.now=()=>100000;
 try{
  const sharedProducer=sharedCapacityModule.createInstalledSharedCapacity;
  const sharedObservation=vi.isMockFunction(sharedProducer)?{observer:sharedProducer,owned:false}:{observer:vi.spyOn(sharedCapacityModule,'createInstalledSharedCapacity'),owned:true};
  const sharedCapacityObserver=sharedObservation.observer;
  if(sharedObservation.owned)restoreSharedCapacityObserver=()=>sharedCapacityObserver.mockRestore();
  const metadataProducer=metadataSourceModule.createInstalledControllerMetadataSource;
  const metadataObservation=vi.isMockFunction(metadataProducer)?{observer:metadataProducer,owned:false}:{observer:vi.spyOn(metadataSourceModule,'createInstalledControllerMetadataSource'),owned:true};
  const metadataSourceObserver=metadataObservation.observer;
  if(metadataObservation.owned)restoreMetadataSourceObserver=()=>metadataSourceObserver.mockRestore();
  const sharedCallStart=sharedCapacityObserver.mock.calls.length,sharedResultStart=sharedCapacityObserver.mock.results.length;
  const sourceCallStart=metadataSourceObserver.mock.calls.length,sourceResultStart=metadataSourceObserver.mock.results.length;
  const installed=await startInstalledVerificationController();originalInstalledRoot=installed;
  const composition:ReturnType<typeof completionModule.createVerificationCompletionComposition>=returned(completion.mock.results.at(-1));
  const operations:ReturnType<typeof operationModule.createApprovedVerificationOperations>=returned(operation.mock.results.at(-1));
  const actualStack:Awaited<ReturnType<typeof stackModule.createInstalledExecutionStack>>=await returned(stack.mock.results.at(-1));
  const artifacts:ReturnType<typeof artifactModule.createApprovedRecipeArtifactReader>=returned(artifact.mock.results.at(-1));
  const operationInput=operation.mock.calls.at(-1)![0],invoke=listener.mock.calls.at(-1)![0].invoke;
  Date.now=actualWallNow;
  const sharedResult=sharedCapacityObserver.mock.results[sharedResultStart],sourceResult=metadataSourceObserver.mock.results[sourceResultStart];
  const sharedCalls=sharedCapacityObserver.mock.calls.length-sharedCallStart,sharedResults=sharedCapacityObserver.mock.results.length-sharedResultStart;
  const sourceCalls=metadataSourceObserver.mock.calls.length-sourceCallStart,sourceResults=metadataSourceObserver.mock.results.length-sourceResultStart;
  const sharedArgumentCount=sharedCapacityObserver.mock.calls[sharedCallStart]?.length,sourceArgumentCount=metadataSourceObserver.mock.calls[sourceCallStart]?.length,sourceLifetime=metadataSourceObserver.mock.calls[sourceCallStart]?.[0];
  const reserveControllerMetadata=(minimumBytes:number)=>{
   if(sharedCalls!==1||sharedResults!==1||sharedArgumentCount!==1||!sharedResult||sharedResult.type!=='return'||sourceCalls!==1||sourceResults!==1||sourceArgumentCount!==1||!sourceResult||sourceResult.type!=='return'||sourceLifetime!==lifetime)throw Error('fixture_original_capacity_observation');
   return reserveOriginalFixtureControllerMetadata(lifetime,sharedResult.value,sourceResult.value,minimumBytes);
  };
  return {installed,root,state,database,lifetime,reserveControllerMetadata,keys,controllerKeys,receiverIdentity,clock,setTime(value:number){time=value;},composition,operations,operationInput,artifacts,stack:actualStack,material:actualStack.privateHost.materials,raw:actualStack.privateHost.execution.privateHost.raw,runs:actualStack.privateHost.runs,invoke,peer:{uid:501,gid:20,auditSessionId:7},containers,volumes,get qualificationCalls(){return qualificationCalls;},async close(preserveRoot=false){await installed.close();boundary.transports.delete(engine.hostSocket);if(!preserveRoot)rmSync(root,{recursive:true,force:true});}};
 }catch(error){boundary.transports.delete(engine.hostSocket);
  if(options.logicalOS||options.normalEngineBaseline){
   const errors:unknown[]=[error];if(originalInstalledRoot)try{await originalInstalledRoot.close();}catch(cleanup){errors.push(cleanup);}
   // Root, not the fixture, owns failed/unknown drain and any retained lifetime.
   // Keep the physical DB/keys and original cause; never force-close or rm them.
   throw new AggregateError(errors,'fixture_normal_startup:'+root);
  }
  if(database.open)database.close();rmSync(root,{recursive:true,force:true});throw error;}
 finally{
  try{Date.now=actualWallNow;for(const spy of [completion,operation,stack,artifact,listener])spy.mockRestore();}
  finally{try{restoreMetadataSourceObserver?.();}finally{try{restoreSharedCapacityObserver?.();}finally{boundary.next=undefined;}}}
 }
}

/** Existing normal entrypoint retains its original return shape. */
export async function installedControllerFixture(options:InstalledControllerFixtureOptions={}){
 const value=await createInstalledControllerFixture(options);
 if('startupPromise' in value)throw Error('fixture_unexpected_startup_mode');
 return value;
}
/** Test-only OS/lifetime leaves, same DB/keys and the real zero-argument start.
 * Caller must observe/release/join startupPromise; this is not an owner factory. */
export async function installedControllerStartupFixture(options:InstalledControllerFixtureOptions={}){
 if(!options.existingRoot&&(options.docker||options.logicalOS||options.normalEngineBaseline))throw Error('fixture_fresh_startup_requires_ordinary_doubles');
 const value=await createInstalledControllerFixture({...options,startupOnly:true});
 if(!('startupPromise' in value))throw Error('fixture_missing_startup_promise');
 return value;
}

// Resolve the actual readonly brand check at call time: a direct re-export can
// capture an undefined binding while Vitest initializes this fixture's cycle.
// The root import stays at the original fixture boundary, after OS mock setup.
export function isInstalledControllerShutdownUnresolved(error:unknown):boolean{
 return installedControllerModule.isInstalledControllerShutdownUnresolved(error);
}
