import {assertOriginalWriterImplementationContext} from './activity-owner-writer-launcher.js';
import type { DesktopPreparationCompositionLaunch } from './default-dispatch-preparation-composition-bootstrap.js';
import { createOwnedCanonicalBusiness, prepareOwnedCanonicalBusinessHello, assertOwnedCanonicalBusinessHelloCurrent, readOwnedCanonicalPreparationFacet, type CanonicalBusinessAdmission } from '../../src/runtime/conversation-activity/owned-canonical-business.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';
import { readKSwarmOwnedControlServiceScope } from './kswarm-service.js';
import type { ActivityOwnerConfig } from '../../src/runtime/conversation-activity/owner-runtime.js';
import { activityOwnerConfigDigest } from '../../src/runtime/conversation-activity/owner-runtime.js';
import { activityOwnerAddress, readActivityOwnerCredentials, ACTIVITY_OWNER_GENERATION } from '../../src/runtime/conversation-activity/owner-protocol.js';
import { ACTIVITY_STORAGE_NAMES, chmodPrivateActivityFile, ensurePrivateActivityFile } from '../../src/runtime/conversation-activity/storage-permissions.js';
import { buildActivityOwnerEnv } from '../../src/runtime/conversation-activity/owner-launcher.js';
import { ConversationActivityOwnerClient } from '../../src/runtime/conversation-activity/owner-client.js';
import type { writerLaunchContext, Status, LaunchState } from './activity-owner-writer-launcher.js';
export async function runMainLaunch(state:LaunchState,config:ActivityOwnerConfig, context:writerLaunchContext):Promise<void>{
 assertOriginalWriterImplementationContext(context,'launch');
 const {NativePromise,apply,weakGet,freeze,stateFor,originalLaunchConnected,nonce,same,data,probeSocket,assertPreparationConstructorPorts,writeOwnerLaunchConfig,deliveries,createRelay}=context;
 if(!same(state.scope,readKSwarmOwnedControlServiceScope(state.service,state.source.admission)))throw Error('WRITER_CONTROL_NATIVE_BOOTSTRAP_REQUIRED');
 const address=activityOwnerAddress(config.dataRoot),normalized={...config,dataRoot:address.dataRoot},digest=activityOwnerConfigDigest(normalized);state.digest=digest;
 async function attach(){const client=new ConversationActivityOwnerClient(address.dataRoot,'producer');try{const status=await client.request<Status>('status');if(status.profileId!==config.profileId)throw Error('activity_owner_profile_mismatch');if(typeof status.generation==='number'&&status.generation>=ACTIVITY_OWNER_GENERATION&&status.configDigest!==digest)throw Error('activity_owner_config_mismatch');if(status.ready===false)throw Error('activity_owner_initializing');if(config.identity.kind==='desktop'&&status.nativeSourceProtocol===1)try{const connection=await client.authorizeNativeSource();client.assertNativeConnectionCurrent(connection);}catch(error){console.warn('[conversation-activity] Native source unavailable:',error);}return {client,status};}catch(error){client.dispose();throw error;}}
 // Malformed/private credential failures remain errors even if a socket is gone.
 try{readActivityOwnerCredentials(address);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const present=await probeSocket(address.socketPath);if(state.observationUnknown)return;
 if(present){const attached=await attach();state.closed=true;(apply(weakGet,deliveries,[state]) as (client:ConversationActivityOwnerClient)=>void)(attached.client);return;}
 if(state.closed)throw Error('WRITER_CONFIG_LAUNCH_CLOSED');
 if(state.preparation){try{const binding=await import('./default-dispatch-preparation-composition-bootstrap.js');if(state.closed)throw Error('DEFAULT_DISPATCH_PREPARATION_LAUNCH_CLOSED');state.preparation.composition=binding.consumeDesktopPreparationCompositionCapsule(state.preparation.capsule,state);}catch(error){state.preparation.failure={error};}}
 const {consumeDesktopWriterControlLaunchCapsule}=await import('./kswarm-writer-control-native-bootstrap.js');if(state.observationUnknown)return;
 if(state.closed)throw Error('WRITER_CONFIG_LAUNCH_CLOSED');
 const launch=consumeDesktopWriterControlLaunchCapsule(state.capsule,{source:state.source,service:state.service,scope:state.scope});
 let businessBinding:typeof import('./default-dispatch-native-bootstrap.js')|undefined;if(state.business){businessBinding=await import('./default-dispatch-native-bootstrap.js');if(state.closed||state.observationUnknown)throw Error('DISPATCH_NATIVE_LAUNCH_CLOSED');state.business.launch=businessBinding.consumeDesktopDispatchLaunchCapsule(state.business.capsule,state);}
 const configFile=writeOwnerLaunchConfig(address.dataRoot,launch.mainLaunchNonce,data(normalized));state.configArtifact=configFile;
 const logFile=join(address.dataRoot,ACTIVITY_STORAGE_NAMES.log);ensurePrivateActivityFile(logFile);const logFd=openSync(logFile,'a',0o600);let child:ChildProcess;
 try{
  chmodPrivateActivityFile(logFile);const executable=process.execPath,args=[fileURLToPath(new URL('../../src/runtime/conversation-activity/owner-entry.js',import.meta.url)),configFile],spawnOptions={detached:true,stdio:['ignore',logFd,logFd,'ipc'] as ['ignore',number,number,'ipc'],windowsHide:true,env:{...buildActivityOwnerEnv(process.env),ELECTRON_RUN_AS_NODE:'1'}};
  launch.assertCurrent();state.business?.launch!.assertCurrent();launch.assertLocal();state.business?.launch!.assertLocal();if(state.closed||state.observationUnknown||state.spawnFailure||stateFor(state.service)!==state)throw Error('WRITER_CONFIG_LAUNCH_CLOSED');
  child=spawn(executable,args,spawnOptions);state.child=child;
 }finally{closeSync(logFd);}
 let relay:ReturnType<typeof createRelay>|undefined;try{relay=createRelay(state,child!,launch);state.relay=relay;}catch(error){state.failure=error;}
 const deadline=Date.now()+30000;let lastError:unknown;
 while(Date.now()<deadline){
  if(state.spawnFailure)throw state.spawnFailure;
  let attached:Awaited<ReturnType<typeof attach>>|undefined;
  try{attached=await attach();}catch(error){lastError=error;if(error instanceof Error&&['activity_owner_profile_mismatch','activity_owner_config_mismatch'].includes(error.message))throw error;}
  if(attached){
   if(attached.status.pid!==child!.pid){state.closed=true;relay?.seal();(apply(weakGet,deliveries,[state]) as (client:ConversationActivityOwnerClient)=>void)(attached.client);return;}
   // Configuration failure must never trigger ordinary service fallback/takeover.
   try{if(relay)await relay.install(attached.status.ownerEpoch);}catch(error){state.failure=error;relay?.seal();}
   if((state.business||state.preparation?.composition&&!state.preparation.failure)&&!state.closed&&!state.observationUnknown&&!state.spawnFailure){
    try{
     const business=state.business;
     let admission:CanonicalBusinessAdmission|undefined;
     if(business){businessBinding!.assertDesktopDispatchLaunchBinding(business.launch!,state);admission=(business.controller as import('./default-dispatch-business-controller.js').DefaultDispatchBusinessController).businessAdmission;}
     const physicalCurrent=()=>state.child===child&&!state.observationUnknown&&!state.spawnFailure&&!state.sdkFailure&&originalLaunchConnected(state,child!)&&!state.observationUnknown&&!state.spawnFailure&&!state.sdkFailure;
     const current=()=>{if(state.closed||!business?.initialized||!physicalCurrent())throw Error('DISPATCH_BUSINESS_UNAVAILABLE');business.launch!.assertCurrent();if(state.closed||!business.initialized||!physicalCurrent())throw Error('DISPATCH_BUSINESS_UNAVAILABLE');business.launch!.assertLocal();if(state.closed||state.observationUnknown||state.spawnFailure)throw Error('DISPATCH_BUSINESS_UNAVAILABLE');};
     let preparation:Readonly<DesktopPreparationCompositionLaunch>|undefined;
     if(state.preparation?.composition&&!state.preparation.failure){try{const binding=await import('./default-dispatch-preparation-composition-bootstrap.js');binding.assertDesktopPreparationCompositionBinding(state.preparation.composition,state);preparation=state.preparation.composition;}catch(error){state.preparation.failure={error};}}
     // The config nonce is correlation data for the same retained descriptor,
     // never a Work grant. User mode retains its independent original nonce.
     const mainLaunchNonce=business?business.launch!.mainLaunchNonce:launch.mainLaunchNonce,ownerEpoch=attached.status.ownerEpoch!;
     if(state.closed||state.observationUnknown||state.spawnFailure||state.sdkFailure||state.child!==child)throw Error('DISPATCH_BUSINESS_UNAVAILABLE');
     if(business){businessBinding!.assertDesktopDispatchLaunchBinding(business.launch!,state);business.launch!.assertLocal();}
     if(preparation)try{preparation.assertLocal();assertPreparationConstructorPorts(preparation);}catch(error){state.preparation!.failure={error};preparation=undefined;}
     if(business||preparation){
      const client=createOwnedCanonicalBusiness({...(preparation?{preparationSource:preparation.transportSource,preparationAdmission:preparation.transportAdmission}:{}),...(business?{admit(proof:object,audience:Parameters<CanonicalBusinessAdmission>[1]){current();const result=apply(admission!,undefined,[proof,audience]);if(result!==undefined)return result;business.launch!.assertLocal();if(state.closed||state.observationUnknown||state.spawnFailure)throw Error('DISPATCH_BUSINESS_UNAVAILABLE');}}:{}),child:child!,scope:state.scope,serviceOwner:state.service,mainLaunchNonce,ownerEpoch,isCurrent:physicalCurrent});
      state.dispatchClient=client;
      if(business){business.admission=admission;business.port=freeze({prepareHello(){current();return prepareOwnedCanonicalBusinessHello(client);},assertHelloCurrent(value:object){current();assertOwnedCanonicalBusinessHelloCurrent(client,value);},readPlan(projectId:string,context:Parameters<typeof client.readPlan>[1]){current();return client.readPlan(projectId,context);},captureDefaultDispatch(projectId:string,input:unknown,context:Parameters<typeof client.readPlan>[1]){current();return client.captureDefaultDispatch(projectId,input,context);},readOperation(projectId:string,input:unknown,context:Parameters<typeof client.readPlan>[1]){current();return client.readOperation(projectId,input,context);}});business.initialized=true;}
      if(preparation&&state.preparation){try{state.preparation.port=readOwnedCanonicalPreparationFacet(client,preparation.transportSource,preparation.transportAdmission);}catch(error){state.preparation.failure={error};}}
     }
    }catch(error){if(state.business)state.failure??=error;else if(state.preparation)state.preparation.failure={error};state.dispatchClient?.seal();}
   }
   (apply(weakGet,deliveries,[state]) as (client:ConversationActivityOwnerClient)=>void)(attached.client);return;
  }
  if(child!.exitCode!==null||child!.signalCode!==null){if(Date.now()+500>=deadline)break;}
  await new NativePromise<void>(yes=>setTimeout(yes,50));
 }
 throw lastError??Error('activity_owner_start_timeout');
}
interface Wire {frame:Record<string,unknown>;types:readonly string[];sent:boolean;returned:boolean;callback:boolean;rawDone:boolean;rawUnknown:boolean;knownDone:boolean;knownCompletion:Promise<void>;completeKnown():void;closed:boolean;reply?:Record<string,unknown>;raw?:unknown;failure?:unknown;delivered:boolean;completion:Promise<void>;complete():void;resolve(value:Record<string,unknown>):void;reject(error:unknown):void;timer?:ReturnType<typeof setTimeout>}
