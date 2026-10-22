import {it} from 'vitest';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createMultiAgentCoordinator} from '../../src/ai/agents/multi-agent-coordinator.js';
import * as H from '../../desktop/tests/fixtures/qualified-group-callback-closure.js';
const require=createRequire(import.meta.url),ts=require('typescript');
const actualPath=fileURLToPath(new URL('../../desktop/electron/desktop-multi-agent-service.ts',import.meta.url));
const actual=readFileSync(actualPath,'utf8'),ast=ts.createSourceFile(actualPath,actual,ts.ScriptTarget.Latest,true);
const declaration=ast.statements.find((n:any)=>ts.isClassDeclaration(n)&&n.name?.text==='DesktopMultiAgentService');
const names=['beginManagedFollowup','inspectManagedFollowupPreparation'];
const fragments=names.map(name=>declaration.members.find((n:any)=>n.name?.getText(ast)===name).getText(ast));
const compiled=ts.transpileModule(`class ActualServiceMethods{${fragments.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const ActualServiceMethods=Function('createHash','isDeepStrictEqual',`${compiled};return ActualServiceMethods;`)(createHash,isDeepStrictEqual);
function gate<T=void>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
it.for(['completed','pending','missing-consumption','extra-null','extra-undefined','extra-same-F','replace-map-late','replace-inspect-late','terminal-retain-error'] as const)('keeps exact original preparation source and closed native gate: %s',async(variant)=>{
 const F=new Error('preparation original F'),observerF=new Error('preparation terminal observer F'),entered=gate(),execution=gate<string>(),producer=gate(),activateFinish=gate(),body=gate<string>();
 const core=createMultiAgentCoordinator({executionMode:'externally_activated',closeSettlementTimeoutMs:1,idGenerator:()=> 'owned-child'});
 let cleanupCap:ReturnType<typeof H.captureQualifiedServiceCallbacks>|undefined,work:Promise<unknown>|undefined,bodyFailure:{error:unknown}|undefined;void producer.promise.catch(()=>{});
 try{
 const context={groupId:'owned-group',turnId:'old-turn'},child:any={id:'owned-child',context,followups:[]};
 class Commands{run(fn:()=>unknown){return Promise.resolve().then(fn);}}
 const group={id:'owned-group',core,commands:new Commands(),children:new Map<string,object>()};
 const ticket={},pending={operationId:'original-operation',expectedTurn:2,ticket,controller:new AbortController()};child.followups.push(pending);
 const closure={version:1,requiresReauthorization:true,observations:[]},childSession={getProtectedObservationClosure:()=>closure},admission={};
 const facts={admission,childSession,operationId:pending.operationId,previousTurnId:context.turnId,nextTurnId:'new-turn',rootEpoch:7,message:'continue',closure,requestSource:'user'};
 const operation={requestHash:'request-hash',followupInput:{targetId:child.id,message:facts.message},managedTurnReservation:{nextTurnId:facts.nextTurnId,previousTurnId:facts.previousTurnId,agentId:child.id,rootEpoch:facts.rootEpoch,messageHash:createHash('sha256').update(facts.message).digest('hex'),closureHash:createHash('sha256').update(JSON.stringify(closure)).digest('hex')}};
 class Store{getRootBinding(){return {groupId:group.id};}getOperation(){return operation;}}
 const store=new Store();
 class Service extends ActualServiceMethods{
  groups=new Map([[group.id,group]]);groupObservationPreparationDrains=new WeakMap();observationPreparationDrains=new Set();managedFollowupPreparations=new WeakMap();physicalSessionClosures=new Map();managedFinalPublications=new Map();managedReleaseOwners=new Map();
  options={store,prepareObservationFollowup:(_token:object)=>producer.promise};
  prepareRoot(){return Promise.resolve({taskId:'owned-task'});}
  dispose(){return core.dispose();}
  closeManagedSession(){return Promise.resolve();}
  bindManagedObservationAdmission(){return variant==='extra-null'||variant==='extra-undefined'||variant==='extra-same-F'?Promise.reject(variant==='extra-null'?null:variant==='extra-undefined'?undefined:F):Promise.resolve();}registerManagedFinalPublication(){return Promise.resolve();}
  assertManagedResourceCurrent(actual:unknown){assert.equal(actual,admission);}
  async activateManagedFollowup(actualGroup:unknown,actualChild:unknown,actualPending:unknown,actualTicket:unknown){
   assert.equal(actualGroup,group);assert.equal(actualChild,child);assert.equal(actualPending,pending);assert.equal(actualTicket,ticket);
   const token={};this.managedFollowupPreparations.set(token,{group,child,pending,oldContext:context,facts,requestHash:operation.requestHash,phase:'prepared'});
   try{await this.options.prepareObservationFollowup(token);}catch(error){body.resolve(String(error));await activateFinish.promise;throw error;}
  }
 }
 // Put the extracted originals on the immediate Service prototype, as in the
 // actual class. This is an explicit shape adapter, not a Service integration.
 for(const name of names)Object.defineProperty(Service.prototype,name,Object.getOwnPropertyDescriptor(ActualServiceMethods.prototype,name)!);
 const service=new Service(),record={},coreSlot={receiver:core,called:false},ownerSlot={receiver:service,called:false};
 const als=new AsyncLocalStorage<{callbackCall?:H.QualifiedCallbackCall;slot?:object}>(),observerErrors:unknown[]=[],refs:unknown[]=[];let closing=false;
 const cap=H.captureQualifiedServiceCallbacks(service,store,{observeExpectedPreparation:true,
  retain:<T,>(label:string,value:T)=>{if(variant==='terminal-retain-error'&&label==='qualified-service-callback-terminal')throw observerF;refs.push(value);return value;},isClosing:()=>closing,
  invokeOriginal:(call,invoke)=>{const origin=als.getStore();call.originRecord=record;call.originSlot=origin?.slot;call.preClosing=!closing;call.parentCall=origin?.callbackCall;return als.run({callbackCall:call,slot:origin?.slot},invoke);},
  allowedCloseOrigin:(receiver,call)=>call.originRecord===record&&receiver===service&&call.receiver===service&&call.name==='dispose'&&((call.preClosing&&!call.originSlot)||(call.originSlot===ownerSlot&&ownerSlot.called)),
  onGroup(){},preparedCalls:()=>[],onPreparedFactory(){throw Error('unexpected factory');},onPreparedSession(){throw Error('unexpected session');},onError:error=>observerErrors.push(error),
 });
 cleanupCap=cap;
 await service.prepareRoot();await tick();
 const handle=core.prepareSpawn({requestSource:'agent',callerId:'main',taskName:'owned',message:'run',createSession:async()=>({run:async()=>{entered.resolve();return execution.promise;},dispose:()=>{if(variant==='replace-map-late')service.managedFollowupPreparations=new WeakMap();if(variant==='replace-inspect-late')Object.defineProperty(Service.prototype,'inspectManagedFollowupPreparation',{...Object.getOwnPropertyDescriptor(Service.prototype,'inspectManagedFollowupPreparation'),value:()=>{throw Error('changed authority');}});return Promise.resolve();}})});
 group.children.set(handle.agentId,child);core.activatePreparedTurn(handle);await entered.promise;
 const raw=service.beginManagedFollowup(group,child,pending,ticket);work=raw.then(()=>({ok:true}),(error:unknown)=>({ok:false,error}));
 await tick();assert.equal(cap.preparationSources.length,1);assert.equal(cap.preparationSources[0].begin.raw,raw);assert.equal(cap.preparationSources[0].producer!.raw,producer.promise);
 producer.reject(F);const bodyValue=await body.promise;assert.equal(bodyValue,String(F));
 if(variant!=='missing-consumption')H.consumeQualifiedPreparationFailure(cap,F,body.promise,bodyValue);
 if(variant==='completed'){activateFinish.resolve();await work;}
 let extraFailure:{error:unknown}|undefined;
 if(variant==='extra-null'||variant==='extra-undefined'||variant==='extra-same-F'){const originalExtra=service.bindManagedObservationAdmission();const capturedExtra=cap.methods.find(method=>method.key==='bindManagedObservationAdmission')!.calls[0];assert.equal(capturedExtra.raw,originalExtra);try{await originalExtra;assert.fail('extra original producer must reject');}catch(error){extraFailure={error};}await capturedExtra.reaction;assert.equal(capturedExtra.outcome!.ok,false);if(capturedExtra.outcome!.ok===false)assert.equal(capturedExtra.outcome!.error,extraFailure!.error);}
 const disposeRaw=service.dispose();closing=true;coreSlot.called=true;const stop=als.run({slot:coreSlot},()=>H.beginQualifiedGroupCallbackStop(cap.bindings[0]));execution.resolve('done');await stop;await disposeRaw;
 const disposeCall=cap.methods.find(method=>method.key==='dispose')!.calls[0];await disposeCall.reaction;assert.equal(disposeCall.outcome!.ok,true);
 let settled=false,receipt:unknown,failure:{error:unknown}|undefined;
 const finishing=Promise.resolve().then(()=>H.finishQualifiedPreparationCallbacks(cap,F,disposeCall)).then(value=>{settled=true;receipt=value;},error=>{settled=true;failure={error};});
 if(variant!=='completed'&&variant!=='missing-consumption'){await tick();assert.equal(settled,false,variant);}
 activateFinish.resolve();await work;await finishing;
 const valid=variant==='completed'||variant==='pending';assert.equal(Boolean(receipt),valid,variant);if(valid){assert.equal((receipt as any).nativeHealthy,false);assert.equal((receipt as any).originalServiceOutcome.ok,true);assert.equal(H.hasQualifiedPreparationNativePoison(cap),true);assert.equal(Object.isFrozen(receipt),true);await H.awaitQualifiedServiceCallbackObservations(cap);}else assert.ok(failure,variant);
 if(extraFailure){const originalFailure=failure!.error;assert.ok(originalFailure===extraFailure.error||(originalFailure instanceof AggregateError&&originalFailure.errors.some(error=>error===extraFailure!.error)),'extra actual producer original rejection remains reachable');}
 if(variant==='terminal-retain-error')assert.ok(failure!.error===observerF||(failure!.error instanceof AggregateError&&failure!.error.errors.includes(observerF)));
 }catch(error){bodyFailure={error};}
 finally{
  const failures:unknown[]=bodyFailure?[bodyFailure.error]:[];
  producer.reject(F);activateFinish.resolve();execution.resolve('finally release owned original execution');
  try{if(work)await work;}catch(error){failures.push(error);}
  try{await core.dispose();await core.waitForDisposedResources();}catch(error){failures.push(error);}
  try{if(cleanupCap)H.restoreQualifiedServiceCallbackObservers(cleanupCap);}catch(error){failures.push(error);}
  if(failures.length===1)throw failures[0];if(failures.length)throw new AggregateError(failures,'qualified_preparation_guard_original_and_cleanup_failed',{cause:failures[0]});
 }
});
