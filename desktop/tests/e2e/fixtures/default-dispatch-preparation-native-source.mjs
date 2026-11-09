import {app,BrowserWindow} from 'electron';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,resolve,join,basename,isAbsolute} from 'node:path';
import {lstatSync,realpathSync,writeFileSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
const compiled=resolve(dirname(fileURLToPath(import.meta.url)),'../../../dist/main/desktop/electron');
const target=process.env.XIAOK_PREPARATION_NATIVE_RESULT_FILE;
if(typeof target!=='string'||!isAbsolute(target)||basename(target)!=='preparation-result.json')throw Error('preparation_fixture_target_required');
const root=realpathSync(dirname(target)),stat=lstatSync(dirname(target));
if(stat.isSymbolicLink()||!stat.isDirectory()||typeof process.getuid==='function'&&stat.uid!==process.getuid()||dirname(root)!==realpathSync(tmpdir())||!/^xiaok-artifact-runtime-e2e-[A-Za-z0-9]{6}$/.test(basename(root)))throw Error('preparation_fixture_target_invalid');
let published=false;
function publish(result){if(published)throw Error('duplicate_preparation_fixture_publication');published=true;const pending=join(root,'preparation-result.json.pending');writeFileSync(pending,JSON.stringify(result),{flag:'wx',mode:0o600});renameSync(pending,join(root,'preparation-result.json'));}
app.on('window-all-closed',()=>{});
async function waitReady(window){const deadline=Date.now()+5000;while(window.webContents.isLoading()){if(Date.now()>=deadline)throw Error('fixture_native_loading_did_not_stop');await delay(1);}}
app.whenReady().then(async()=>{
 const sources=[],windows=[],cases={},nativeFacts={},cleanupErrors=[],expectedNegative=new Set();let bodyError,originalReady=app.isReady,originalWindows=BrowserWindow.getAllWindows,nativeCalls=0,inventoryOverride;
 try{
  app.isReady=function(...args){nativeCalls++;return Reflect.apply(originalReady,this,args);};
  BrowserWindow.getAllWindows=function(...args){nativeCalls++;return inventoryOverride?inventoryOverride():Reflect.apply(originalWindows,this,args);};
  const {createDefaultDispatchPreparationNativeSource:create,readDefaultDispatchPreparationNativeBirth:read,assertDefaultDispatchPreparationNativeBirth:verify,acquireOriginalPreparationNativeObservationLease:acquireLease,assertOriginalPreparationNativeObservationCurrent:leaseCurrent,assertOriginalPreparationNativeObservationLocal:leaseLocal,releaseOriginalPreparationNativeObservationLease:releaseLease,readOriginalPreparationNativeObservationSettlement:readSettlement}=await import(join(compiled,'default-dispatch-preparation-native-source.js'));
  assert.equal(typeof create,'function');assert.equal(typeof read,'function');assert.equal(typeof verify,'function');assert.equal(typeof readSettlement,'function');
  const {createDefaultDispatchUserSource}=await import(join(compiled,'default-dispatch-user-source.js'));
  const html=join(root,'preparation.html');writeFileSync(html,'<!doctype html><title>Native preparation source fixture</title>');
  const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});windows.push(window);await window.loadFile(html);await waitReady(window);
  const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},url=pathToFileURL(html).href;
  let sealDuringPolicy=false,source;
  const options={window,scope,isTrustedUrl(value){if(sealDuringPolicy)source.seal();return value===url;}};
  const before=nativeCalls;source=create(options);sources.push(source);assert.equal(nativeCalls,before);assert.throws(()=>read(source));assert.equal(nativeCalls,before);cases.passiveConstructor=true;
  const registered=[source.ingress],final=[()=>source.drain()];assert.equal(registered[0],source.ingress);assert.equal(final.length,1);cases.registeredBeforeActivation=true;
  source.activate();const birth=read(source);verify(source,birth);assert.equal(read(source),birth);assert.equal(birth.window,window);assert.equal(birth.contents,window.webContents);assert.equal(birth.session,window.webContents.session);assert.equal(birth.scope.profileId,scope.profileId);assert.equal(birth.scope.workspaceId,scope.workspaceId);assert.ok(nativeCalls>before);cases.actualNativeBirth=true;
  const localCalls=nativeCalls;birth.assertLocal();assert.equal(nativeCalls,localCalls);cases.localFenceHasNoNativeSdk=true;
  let getters=0;const fake=new Proxy({},{get(){getters++;throw Error('foreign getter');},getPrototypeOf(){getters++;throw Error('foreign prototype');}});
  assert.throws(()=>read(fake));assert.throws(()=>verify(source,fake));assert.throws(()=>verify({...source},birth));assert.throws(()=>verify(source,{...birth}));assert.equal(getters,0);cases.membershipBeforeCandidateAccess=true;
  const old=createDefaultDispatchUserSource(options);sources.push(old);assert.throws(()=>read(old));cases.oldUserSourceDenied=true;
  const fakeWindow={get id(){getters++;throw Error('fake window id');},get webContents(){getters++;throw Error('fake window contents');}},foreign=create({...options,window:fakeWindow});sources.push(foreign);assert.throws(()=>foreign.activate());assert.equal(getters,0);cases.fakeWindowDeniedBeforeGetters=true;
  await window.loadFile(html);await waitReady(window);assert.throws(()=>birth.assertLocal());cases.navigationRevokesOldBirth=true;
  const closedAfterNavigation=window.listenerCount('closed'),navigationAfterNavigation=window.webContents.listenerCount('did-start-navigation');
  source.activate();const freshBirth=read(source);assert.notEqual(freshBirth,birth);assert.ok(freshBirth.sourceEpoch>birth.sourceEpoch);verify(source,freshBirth);assert.throws(()=>verify(source,birth));assert.equal(window.listenerCount('closed'),closedAfterNavigation);assert.equal(window.webContents.listenerCount('did-start-navigation'),navigationAfterNavigation);
  const navigationLease=acquireLease(source);await window.loadFile(html);await waitReady(window);assert.throws(()=>leaseLocal(source,navigationLease));releaseLease(source,navigationLease);source.activate();verify(source,read(source));cases.navigationAllowsFreshIndependentBirth=true;
  const current=create({...options,isTrustedUrl:value=>value===url});sources.push(current);current.activate();const currentBirth=read(current);currentBirth.assertCurrent();window.destroy();assert.throws(()=>currentBirth.assertLocal());cases.nativeCloseRevokes=true;
  const another=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});windows.push(another);await another.loadFile(html);await waitReady(another);
  const listenerFacts=()=>({navigation:another.webContents.listenerCount('did-start-navigation'),destroyed:another.webContents.listenerCount('destroyed'),gone:another.webContents.listenerCount('render-process-gone'),closed:another.listenerCount('closed')}),baseline=listenerFacts();
  const last=create({...options,window:another,isTrustedUrl(value){if(sealDuringPolicy)last.seal();return value===url;}});sources.push(last);last.activate();const lastBirth=read(last);sealDuringPolicy=true;assert.throws(()=>lastBirth.assertCurrent());sealDuringPolicy=false;await last.drain();assert.deepEqual(listenerFacts(),baseline);cases.lastSdkSealDenied=true;
  let release;const held=new Promise(yes=>{release=yes;});inventoryOverride=()=>held;
  const unsafe=create({...options,window:another});sources.push(unsafe);expectedNegative.add(unsafe);assert.throws(()=>unsafe.activate());let settled=false;const drain=unsafe.drain().then(()=>{settled=true;},()=>{settled=true;});
  try{await delay(20);assert.equal(settled,false);}finally{inventoryOverride=undefined;release();await drain;}
  cases.knownNativeRawJoined=true;
  const faultErrors=[];
  try{
   const originalOff=another.off;let reentrant,nested,once=false;
   another.off=function(...args){if(!once){once=true;nested=reentrant.drain();}return Reflect.apply(originalOff,this,args);};
   try{reentrant=create({...options,window:another,isTrustedUrl:value=>value===url});sources.push(reentrant);reentrant.activate();}finally{another.off=originalOff;}
   const closing=reentrant.drain();await closing;assert.equal(nested,closing);cases.closePublishedBeforeNativeOff=true;
  }catch(error){error.case='closePublishedBeforeNativeOff';faultErrors.push(error);}
  try{
   let release;const sidecar=new Promise(yes=>{release=yes;}),failure=Error('actual Native inventory wrapper failure',{cause:{sidecar}});
   inventoryOverride=()=>{Reflect.apply(originalWindows,BrowserWindow,[]);throw failure;};
   const failed=create({...options,window:another,isTrustedUrl:value=>value===url});sources.push(failed);expectedNegative.add(failed);assert.throws(()=>failed.activate(),error=>error===failure);inventoryOverride=undefined;
   let settled=false,healthy=false;const closing=failed.drain().then(()=>{healthy=true;settled=true;},()=>{settled=true;});
   try{await delay(20);assert.equal(settled,false);}finally{release();await closing;}
   assert.equal(healthy,false);cases.thrownNativeCauseJoinedAndNegative=true;
  }catch(error){error.case='thrownNativeCauseJoinedAndNegative';faultErrors.push(error);}
  try{
   const loading=another.loadFile(html);
   try{assert.equal(another.webContents.isLoading(),true);const pending=create({...options,window:another,isTrustedUrl:value=>value===url});sources.push(pending);assert.throws(()=>pending.activate());}
   finally{await loading;await waitReady(another);}
   cases.loadingNativeWindowDenied=true;
  }catch(error){error.case='loadingNativeWindowDenied';faultErrors.push(error);}
  try{
   const baseline=another.listenerCount('closed'),partial=create({...options,window:another,isTrustedUrl:value=>value===url});sources.push(partial);let closing;
   another.once('newListener',event=>{if(event==='closed')closing=partial.drain();});
   assert.throws(()=>partial.activate());assert.ok(closing);await closing;assert.equal(another.listenerCount('closed'),baseline);cases.partialOnDrainRemovesActualListener=true;
  }catch(error){error.case='partialOnDrainRemovesActualListener';faultErrors.push(error);}
  try{
   let getters=0,activated=false;const fakeSession={},fakeContents={get id(){getters++;throw Error('fake contents id');}},fakeWindow={get id(){getters++;throw Error('fake window id');},get webContents(){getters++;throw Error('fake contents');}};
   const forged=create({...options,window:fakeWindow,isTrustedUrl:value=>value===url});sources.push(forged);const originalGet=Reflect.get,beforeNative=nativeCalls;
   Reflect.get=function(receiver,key,...args){
    if(receiver===app&&key==='isReady')return()=>true;
    if(receiver===BrowserWindow){if(key==='getAllWindows')return()=>[fakeWindow];if(key==='fromId'||key==='fromWebContents')return()=>fakeWindow;}
    if(receiver===fakeWindow){if(key==='id')return 1;if(key==='webContents')return fakeContents;if(key==='isDestroyed')return()=>false;if(key==='on'||key==='off')return()=>fakeWindow;}
    if(receiver===fakeContents){if(key==='id')return 2;if(key==='session')return fakeSession;if(key==='isDestroyed'||key==='isLoading')return()=>false;if(key==='getURL')return()=>url;if(key==='on'||key==='off')return()=>fakeContents;}
    if(key==='fromId')return()=>fakeContents;
    return Reflect.apply(originalGet,Reflect,[receiver,key,...args]);
   };
   try{try{forged.activate();activated=true;}catch{}}finally{Reflect.get=originalGet;}
   nativeFacts.lateReflectGet={activated,getters,nativeQueries:nativeCalls-beforeNative};assert.equal(activated,false);assert.equal(getters,0);cases.lateReflectGetCannotForgeNative=true;
  }catch(error){error.case='lateReflectGetCannotForgeNative';faultErrors.push(error);}
  try{
   let release;const sidecar=new Promise(yes=>{release=yes;});inventoryOverride=()=>[...Reflect.apply(originalWindows,BrowserWindow,[]),sidecar];
   const invalid=create({...options,window:another,isTrustedUrl:value=>value===url});sources.push(invalid);expectedNegative.add(invalid);assert.throws(()=>invalid.activate());inventoryOverride=undefined;let recovered=false;
   try{invalid.activate();recovered=true;}catch{}
   nativeFacts.invalidInventoryRetry={recovered};let settled=false;const closing=invalid.drain().then(()=>{settled=true;},()=>{settled=true;});
   try{await delay(20);assert.equal(recovered,false);assert.equal(settled,false);}finally{release();await closing;}
   cases.invalidInventoryCannotRearm=true;
  }catch(error){error.case='invalidInventoryCannotRearm';faultErrors.push(error);}
  try{
   inventoryOverride=()=>{Reflect.apply(originalWindows,BrowserWindow,[]);return Object.defineProperty([],Symbol('not-an-index'),{value:another});};
   const hidden=create({...options,window:another,isTrustedUrl:value=>value===url});sources.push(hidden);expectedNegative.add(hidden);let activated=false;
   try{hidden.activate();activated=true;}catch{}finally{inventoryOverride=undefined;}
   nativeFacts.symbolInventory={activated};assert.equal(activated,false);cases.nativeInventoryUsesOnlyOwnIndices=true;
  }catch(error){error.case='nativeInventoryUsesOnlyOwnIndices';faultErrors.push(error);}
  if(faultErrors.length)throw new AggregateError(faultErrors,'preparation_native_fault_cases_failed');
  assert.equal(typeof acquireLease,'function');
  const leased=create({...options,window:another,isTrustedUrl:value=>value===url});sources.push(leased);leased.activate();
  const lease=acquireLease(leased),beforeLocal=nativeCalls,settlement=readSettlement(leased,lease);
  assert.equal(readSettlement(leased,lease),settlement);assert.equal(Object.isFrozen(settlement),true);assert.equal(Object.getPrototypeOf(settlement),null);settlement.assertKnown();await settlement.waitKnown();assert.equal(nativeCalls,beforeLocal);
  leaseLocal(leased,lease);assert.equal(nativeCalls,beforeLocal);
  let leaseGetters=0;const fakeLease=new Proxy({},{get(){leaseGetters++;throw Error('foreign lease getter');},getPrototypeOf(){leaseGetters++;throw Error('foreign lease prototype');}});
  assert.throws(()=>leaseCurrent(leased,fakeLease));assert.throws(()=>leaseCurrent({...leased},lease));assert.throws(()=>leaseCurrent(leased,{...lease}));assert.throws(()=>releaseLease(leased,fakeLease));assert.throws(()=>readSettlement(leased,fakeLease));assert.throws(()=>readSettlement({...leased},lease));assert.throws(()=>readSettlement(leased,{...lease}));assert.equal(leaseGetters,0);cases.observationLeaseMembershipFirst=true;cases.settlementMembershipIsPure=true;
  const installed=listenerFacts();leased.seal();let leaseDrainSettled=false;
  const leaseDrain=leased.drain();assert.equal(leased.drain(),leaseDrain);leaseDrain.then(()=>{leaseDrainSettled=true;});
  await delay(20);assert.equal(leaseDrainSettled,false);assert.deepEqual(listenerFacts(),installed);
  assert.throws(()=>acquireLease(leased));assert.throws(()=>read(leased));leaseCurrent(leased,lease);cases.acceptedObservationSurvivesNormalSeal=true;
  await settlement.waitKnown();settlement.assertKnown();assert.equal(leaseDrainSettled,false);cases.settlementKnownDoesNotWaitAcceptedCompletion=true;
  releaseLease(leased,lease);await leaseDrain;assert.equal(leaseDrainSettled,true);assert.throws(()=>leaseLocal(leased,lease));assert.throws(()=>releaseLease(leased,lease));assert.throws(()=>settlement.assertKnown());assert.throws(()=>readSettlement(leased,lease));await assert.rejects(settlement.waitKnown());cases.observationDrainWaitsLease=true;
  const revoked=create({...options,window:another,isTrustedUrl:value=>value===url});sources.push(revoked);revoked.activate();const oldLease=acquireLease(revoked),oldSettlement=readSettlement(revoked,oldLease);revoked.seal();const revokedDrain=revoked.drain();
  await another.loadFile(html);await waitReady(another);assert.throws(()=>leaseLocal(revoked,oldLease));assert.throws(()=>leaseCurrent(revoked,oldLease));const fateCalls=nativeCalls;oldSettlement.assertKnown();await oldSettlement.waitKnown();assert.equal(nativeCalls,fateCalls);cases.settlementSurvivesRevocationWithoutEffect=true;releaseLease(revoked,oldLease);await revokedDrain;cases.navigationRevokesAcceptedObservation=true;
  let sealingAcquisition=false,sealedAcquisition;
  sealedAcquisition=create({...options,window:another,isTrustedUrl(value){if(sealingAcquisition)sealedAcquisition.seal();return value===url;}});sources.push(sealedAcquisition);sealedAcquisition.activate();sealingAcquisition=true;
  assert.throws(()=>acquireLease(sealedAcquisition));await sealedAcquisition.drain();cases.reentrantSealCannotAcceptNewObservation=true;
  const originalOn=another.on,closedBeforeLateOn=another.listenerCount('closed');let releaseLateOn;
  const lateOnGate=new Promise(yes=>{releaseLateOn=yes;}),lateOn=create({...options,window:another,isTrustedUrl:value=>value===url});sources.push(lateOn);expectedNegative.add(lateOn);
  another.on=function(...args){if(args[0]==='closed')return lateOnGate.then(()=>{Reflect.apply(originalOn,this,args);});return Reflect.apply(originalOn,this,args);};
  try{assert.throws(()=>lateOn.activate());}finally{another.on=originalOn;}
  let lateOnDrainSettled=false;const lateOnClosing=lateOn.drain().then(()=>{lateOnDrainSettled=true;},()=>{lateOnDrainSettled=true;});
  try{await delay(20);assert.equal(lateOnDrainSettled,false);}finally{releaseLateOn();await lateOnClosing;}
  assert.equal(another.listenerCount('closed'),closedBeforeLateOn);cases.lateNativeOnSettlesBeforeOwnedOff=true;
  const knownErrorSource=create({...options,window:another,isTrustedUrl:value=>value===url});sources.push(knownErrorSource);expectedNegative.add(knownErrorSource);knownErrorSource.activate();
  const knownErrorLease=acquireLease(knownErrorSource),knownErrorFate=readSettlement(knownErrorSource,knownErrorLease);let releaseKnown;
  const knownRaw=new Promise(yes=>{releaseKnown=yes;});inventoryOverride=()=>knownRaw;
  try{assert.throws(()=>leaseCurrent(knownErrorSource,knownErrorLease));}finally{inventoryOverride=undefined;}
  let fateDone=false;const knownWaiting=knownErrorFate.waitKnown().then(()=>{fateDone=true;});
  try{await delay(20);assert.equal(fateDone,false);assert.throws(()=>knownErrorFate.assertKnown());}finally{releaseKnown();}
  await knownWaiting;knownErrorFate.assertKnown();assert.throws(()=>leaseCurrent(knownErrorSource,knownErrorLease));releaseLease(knownErrorSource,knownErrorLease);await assert.rejects(knownErrorSource.drain(),/UNCONFIRMED/);cases.settlementWaitsRawAndKeepsKnownError=true;
  const unknownSource=create({...options,window:another,isTrustedUrl:value=>value===url});sources.push(unknownSource);expectedNegative.add(unknownSource);unknownSource.activate();const unknownLease=acquireLease(unknownSource),unknownFate=readSettlement(unknownSource,unknownLease);
  inventoryOverride=()=>({then(){throw Error('opaque then must not run');}});
  try{assert.throws(()=>leaseCurrent(unknownSource,unknownLease));}finally{inventoryOverride=undefined;}
  assert.throws(()=>unknownFate.assertKnown(),/UNCONFIRMED/);await assert.rejects(unknownFate.waitKnown(),/UNCONFIRMED/);assert.throws(()=>leaseLocal(unknownSource,unknownLease));releaseLease(unknownSource,unknownLease);await assert.rejects(unknownSource.drain(),/UNCONFIRMED/);cases.settlementUnknownNeverBecomesKnown=true;
  // Source cleanup must restore every listener it installed on the original
  // window; the window is already destroyed, so no late SDK query is used.
  cases.noBusinessSidecars=true;
 }catch(error){bodyError=error;}
 finally{inventoryOverride=undefined;app.isReady=originalReady;BrowserWindow.getAllWindows=originalWindows;}
 for(const source of sources)try{source.seal();}catch(error){cleanupErrors.push(error);}
 for(const source of sources)try{await source.drain();}catch(error){if(!expectedNegative.has(source)||!String(error).includes('PREPARATION_NATIVE_SOURCE_UNCONFIRMED'))cleanupErrors.push(error);}
 for(const window of windows)try{if(!window.isDestroyed())window.destroy();}catch(error){cleanupErrors.push(error);}
 publish({ready:true,processPid:process.pid,nativeAppReady:app.isReady(),cases,nativeFacts,nativeCalls,ownedBusinessProcesses:0,cleanupErrors:cleanupErrors.map(String),error:bodyError?String(bodyError):undefined,errorCases:bodyError?.errors?.map(error=>({case:error.case,error:String(error)})),stack:bodyError?.stack,qualification:'isolated actual Electron availability only; no product Main/B/Host grant'});
}).catch(error=>{console.error(error);try{publish({ready:true,processPid:process.pid,error:String(error),stack:error.stack});}catch(publishError){console.error(publishError);}});
