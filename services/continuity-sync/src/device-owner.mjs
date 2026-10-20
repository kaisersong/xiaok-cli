import {createDeviceOwnedOutbox} from './outbox.mjs';
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {AsyncResource} from 'node:async_hooks';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import sodium from 'libsodium-wrappers';
import {base64,canonical,exactObject,hash,hashBytes,identifier,integer,openEnvelope,parseCanonical,unbase64,unwrapKeyManifest} from './crypto.mjs';
import {validateCoordinatorIdentity} from './identity.mjs';
import {AuthorityJournal,journalCommitment} from './journal.mjs';
import {createOriginalCoordinatorClient,callOriginalCoordinatorClient as originalCall,headOriginalCoordinatorClient as originalHead,closeOriginalCoordinatorClient as originalClose,drainOriginalCoordinatorClient as originalDrain} from './transport.mjs';
import {fetchVerifiedScope} from './sync-driver.mjs';
import {claimDeviceNamespace,assertDeviceNamespace,assertSupportedDeviceJobData} from '../../continuity-device/src/device-lock.mjs';
import {openOsCredentialBackend,originalCredentialChannel} from '../../continuity-device/src/os-backend.mjs';
import {deviceOsAccountId,openOsOutboxGuard,openTestOsOutboxGuard} from '../../continuity-device/src/os-guard.mjs';
await sodium.ready;

const unavailable=()=>new Error('device_owner_unavailable');
const shutdownScope=AsyncResource.prototype.runInAsyncScope,destroyScope=AsyncResource.prototype.emitDestroy;
const journalVerify=AuthorityJournal.prototype.assertReplayCurrent,journalHead=AuthorityJournal.prototype.head,journalGet=AuthorityJournal.prototype.get,journalTransact=AuthorityJournal.prototype.transact,journalRead=AuthorityJournal.prototype.readJournal,journalClose=AuthorityJournal.prototype.close;
let claimOutboxBinding,claimTransportBinding,assertIncomingBinding,assertStoreAnchorBinding,assertSourceControlsBinding,canonicalOutboxPlan,canonicalOutboxPayload,canonicalOutboxArm,canonicalMainReady;
const NativePromise=Promise,then=Promise.prototype.then;
let originalMain,originalMainFailed=false;
if(process.platform==='darwin'&&process.arch==='arm64'&&process.type==='browser'&&process.versions.electron==='39.8.10'&&process.versions.node==='22.22.1'&&process.env.ELECTRON_RUN_AS_NODE!=='1'){
 const {app}=await import('electron'),getAppPath=app.getAppPath,root=Reflect.apply(getAppPath,app,[]),packaged=app.isPackaged,resources=process.resourcesPath;
 const services=packaged?path.join(resources,'services'):path.resolve(root,'..','services');
 if(fileURLToPath(import.meta.url)!==path.join(services,'continuity-sync/src/device-owner.mjs'))throw new Error('desktop_sync_runtime_unqualified');
 const pending=import(pathToFileURL(path.join(root,'dist/main/desktop/electron/context-continuity/sync-canonical-source-friend.js')).href);
 // Consume unhandled rejection only; readiness still awaits this exact rejecting Promise.
 void pending.catch(()=>{});originalMain={app,getAppPath,root,packaged,resources,pending};
}
function assertPinnedCanonicalMain(){
 const main=originalMain;
 if(originalMainFailed||!main||Reflect.apply(main.getAppPath,main.app,[])!==main.root||main.app.isPackaged!==main.packaged||process.resourcesPath!==main.resources){originalMainFailed=true;throw unavailable();}
 return main;
}
const clone=value=>parseCanonical(Buffer.from(canonical(value)));
const same=(a,b)=>a.length===b.length&&timingSafeEqual(a,b);
const sameStored=(a,b)=>a===undefined||b===undefined?a===b:canonical(a)===canonical(b);
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function incomingFingerprint(value){return hash({status:value.status,identityHash:value.identityHash,rootKeyId:value.rootKeyId,syncGroupId:value.syncGroupId,deviceId:value.deviceId,logicalProfileId:value.logicalProfileId,head:value.head,control:{membershipHash:value.control.membershipHash,keyManifestHash:value.control.keyManifestHash,revocationHead:value.control.revocationHead,revocationHashes:value.control.revocations.map(record=>hash(record))},scopes:value.scopes.map(scope=>hash(scope))});}
function incomingData(value){
 assertSupportedDeviceJobData(value);let nodes=0;
 const visit=(item,depth)=>{if(item&&typeof item==='object'){if(++nodes>8000||depth>30)throw new Error('incoming_limit');for(const child of Object.values(item))visit(child,depth+1);}};visit(value,0);
}
export function deviceJournalIdentity(identity,deviceId){identity=validateCoordinatorIdentity(identity).identity;identifier(deviceId);return {schemaVersion:1,purpose:'device-local-journal-v1',identityHash:hash(identity),deviceId};}
export function deviceVaultAccountId(identity,deviceId){identity=validateCoordinatorIdentity(identity).identity;identifier(deviceId);return hash(['xiaok/context-sync/device-key-vault/v1',identity.rootKeyId,identity.syncGroupId,deviceId]);}
export function deviceRegistrationCommitment(row){exactObject(row,['deviceId','logicalProfileId','signingPublicKey','encryptionPublicKey']);identifier(row.deviceId);identifier(row.logicalProfileId);unbase64(row.signingPublicKey,32);unbase64(row.encryptionPublicKey,32);return hash(['xiaok/context-sync/device-registration/v1',row]);}
function checkOptions(options){
 const allowed=['identity','deviceId','logicalProfileId','baseUrl','ca','stateDir','witnessDir'];
 if(!options||![Object.prototype,null].includes(Object.getPrototypeOf(options))||Object.getOwnPropertySymbols(options).length)throw unavailable();
 for(const [key,descriptor]of Object.entries(Object.getOwnPropertyDescriptors(options)))if(!allowed.includes(key)||!descriptor.enumerable||!('value'in descriptor))throw unavailable();
 for(const key of allowed.filter(key=>key!=='ca'))if(!Object.hasOwn(options,key))throw unavailable();
}

/** Existing credentials only. No public key-provider, enrollment or canonical import authority. */
class DeviceSyncOwner{
 #canonicalJob;
 #identity;#deviceId;#profile;#testOnly;#lease;#vaultBackend;#floorBackend;#vaultChannel;#vaultBytes;#guard;#journal;#client;
 #sign;#box;#registration;#closed=false;#poisoned=false;#busy=false;#closing;#generation=0;#receipts=new WeakMap();#current;
 #shutdown=new AsyncResource('xiaok-device-owner-shutdown');#released=false;
 #storePin;#storeWriting=false;#pendingClient;#boundClient;
 #outbox;#boundBox;#pendingBox;#publication;#outgoingActive=false;#incomingReceipts=new WeakMap();#anchorReceipts=new WeakMap();
 #sourceControls=new WeakMap();
 static {
  claimTransportBinding=(owner,client,options)=>{
   if(!owner||typeof owner!=='object'||!(#pendingClient in owner))throw new Error('verified_device_owner_required');
   const pending=owner.#pendingClient;
   if(!pending||pending.claimed||owner.#boundClient||options.identity!==owner.#identity||options.deviceId!==owner.#deviceId||options.signingKey!==owner.#sign.privateKey)throw new Error('verified_device_owner_required');
   pending.claimed=true;owner.#boundClient=client;
   return (route,body)=>{
    if(owner.#client!==client||owner.#boundClient!==client)throw unavailable();owner.#assert();
    const type=route==='/v1/key-use/consume'?body.body?.header?.eventType:route==='/v1/events/push'?body.body?.envelope?.header?.eventType:undefined;
    if(!owner.#testOnly&&typeof type==='string'&&type.startsWith('canonical-'))owner.#assertCanonicalSend(route,body);
   };
  };
  assertStoreAnchorBinding=(owner,receipt,testOnly)=>{
   if(!owner||typeof owner!=='object'||!(#anchorReceipts in owner)||owner.#testOnly!==testOnly)throw unavailable();
   owner.#assertStoreAnchor(receipt);
  };
  assertIncomingBinding=(owner,receipt,testOnly)=>{
   if(!owner||typeof owner!=='object'||!(#incomingReceipts in owner)||owner.#testOnly!==testOnly)throw unavailable();
   owner.#assertIncoming(receipt);
  };
  assertSourceControlsBinding=(owner,receipt,testOnly)=>{
   if(!owner||typeof owner!=='object'||!(#sourceControls in owner)||owner.#testOnly!==testOnly)throw unavailable();
   owner.#assertSourceControls(receipt);
  };
  canonicalMainReady=async owner=>{if(!owner||typeof owner!=='object'||!(#canonicalJob in owner)||owner.#testOnly)throw unavailable();const main=assertPinnedCanonicalMain();await main.pending;assertPinnedCanonicalMain();owner.#assert();};
  canonicalOutboxPlan=(owner,box,cap)=>{if(!owner||typeof owner!=='object'||!(#canonicalJob in owner)||owner.#boundBox!==box||owner.#canonicalJob?.cap!==cap)throw unavailable();return owner.#canonicalPlan();};
  canonicalOutboxPayload=(owner,box,cap)=>{if(!owner||typeof owner!=='object'||!(#canonicalJob in owner)||owner.#boundBox!==box||owner.#canonicalJob?.cap!==cap)throw unavailable();return owner.#canonicalPayload();};
  canonicalOutboxArm=(owner,box,cap,route,body,options)=>{if(!owner||typeof owner!=='object'||!(#canonicalJob in owner)||owner.#boundBox!==box||owner.#canonicalJob?.cap!==cap)throw unavailable();owner.#armCanonicalSend(route,body,options);};
  claimOutboxBinding=(owner,box,options)=>{
   if(!owner||typeof owner!=='object'||!(#pendingBox in owner))throw new Error('verified_device_owner_required');
   const pending=owner.#pendingBox;
   if(!pending||pending.claimed||owner.#boundBox||options.journal!==owner.#journal||options.guard!==owner.#guard||options.keyProvider!==pending.provider||options.testOnly!==owner.#testOnly||canonical(options.coordinatorIdentity)!==canonical(owner.#identity))throw new Error('verified_device_owner_required');
   pending.claimed=true;owner.#boundBox=box;
  };
 }

 constructor(options,testOptions,testOnly){
  try{
  checkOptions(options);this.#identity=validateCoordinatorIdentity(options.identity).identity;this.#deviceId=options.deviceId;this.#profile=options.logicalProfileId;this.#testOnly=testOnly;
  identifier(this.#deviceId);identifier(this.#profile);
  if(this.#identity.certificate.body.deploymentMode!==(testOnly?'test':'self-hosted'))throw unavailable();
   this.#lease=claimDeviceNamespace({identity:this.#identity,deviceId:this.#deviceId,...(testOnly?{testRegistryDir:testOptions.testRegistryDir}:{})});
   const open=accountId=>testOnly?testOptions.backendFactory(accountId):openOsCredentialBackend({accountId});
   const vaultAccount=deviceVaultAccountId(this.#identity,this.#deviceId);this.#vaultBackend=open(vaultAccount);
   this.#vaultChannel=originalCredentialChannel(this.#vaultBackend,{accountId:vaultAccount,testOnly});
   this.#vaultBytes=this.#vaultChannel.read();if(!(this.#vaultBytes instanceof Uint8Array))throw unavailable();
   const record=parseCanonical(this.#vaultBytes);exactObject(record,['schemaVersion','identityHash','deviceId','logicalProfileId','signingSeed','boxPrivateKey','registrationCommitment']);
   if(record.schemaVersion!==1||record.identityHash!==hash(this.#identity)||record.deviceId!==this.#deviceId||record.logicalProfileId!==this.#profile)throw unavailable();
   const seed=unbase64(record.signingSeed,32);
   try{this.#sign=sodium.crypto_sign_seed_keypair(seed);}finally{seed.fill(0);}
   const privateKey=unbase64(record.boxPrivateKey,32);this.#box={privateKey,publicKey:sodium.crypto_scalarmult_base(privateKey)};
   this.#registration=deviceRegistrationCommitment({deviceId:this.#deviceId,logicalProfileId:this.#profile,signingPublicKey:base64(this.#sign.publicKey),encryptionPublicKey:base64(this.#box.publicKey)});
   if(this.#registration!==record.registrationCommitment)throw unavailable();
   this.#journal=new AuthorityJournal({stateDir:options.stateDir,witnessDir:options.witnessDir,identity:deviceJournalIdentity(this.#identity,this.#deviceId)});
   // The original journal constructor has just verified its complete hash chain
   // and materialized controls. Lock in these verified store facts before any
   // native callback; later live control-row edits cannot become a fresh pin.
   const binding=journalGet.call(this.#journal,'canonical-store-binding'),stored=journalGet.call(this.#journal,'canonical-store-head');
   this.#rememberStorePin(binding,stored,typeof stored?.stageKey==='string'?journalGet.call(this.#journal,stored.stageKey):undefined);
   this.#floorBackend=open(deviceOsAccountId(this.#identity,this.#deviceId));
   this.#guard=(testOnly?openTestOsOutboxGuard:openOsOutboxGuard)({identity:this.#identity,deviceId:this.#deviceId,lease:this.#lease,backend:this.#floorBackend});
   this.#assert();
   const pin=journalGet.call(this.#journal,'crypto-coordinator-pin');
   if(pin===undefined){if(journalHead.call(this.#journal).sequence!==0)throw unavailable();this.#commit('crypto_pin_coordinator',{identityHash:hash(this.#identity)},tx=>tx.set('crypto-coordinator-pin',hash(this.#identity)));}
   else if(pin!==hash(this.#identity))throw unavailable();
   if(journalGet.call(this.#journal,'verified-control-floor')===undefined&&journalHead.call(this.#journal).sequence!==1)throw unavailable();
   this.#pendingClient={claimed:false};
   try{this.#client=createOriginalCoordinatorClient({baseUrl:options.baseUrl,identity:this.#identity,deviceId:this.#deviceId,signingKey:this.#sign.privateKey,ca:options.ca,owner:this});if(!this.#pendingClient.claimed||this.#boundClient!==this.#client)throw unavailable();}finally{this.#pendingClient=undefined;}
   const provider=()=>this.#outboxContext();this.#pendingBox={provider,claimed:false};
   try{this.#outbox=createDeviceOwnedOutbox(this,{journal:this.#journal,guard:this.#guard,keyProvider:provider,coordinatorIdentity:this.#identity,testOnly:this.#testOnly});}finally{this.#pendingBox=undefined;}
   Object.freeze(this);
  }catch{this.#release();throw unavailable();}
 }
 get kind(){return this.#testOnly?'test-only-device-owner':'os-device-owner';}
 #eraseCanonicalKeys(){const job=this.#canonicalJob;if(!job)return;job.ready=false;job.send=undefined;for(const item of job.entries.values()){item.keys.contentKey.fill(0);item.keys.salt.fill(0);}job.entries.clear();}
 #eraseCurrent(){this.#eraseCanonicalKeys();this.#current?.keys.contentKey.fill(0);this.#current?.keys.salt.fill(0);this.#current=undefined;this.#receipts=new WeakMap();this.#incomingReceipts=new WeakMap();this.#anchorReceipts=new WeakMap();this.#sourceControls=new WeakMap();this.#generation++;}
 #eraseMaster(){this.#vaultBytes?.fill(0);this.#sign?.privateKey.fill(0);this.#box?.privateKey.fill(0);}
 #release(){if(this.#released)return;this.#released=true;this.#eraseMaster();this.#eraseCurrent();if(this.#client)originalClose.call(this.#client);this.#guard?.close();this.#vaultBackend?.close();this.#floorBackend?.close();if(this.#journal)journalClose.call(this.#journal);this.#lease?.close();destroyScope.call(this.#shutdown);}
 #assert(){
  let raw;
  try{
   if(this.#closed||this.#poisoned)throw unavailable();
   assertDeviceNamespace(this.#lease,{testOnly:this.#testOnly,exactMode:this.#testOnly?'test':'self-hosted',identityHash:hash(this.#identity),deviceId:this.#deviceId});
   raw=this.#vaultChannel.read();if(!(raw instanceof Uint8Array)||!same(raw,this.#vaultBytes)||canonical(this.#guard.read())!==canonical(journalHead.call(this.#journal)))throw unavailable();
  }catch{this.#poisoned=true;this.#eraseCurrent();throw unavailable();}finally{raw?.fill(0);}
 }
 #commit(kind,request,apply,operationId=randomUUID()){
  this.#assert();const before=journalHead.call(this.#journal);
  journalTransact.call(this.#journal,{operationId,kind,request},tx=>{apply(tx);return null;});
  try{this.#guard.advance(before,journalHead.call(this.#journal));this.#assert();}catch{this.#poisoned=true;this.#eraseCurrent();throw unavailable();}
 }
 async #catchupScopes(scopes,generation,client,action){
  const results=[];let controlHash;
  for(const scope of scopes){
  const minimumHead=journalGet.call(this.#journal,'verified-control-floor')?.head;
  const verified=await fetchVerifiedScope({client,identity:this.#identity,deviceId:this.#deviceId,scope,...(minimumHead?{minimumHead}:{})});this.#assert();
  if(generation!==this.#generation)throw unavailable();
  const membership=verified.membership.body,row=membership.devices.find(row=>row.deviceId===this.#deviceId);
  if(!row||row.state!=='active'||row.logicalProfileId!==this.#profile||row.signingPublicKey!==base64(this.#sign.publicKey)||row.encryptionPublicKey!==base64(this.#box.publicKey)||deviceRegistrationCommitment({deviceId:row.deviceId,logicalProfileId:row.logicalProfileId,signingPublicKey:row.signingPublicKey,encryptionPublicKey:row.encryptionPublicKey})!==this.#registration)throw unavailable();
  let keys;
  try{
   keys=unwrapKeyManifest({manifest:verified.keyManifest,membership,expected:{rootKeyId:this.#identity.rootKeyId,syncGroupId:this.#identity.syncGroupId,membershipEpoch:membership.membershipEpoch,keyEpoch:membership.keyEpoch,contentEpoch:verified.keyManifest.contentEpoch,membershipHash:hash(membership)},rootPublicKey:unbase64(this.#identity.rootPublicKey,32),deviceId:this.#deviceId,encryptionPublicKey:this.#box.publicKey,encryptionPrivateKey:this.#box.privateKey});
   this.#assert();
   const floor={head:verified.head,membershipHash:hash(membership),keyManifestHash:hash(verified.keyManifest),revocationHead:verified.revocations.at(-1)?{sequence:verified.revocations.at(-1).body.sequence,hash:hash(verified.revocations.at(-1).body)}:{sequence:0,hash:'0'.repeat(64)}};
   const nextControlHash=hash(floor);if(controlHash!==undefined&&controlHash!==nextControlHash)throw new Error('head_changed');controlHash=nextControlHash;
   this.#commit('device_verified_control',{scope,floor},tx=>{
    tx.set('verified-control-floor',floor);
    // Preserve the complete verified revocation chain before any future body publication.
    for(const rev of verified.revocations)tx.set('verified-revocation:'+rev.body.sequence,rev);
   });
   if(generation!==this.#generation)throw unavailable();
   const receipt=freeze({status:'verified-control-only',scope:clone(scope),head:clone(verified.head),membershipHash:floor.membershipHash,keyManifestHash:floor.keyManifestHash});
   this.#current={generation,scope,verified,keys};this.#receipts.set(receipt,{generation,headHash:hash(verified.head)});
   results.push(await action(receipt,verified));this.#assert();if(generation!==this.#generation)throw unavailable();
  }finally{keys?.contentKey.fill(0);keys?.salt.fill(0);}
  }
  return results;
 }
 async #runScopes(scopes,requestSource,action,finish=results=>results){
  if(!['user','agent','scheduler'].includes(requestSource))throw new Error('request_source_required');
  if(this.#storeWriting)throw new Error('device_owner_busy');
  this.#assert();if(this.#busy||this.#storeWriting)throw new Error('device_owner_busy');
  if(!Array.isArray(scopes)||scopes.length<1||scopes.length>16)throw new Error('invalid_scope_selection');
  scopes=scopes.map(scope=>{scope=clone(scope);exactObject(scope,['conversationId','branchId']);identifier(scope.conversationId);identifier(scope.branchId);return scope;});
  if(new Set(scopes.map(scope=>canonical(scope))).size!==scopes.length)throw new Error('invalid_scope_selection');
  this.#busy=true;this.#eraseCurrent();const generation=this.#generation;
  try{const result=await this.#lease.run(async()=>{
   const client={
    getHead:async options=>{this.#assert();const result=await originalHead.call(this.#client,options);this.#assert();return result;},
    call:async(route,body,options)=>{this.#assert();const result=await originalCall.call(this.#client,route,body,{...options,requestSource});this.#assert();return result;},
   };
   const results=await this.#catchupScopes(scopes,generation,client,action);this.#assert();if(generation!==this.#generation)throw unavailable();
   const finished=finish(results,client);
   // Inspect synchronous DATA before await can assimilate an own `then`.
   // The only asynchronous finish is this owner's private canonical routine.
   if(!(finished instanceof NativePromise))assertSupportedDeviceJobData(finished);
   const result=await finished;assertSupportedDeviceJobData(result);this.#assert();if(generation!==this.#generation)throw unavailable();return result;
  });this.#assert();if(generation!==this.#generation)throw unavailable();return result;}catch(error){this.#eraseCurrent();throw error;}finally{this.#busy=false;}
 }

 async #runScope(scope,requestSource,action){const results=await this.#runScopes([scope],requestSource,action);return results[0];}

 sync(scope,{requestSource}={}){return this.#runScope(scope,requestSource,receipt=>receipt);}
 /** Complete root-verified writer/control FACT only; no body or export authority. */
 async captureCanonicalSourceControls(scopes,{requestSource}={}){
  let generation;
  const selected=await this.#runScopes(scopes,requestSource,(_receipt,verified)=>{
   generation??=this.#generation;if(generation!==this.#generation)throw unavailable();
   const grant=verified.scope.body;
   if(grant.ownerDeviceId!==this.#deviceId||grant.logicalProfileId!==this.#profile)throw new Error('canonical_source_writer_required');
   const floor={head:clone(verified.head),membershipHash:hash(verified.membership.body),keyManifestHash:hash(verified.keyManifest),revocationHead:verified.revocations.at(-1)?{sequence:verified.revocations.at(-1).body.sequence,hash:hash(verified.revocations.at(-1).body)}:{sequence:0,hash:'0'.repeat(64)}};
   return {scope:{conversationId:grant.conversationId,branchId:grant.branchId},grant:clone(grant),grantHash:hash(verified.scope),floor};
  });
  this.#assert();if(this.#busy||generation!==this.#generation||!selected.length)throw unavailable();
  const floor=selected[0].floor;
  if(selected.some(item=>hash(item.floor)!==hash(floor)))throw unavailable();
  const result=freeze({status:'verified-canonical-source-control-only',identityHash:hash(this.#identity),rootKeyId:this.#identity.rootKeyId,syncGroupId:this.#identity.syncGroupId,deviceId:this.#deviceId,logicalProfileId:this.#profile,head:clone(floor.head),control:clone(floor),scopes:selected.map(({floor:_,...item})=>item)});
  this.#sourceControls.set(result,{generation:this.#generation,receiptHash:hash(result),controlHash:hash(floor)});this.#assertSourceControls(result);return result;
 }
 #assertSourceControls(receipt,writing=false){
  const original=this.#sourceControls.get(receipt);if(!original)throw unavailable();this.#assert();
  if(this.#busy||this.#storeWriting&&!writing||original.generation!==this.#generation||!this.#current||hash(this.#current.verified.head)!==hash(receipt.head)||hash(receipt)!==original.receiptHash||hash(journalGet.call(this.#journal,'verified-control-floor'))!==original.controlHash)throw unavailable();
  this.#assert();const finalControl=journalGet.call(this.#journal,'verified-control-floor');
  if(hash(finalControl)!==original.controlHash||original.generation!==this.#generation||this.#sourceControls.get(receipt)!==original)throw unavailable();
 }
 async captureCanonicalScopes(scopes,{requestSource}={}){
  let generation,fingerprint,failureCode,result,totalBytes=0;
  try{result=await this.#runScopes(scopes,requestSource,(_control,verified)=>{
   generation=this.#generation;const membership=verified.membership.body,manifest=verified.keyManifest,quarantined=[];let candidate,nonCanonicalCount=0;
   for(const event of verified.events){
    const header=event.envelope.header;
    if(header.eventType!=='canonical-snapshot-v1'){nonCanonicalCount++;continue;}
    const acceptedScope=event.acceptedScope?.body,origin=event.membership.body.devices.find(row=>row.deviceId===header.originDeviceId);
    const authorized=acceptedScope&&acceptedScope.ownerDeviceId===header.originDeviceId&&acceptedScope.conversationId===header.conversationId&&acceptedScope.branchId===header.branchId&&origin?.state==='active'&&origin.logicalProfileId===acceptedScope.logicalProfileId;
    if(!authorized){quarantined.push({eventHash:event.eventHash,reason:'unauthorized_origin_at_acceptance'});continue;}
    if(header.membershipEpoch!==membership.membershipEpoch||header.keyEpoch!==membership.keyEpoch||header.contentEpoch!==manifest.contentEpoch){quarantined.push({eventHash:event.eventHash,reason:'historical_key_epoch_unavailable'});continue;}
    if(!candidate||event.accepted.journalSequence>candidate.accepted.journalSequence)candidate=event;
   }
   if(!candidate){failureCode='canonical_snapshot_unavailable';throw unavailable();}
   const header=candidate.envelope.header,origin=candidate.membership.body.devices.find(row=>row.deviceId===header.originDeviceId),keys=this.#current.keys;
   // No fallback: the selected latest authorized candidate must authenticate.
   const payload=openEnvelope({envelope:candidate.envelope,contentKey:keys.contentKey,salt:keys.salt,signingPublicKey:unbase64(origin.signingPublicKey,32),expected:header});this.#assert();
   const size=Buffer.byteLength(canonical(payload));totalBytes+=size;if(size>512*1024||totalBytes>8*1024*1024)throw new Error('incoming_limit');
   const depth=(value,at=0)=>{if(value&&typeof value==='object'){if(at>24)throw new Error('incoming_limit');for(const child of Object.values(value))depth(child,at+1);}};depth(payload);
   const chunks=[];for(let i=0;i<quarantined.length;i+=1000)chunks.push(hash(quarantined.slice(i,i+1000)));
   return {scope:clone(verified.scope.body),candidate:{header:clone(header),eventHash:candidate.eventHash,accepted:clone(candidate.accepted),acceptedScope:clone(candidate.acceptedScope),origin:clone(origin),payload},quarantine:{count:quarantined.length,digest:hash(['xiaok/context-sync/quarantine/v1',chunks])},nonCanonicalCount};
  },results=>{
   const floor=journalGet.call(this.#journal,'verified-control-floor');
   const view=freeze({status:'verified-incoming-candidates',identityHash:hash(this.#identity),rootKeyId:this.#identity.rootKeyId,syncGroupId:this.#identity.syncGroupId,deviceId:this.#deviceId,logicalProfileId:this.#profile,head:clone(this.#current.verified.head),control:{membershipHash:floor.membershipHash,keyManifestHash:floor.keyManifestHash,revocationHead:clone(floor.revocationHead),revocations:clone(this.#current.verified.revocations)},scopes:results});
   incomingData(view);fingerprint=incomingFingerprint(view);return view;
  });}catch(error){if(failureCode)throw new Error(failureCode);throw error;}
  this.#assert();if(this.#busy||generation!==this.#generation)throw unavailable();
  this.#incomingReceipts.set(result,{generation,fingerprint,headHash:hash(result.head)});this.#assertIncoming(result);return result;
 }
 #assertIncoming(receipt){
  const original=this.#incomingReceipts.get(receipt);if(!original)throw unavailable();this.#assert();
  if(this.#busy||original.generation!==this.#generation||!this.#current||original.headHash!==hash(this.#current.verified.head)||original.fingerprint!==incomingFingerprint(receipt))throw unavailable();
 }
 #rememberStorePin(binding,stored,fact){this.#storePin={binding:binding===undefined?undefined:clone(binding),stored:stored===undefined?undefined:clone(stored),fact:fact===undefined?undefined:clone(fact)};}
 #stickyState(binding,expectedHash){
  const index=journalGet.call(this.#journal,'canonical-store-sticky-index')??[];
  if(!Array.isArray(index)||index.length>8192||index.some((key,i)=>typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)||i>0&&index[i-1]>=key))throw unavailable();
  const entries=index.map(key=>{
   const fact=journalGet.call(this.#journal,'canonical-store-sticky:'+key);
   if(!fact||this.#stickySubject(fact)!==key)throw unavailable();
   return [key,hash(fact)];
  });
  const digest=hash(['xiaok/context-sync/canonical-store-sticky/v1',binding,entries]);
  if(expectedHash!==undefined&&digest!==expectedHash)throw unavailable();
  return {index,entries,digest};
 }
 #stickySubject(fact){
  if(fact.kind==='dependency'){
   exactObject(fact,['kind','table','taskId','sourceId','revision']);
   if(!['context_dependencies','task_history_dependencies','effect_history_dependencies'].includes(fact.table))throw unavailable();
   identifier(fact.taskId);identifier(fact.sourceId);integer(fact.revision,1);
   return hash(['xiaok/context-sync/sticky-subject/v1',fact.kind,fact.table,fact.taskId,fact.sourceId]);
  }
  exactObject(fact,['kind','id','revision']);
  if(!['grant','scope','message','reference','external-reader'].includes(fact.kind))throw unavailable();
  identifier(fact.id);integer(fact.revision,1);
  return hash(['xiaok/context-sync/sticky-subject/v1',fact.kind,fact.id]);
 }
 #storeState(input){
  this.#assert();assertSupportedDeviceJobData(input);input=clone(input);exactObject(input,['storeId','profileId']);identifier(input.storeId);identifier(input.profileId);
  const expected={schemaVersion:1,identityHash:hash(this.#identity),deviceId:this.#deviceId,logicalProfileId:this.#profile,...input};
  const binding=journalGet.call(this.#journal,'canonical-store-binding'),stored=journalGet.call(this.#journal,'canonical-store-head');
  const fact=typeof stored?.stageKey==='string'?journalGet.call(this.#journal,stored.stageKey):undefined;
  if(!this.#storePin||!sameStored(binding,this.#storePin.binding)||!sameStored(stored,this.#storePin.stored)||!sameStored(fact,this.#storePin.fact))throw unavailable();
  if(binding===undefined){
   if(stored!==undefined||journalGet.call(this.#journal,'canonical-store-sticky-index')!==undefined)throw unavailable();
   return {binding:expected,head:{sequence:0,hash:hash(['xiaok/context-sync/canonical-store-genesis/v1',expected])},stageKey:null,policyHash:null,publicationHash:null,stickyHash:this.#stickyState(expected).digest};
  }
  if(canonical(binding)!==canonical(expected)||!stored)throw unavailable();
  exactObject(stored,['head','stageKey','policyHash','publicationHash','stickyHash']);exactObject(stored.head,['sequence','hash']);integer(stored.head.sequence,1);identifier(stored.stageKey);
  if(!/^[a-f0-9]{64}$/.test(stored.head.hash)||!fact||canonical(fact.head)!==canonical(stored.head))throw unavailable();
  for(const key of ['policyHash','publicationHash'])if(stored[key]!==null&&(typeof stored[key]!=='string'||!/^[a-f0-9]{64}$/.test(stored[key])))throw unavailable();
  if((stored.policyHash===null)!==(stored.publicationHash===null))throw unavailable();
  this.#stickyState(binding,stored.stickyHash);
  return {binding,...stored};
 }
 #issueStoreFact(result,state,incoming,sourceControl){
  result=freeze(result);
  this.#anchorReceipts.set(result,{incoming,sourceControl,generation:this.#generation,stageKey:state.stageKey,recordHash:state.stageKey===null?null:hash(journalGet.call(this.#journal,state.stageKey)),receiptHash:hash(result)});
  this.#assertStoreAnchor(result,true);return result;
 }
 /** OS-anchored state fact only. An unbound genesis does not create a store. */
 getCanonicalStoreAnchor(input){
  if(this.#busy||this.#storeWriting)throw unavailable();
  const state=this.#storeState(input);
  return this.#issueStoreFact({status:'store-anchor-state-only',...clone(state.binding),head:clone(state.head),policyHash:state.policyHash,publicationHash:state.publicationHash,stickyHash:state.stickyHash},state);
 }
 /** First source OS write-ahead FACT. Main must separately prove its original
  * Runtime draft, Store stage and real SQLite COMMIT before any source export. */
 recordCanonicalSourceStoreAnchor(sourceControl,input){
  if(this.#busy||this.#storeWriting)throw unavailable();this.#storeWriting=true;
  try{
   this.#assertSourceControls(sourceControl,true);assertSupportedDeviceJobData(input);input=clone(input);
   exactObject(input,['storeId','profileId','stageId','manifestHash','baseHead']);identifier(input.stageId);exactObject(input.baseHead,['sequence','hash']);integer(input.baseHead.sequence);
   for(const digest of [input.manifestHash,input.baseHead.hash])if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))throw unavailable();
   const state=this.#storeState({storeId:input.storeId,profileId:input.profileId}),core={schemaVersion:1,purpose:'source-bootstrap',binding:state.binding,stageId:input.stageId,manifestHash:input.manifestHash,baseHead:input.baseHead,control:clone(sourceControl.control),scopes:clone(sourceControl.scopes)};
   const stageKey='canonical-store-source:'+hash(['xiaok/context-sync/canonical-store-source/v1',input.storeId,input.profileId,input.stageId]),prior=journalGet.call(this.#journal,stageKey);let fact;
   if(prior!==undefined){
    if(prior.requestHash!==hash(core)||canonical(prior.core)!==canonical(core)||state.stageKey!==stageKey||canonical(state.head)!==canonical(prior.head))throw unavailable();fact=prior;
   }else{
    if(state.stageKey!==null||state.head.sequence!==0||canonical(state.head)!==canonical(input.baseHead))throw unavailable();
    fact={core,requestHash:hash(core),head:{sequence:1,hash:hash(['xiaok/context-sync/canonical-source-store-anchor/v1',core])}};
    const stored={head:fact.head,stageKey,policyHash:null,publicationHash:null,stickyHash:state.stickyHash};this.#assertSourceControls(sourceControl,true);
    this.#commit('device_canonical_source_store_anchor',core,tx=>{
     if(tx.get(stageKey)!==undefined||tx.get('canonical-store-binding')!==undefined||tx.get('canonical-store-head')!==undefined||tx.get('canonical-store-sticky-index')!==undefined)throw unavailable();
     tx.set('canonical-store-binding',state.binding);tx.set(stageKey,fact);tx.set('canonical-store-head',stored);
    },hash(['xiaok/context-sync/canonical-source-store-operation/v1',input.storeId,input.profileId,input.stageId]));
    this.#rememberStorePin(state.binding,stored,fact);
   }
   this.#assertSourceControls(sourceControl,true);
   return this.#issueStoreFact({status:'store-anchor-only',purpose:'source-bootstrap',...clone(state.binding),stageId:input.stageId,manifestHash:input.manifestHash,head:clone(fact.head),verifiedHead:clone(sourceControl.head)},this.#storeState({storeId:input.storeId,profileId:input.profileId}),undefined,sourceControl);
  }finally{this.#storeWriting=false;}
 }
 /** No stage/COMMIT/publication authority: the TS main owner must separately
  * join this fact with the genuine canonical store's private capabilities. */
 recordCanonicalStoreAnchor(incoming,input){
  if(this.#busy||this.#storeWriting)throw unavailable();this.#storeWriting=true;
  try{return this.#recordStoreAnchor(incoming,input);}finally{this.#storeWriting=false;}
 }
 #recordStoreAnchor(incoming,input){
  this.#assertIncoming(incoming);assertSupportedDeviceJobData(input);input=clone(input);
  exactObject(input,['storeId','profileId','stageId','manifestHash','baseHead']);identifier(input.stageId);
  exactObject(input.baseHead,['sequence','hash']);integer(input.baseHead.sequence);
  if(!/^[a-f0-9]{64}$/.test(input.baseHead.hash)||!/^[a-f0-9]{64}$/.test(input.manifestHash))throw unavailable();
  const state=this.#storeState({storeId:input.storeId,profileId:input.profileId});
  const candidates=incoming.scopes.map(item=>({scope:clone(item.scope),eventHash:item.candidate.eventHash,accepted:clone(item.candidate.accepted),acceptedScopeHash:hash(item.candidate.acceptedScope),headerHash:hash(item.candidate.header),payloadHash:hash(item.candidate.payload)})).sort((a,b)=>{const first=canonical(a.scope),second=canonical(b.scope);return first<second?-1:first>second?1:0;});
  const core={schemaVersion:1,binding:state.binding,stageId:input.stageId,manifestHash:input.manifestHash,baseHead:input.baseHead,candidates};
  const stageKey='canonical-store-stage:'+hash(['xiaok/context-sync/canonical-store-stage/v1',input.storeId,input.profileId,input.stageId]),prior=journalGet.call(this.#journal,stageKey);
  let fact;
  if(prior!==undefined){
   if(prior.requestHash!==hash(core)||canonical(prior.core)!==canonical(core)||canonical(state.head)!==canonical(prior.head)||state.stageKey!==stageKey)throw unavailable();fact=prior;
  }else{
   if(canonical(state.head)!==canonical(input.baseHead))throw unavailable();
   fact={core,requestHash:hash(core),head:{sequence:input.baseHead.sequence+1,hash:hash(['xiaok/context-sync/canonical-store-anchor/v1',core])}};integer(fact.head.sequence,1);
   this.#assertIncoming(incoming);
   const operationId=hash(['xiaok/context-sync/canonical-store-operation/v1',input.storeId,input.profileId,input.stageId]);
   const stored={head:fact.head,stageKey,policyHash:state.policyHash,publicationHash:state.publicationHash,stickyHash:state.stickyHash};
   this.#commit('device_canonical_store_anchor',core,tx=>{
    if(tx.get(stageKey)!==undefined||canonical(tx.get('canonical-store-binding')??state.binding)!==canonical(state.binding)||canonical(tx.get('canonical-store-head')?.head??state.head)!==canonical(input.baseHead))throw unavailable();
    tx.set('canonical-store-binding',state.binding);tx.set(stageKey,fact);tx.set('canonical-store-head',stored);
   },operationId);
   this.#rememberStorePin(state.binding,stored,fact);
  }
  this.#assertIncoming(incoming);
  return this.#issueStoreFact({status:'store-anchor-only',...clone(state.binding),stageId:input.stageId,manifestHash:input.manifestHash,candidateHash:hash(candidates),head:clone(fact.head),verifiedHead:clone(incoming.head)},this.#storeState({storeId:input.storeId,profileId:input.profileId}),incoming);
 }
 /** Local policy preparation FACT only. Never proves a canonical SQLite COMMIT,
  * authenticates incoming content, or grants encryption/publication authority. */
 recordCanonicalStorePolicy(input){
  if(this.#busy||this.#storeWriting)throw unavailable();this.#storeWriting=true;
  try{return this.#recordStorePolicy(input);}finally{this.#storeWriting=false;}
 }
 #recordStorePolicy(input){
  this.#assert();assertSupportedDeviceJobData(input);input=clone(input);
  exactObject(input,['storeId','profileId','operationId','baseHead','policyHash','publicationHash','stickyFacts']);identifier(input.operationId);
  exactObject(input.baseHead,['sequence','hash']);integer(input.baseHead.sequence);
  for(const digest of [input.baseHead.hash,input.policyHash,input.publicationHash])if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))throw unavailable();
  if(!Array.isArray(input.stickyFacts)||input.stickyFacts.length>128)throw unavailable();
  const subjects=input.stickyFacts.map(fact=>this.#stickySubject(fact));
  if(new Set(subjects).size!==subjects.length)throw unavailable();
  const state=this.#storeState({storeId:input.storeId,profileId:input.profileId});if(state.stageKey===null)throw unavailable();
  const core={schemaVersion:1,binding:state.binding,operationId:input.operationId,baseHead:input.baseHead,policyHash:input.policyHash,publicationHash:input.publicationHash,stickyFacts:input.stickyFacts};
  const stageKey='canonical-store-policy:'+hash(['xiaok/context-sync/canonical-store-policy/v1',input.storeId,input.profileId,input.operationId]),prior=journalGet.call(this.#journal,stageKey);
  let fact;
  if(prior!==undefined){
   if(prior.requestHash!==hash(core)||canonical(prior.core)!==canonical(core)||canonical(state.head)!==canonical(prior.head)||state.stageKey!==stageKey)throw unavailable();fact=prior;
  }else{
   if(canonical(state.head)!==canonical(input.baseHead))throw unavailable();
   const sticky=this.#stickyState(state.binding,state.stickyHash),entries=new Map(sticky.entries);
   input.stickyFacts.forEach((value,i)=>{
    const previous=journalGet.call(this.#journal,'canonical-store-sticky:'+subjects[i]);
    if(previous&&value.revision<previous.revision)throw unavailable();
    entries.set(subjects[i],hash(value));
   });
   const sorted=[...entries].sort(([a],[b])=>a<b?-1:a>b?1:0);if(sorted.length>8192)throw unavailable();
   const stickyHash=hash(['xiaok/context-sync/canonical-store-sticky/v1',state.binding,sorted]);
   fact={core,requestHash:hash(core),stickyHash,head:{sequence:input.baseHead.sequence+1,hash:hash(['xiaok/context-sync/canonical-store-policy-head/v1',core,stickyHash])}};integer(fact.head.sequence,1);
   const stored={head:fact.head,stageKey,policyHash:input.policyHash,publicationHash:input.publicationHash,stickyHash};
   this.#commit('device_canonical_store_policy',core,tx=>{
    if(tx.get(stageKey)!==undefined||canonical(tx.get('canonical-store-binding'))!==canonical(state.binding)||canonical(tx.get('canonical-store-head')?.head)!==canonical(input.baseHead))throw unavailable();
    input.stickyFacts.forEach((value,i)=>tx.set('canonical-store-sticky:'+subjects[i],value));
    tx.set('canonical-store-sticky-index',sorted.map(([key])=>key));tx.set(stageKey,fact);tx.set('canonical-store-head',stored);
   },hash(['xiaok/context-sync/canonical-store-policy-operation/v1',input.storeId,input.profileId,input.operationId]));
   this.#rememberStorePin(state.binding,stored,fact);
  }
  const current=this.#storeState({storeId:input.storeId,profileId:input.profileId});
  return this.#issueStoreFact({status:'store-anchor-only',purpose:'policy-prepared',...clone(state.binding),operationId:input.operationId,head:clone(fact.head),policyHash:current.policyHash,publicationHash:current.publicationHash,stickyHash:current.stickyHash},current);
 }
 #assertStoreAnchor(receipt,issuing=false){
  const original=this.#anchorReceipts.get(receipt);if(!original||this.#busy||this.#storeWriting&&!issuing)throw unavailable();
  if(original.incoming)this.#assertIncoming(original.incoming);
  if(original.sourceControl)this.#assertSourceControls(original.sourceControl,issuing);
  const state=this.#storeState({storeId:receipt.storeId,profileId:receipt.profileId});
  const fact=original.stageKey===null?null:journalGet.call(this.#journal,original.stageKey);
  if(original.generation!==this.#generation||hash(receipt)!==original.receiptHash||state.stageKey!==original.stageKey||canonical(state.head)!==canonical(receipt.head)||(original.stageKey!==null&&(!fact||hash(fact)!==original.recordHash)))throw unavailable();
  if(original.incoming)this.#assertIncoming(original.incoming);else if(original.sourceControl)this.#assertSourceControls(original.sourceControl,issuing);else this.#assert();
 }
 assertIncomingCurrent(receipt){this.#assertIncoming(receipt);}

 #canonicalCryptoHistory(job){
  journalVerify.call(this.#journal);
  const head=journalHead.call(this.#journal);if(head.sequence>100000)throw new Error('device_publication_history_limit');
  const identity=deviceJournalIdentity(this.#identity,this.#deviceId),rows=new Map(),reservations=new Map();
  let after=0,previousHash=hash(['xiaok/context-sync/authority-genesis/v2',identity]);
  while(after<head.sequence){
   const page=journalRead.call(this.#journal,after,100);if(!page.length)throw unavailable();
   for(const entry of page){
    if(entry.schemaVersion!==2||entry.sequence!==after+1||entry.previousHash!==previousHash||entry.identityHash!==head.identityHash||hash(journalCommitment(entry))!==entry.hash||hash({kind:entry.kind,request:entry.request})!==entry.requestHash)throw unavailable();
    if(entry.kind==='crypto_reserve'){
     const record=entry.changes.find(change=>change.key==='event:'+entry.request.eventId)?.value;
     if(!record||record.eventId!==entry.request.eventId||record.reservationId!==entry.request.reservationId||reservations.has(record.reservationId)||record.payloadHash!==entry.request.payloadHash)throw unavailable();
     const nonceKey='nonce:'+record.derivedKeyId+':'+record.nonce,countKey='count:'+record.derivedKeyId,count=entry.changes.find(change=>change.key===countKey)?.value;
     if(record.header.nonce!==record.nonce||rows.has(nonceKey)||count!==(rows.get(countKey)??0)+1||count>2**32||entry.changes.find(change=>change.key===nonceKey)?.value?.reservationId!==record.reservationId)throw unavailable();
     reservations.set(record.reservationId,{eventId:record.eventId,nonceKey,countKey,count,headerHash:hash(record.header),payloadHash:record.payloadHash});
    }
    for(const change of entry.changes)if(/^(nonce|count|event|stream):/.test(change.key))change.deleted?rows.delete(change.key):rows.set(change.key,change.value);
    after=entry.sequence;previousHash=entry.hash;
   }
  }
  if(after!==head.sequence||previousHash!==head.hash)throw unavailable();
  const active=job.entries.get(job.index),plan=job.plans[job.index],membership=active.verified.membership.body;
  const tuple={rootKeyId:this.#identity.rootKeyId,syncGroupId:this.#identity.syncGroupId,...plan.scope,originDeviceId:this.#deviceId,keyEpoch:membership.keyEpoch,contentEpoch:active.verified.keyManifest.contentEpoch};
  const derivedKeyId=hash(['xiaok/context-sync/derived-key-id/v1',tuple,hashBytes(active.keys.contentKey),base64(active.keys.salt)]),streamId=hash([tuple.syncGroupId,tuple.conversationId,tuple.branchId,tuple.originDeviceId,tuple.contentEpoch]);
  const expected=new Map(rows);for(const key of ['count:'+derivedKeyId,'stream:'+streamId,'event:'+plan.eventId])if(!expected.has(key))expected.set(key,undefined);
  const wires=new Map();for(const [key,record]of rows)if(key.startsWith('event:')&&record.wire!==undefined){
   const reservation=reservations.get(record.reservationId),wire=parseCanonical(Buffer.from(record.wire));
   if(!reservation||reservation.eventId!==record.eventId||reservation.headerHash!==hash(record.header)||reservation.payloadHash!==record.payloadHash||rows.get(reservation.nonceKey)?.reservationId!==record.reservationId||(rows.get(reservation.countKey)??0)<reservation.count||canonical(wire.header)!==canonical(record.header)||hash(wire)!==record.eventHash)throw unavailable();
   wires.set(record.eventHash,record);
  }
  for(const entry of job.entries.values())for(const event of entry.verified.events){
   if(event.envelope.header.originDeviceId!==this.#deviceId)continue;
   const record=wires.get(event.eventHash);
   if(!record||record.wire!==canonical(event.envelope)||canonical(record.header)!==canonical(event.envelope.header))throw new Error('canonical_source_migration_required');
  }
  const pin={head,expected};this.#canonicalCryptoCurrent(pin);return pin;
 }
 #canonicalCryptoCurrent(pin){
  journalVerify.call(this.#journal);
  if(!pin||canonical(journalHead.call(this.#journal))!==canonical(pin.head))throw unavailable();
  for(const [key,value]of pin.expected)if(!sameStored(journalGet.call(this.#journal,key),value))throw unavailable();
 }

 #canonicalState(metadata){
  const source=metadata.storeState,state=this.#storeState({storeId:source.storeId,profileId:source.storeProfileBindingId});
  if(this.#testOnly||state.stageKey===null||state.head.sequence<1||journalGet.call(this.#journal,'canonical-store-binding')===undefined||source.deviceIdentityHash!==hash(this.#identity)||source.deviceId!==this.#deviceId||source.deviceLogicalProfileId!==this.#profile||canonical(state.head)!==canonical(source.capturedStoreHead)||state.policyHash!==source.policyHash||state.publicationHash!==source.publicationHash||state.stickyHash!==source.capturedStickyHash)throw unavailable();
  return state;
 }
 #canonicalAssert(){
  const job=this.#canonicalJob;
  if(!job||!this.#busy||!job.ready||job.generation!==this.#generation||job.index<0||!job.entries.has(job.index))throw unavailable();
  const state=this.#canonicalState(job.metadata);job.cryptoPin=this.#canonicalCryptoHistory(job);
  const metadata=job.friend.assertCanonicalSourceForRawOwner(this,job.device,job.services,job.proof);
  if(hash(metadata)!==job.metadataHash)throw unavailable();
  this.#canonicalPure(job,state);return job;
 }
 #canonicalPure(job,state){
  assertPinnedCanonicalMain();
  this.#canonicalCryptoCurrent(job.cryptoPin);
  if(this.#closed||this.#poisoned||this.#canonicalJob!==job||!this.#busy||!job.ready||job.generation!==this.#generation||hash(journalGet.call(this.#journal,'verified-control-floor'))!==job.controlHash||!sameStored(journalGet.call(this.#journal,'canonical-store-binding'),state.binding)||!sameStored(journalGet.call(this.#journal,'canonical-store-head'),{head:state.head,stageKey:state.stageKey,policyHash:state.policyHash,publicationHash:state.publicationHash,stickyHash:state.stickyHash}))throw unavailable();
 }
 #canonicalPlan(){
  const job=this.#canonicalAssert(),entry=job.entries.get(job.index),plan=job.plans[job.index],verified=entry.verified,membership=verified.membership.body;
  return {...plan,context:{...entry.keys,signingKey:this.#sign.privateKey,membershipEpoch:membership.membershipEpoch,sourceEpoch:job.sourceEpoch,tuple:{rootKeyId:this.#identity.rootKeyId,syncGroupId:this.#identity.syncGroupId,...plan.scope,originDeviceId:this.#deviceId,keyEpoch:membership.keyEpoch,contentEpoch:verified.keyManifest.contentEpoch}}};
 }
 #canonicalPayload(){
  const job=this.#canonicalAssert(),state={binding:clone(this.#storePin.binding),...clone(this.#storePin.stored)};
  // This read follows the last native call. No OS callback or await may follow it before AEAD.
  const payload=job.friend.readCanonicalSourcePayloadForRawOwner(this,job.device,job.services,job.proof,job.index),plan=job.plans[job.index];
  if(hash(payload)!==plan.payloadHash||payload.manifestHash!==plan.batchManifestHash)throw unavailable();
  this.#canonicalPure(job,state);return payload;
 }
 #armCanonicalSend(route,body,{requestId,expectedHead,requestSource}){
  const job=this.#canonicalAssert(),plan=job.plans[job.index],header=route==='/v1/key-use/consume'?body.header:body.envelope?.header;
  if(!['/v1/key-use/consume','/v1/events/push'].includes(route)||header?.eventType!==plan.eventType||header.sourceEpoch!==job.sourceEpoch||header.conversationId!==plan.scope.conversationId||header.branchId!==plan.scope.branchId||requestSource!==job.requestSource||canonical(expectedHead)!==canonical(job.entries.get(job.index).verified.head)||job.send&&!job.send.used)throw unavailable();
  identifier(requestId);job.send={route,requestId,bodyHash:hash(body),headerHash:hash(header),expectedHead:clone(expectedHead),requestSource,phase:job.phase,index:job.index,used:false};
 }
 #assertCanonicalSend(route,body){
  const job=this.#canonicalAssert(),send=job.send,state={binding:clone(this.#storePin.binding),...clone(this.#storePin.stored)};
  if(!send||send.used||send.phase!==job.phase||send.index!==job.index||route!==send.route||body.auth?.requestId!==send.requestId||body.auth.path!==route||body.auth.deviceId!==this.#deviceId||body.auth.bodyHash!==send.bodyHash||hash(body.body)!==send.bodyHash||canonical(body.auth.expectedHead)!==canonical(send.expectedHead)||body.requestSource!==send.requestSource)throw unavailable();
  this.#canonicalPure(job,state);send.used=true;
 }
 #canonicalCollect(job,verified){
  if(job!==this.#canonicalJob||job.ready)throw unavailable();job.generation??=this.#generation;
  const grant=verified.scope.body,index=job.plans.findIndex(plan=>plan.scope.conversationId===grant.conversationId&&plan.scope.branchId===grant.branchId);
  if(index<0||job.entries.has(index)||grant.ownerDeviceId!==this.#deviceId||grant.logicalProfileId!==this.#profile)throw new Error('canonical_source_writer_required');
  const keys=this.#current.keys;job.entries.set(index,{verified,keys:{contentKey:new Uint8Array(keys.contentKey),salt:new Uint8Array(keys.salt)}});return null;
 }
 #canonicalComplete(job){
  this.#assert();if(job!==this.#canonicalJob||job.generation!==this.#generation||job.entries.size!==job.plans.length)throw unavailable();
  const floor=journalGet.call(this.#journal,'verified-control-floor');job.controlHash=hash(floor);
  for(const entry of job.entries.values())if(canonical(entry.verified.head)!==canonical(floor.head))throw unavailable();
  job.phase++;job.ready=true;job.index=0;this.#canonicalAssert();
 }
 async #canonicalRefresh(job,client){
  this.#eraseCanonicalKeys();await this.#catchupScopes(job.scopes,job.generation,client,(_receipt,verified)=>this.#canonicalCollect(job,verified));this.#canonicalComplete(job);
 }
 #canonicalStream(job,index){
  const entry=job.entries.get(index),plan=job.plans[index],streamId=hash([this.#identity.syncGroupId,plan.scope.conversationId,plan.scope.branchId,this.#deviceId,entry.verified.keyManifest.contentEpoch]);
  const events=entry.verified.events.filter(event=>event.accepted.streamId===streamId),last=events.at(-1),remote={sequence:last?.accepted.originSequence??0,hash:last?.eventHash??'0'.repeat(64)},local=journalGet.call(this.#journal,'stream:'+streamId)??{sequence:0,hash:'0'.repeat(64),pendingEventId:null};
  if(local.pendingEventId!==null)throw new Error('canonical_source_replacement_required');
  if(local.sequence===remote.sequence&&local.hash===remote.hash)return;
  const record=journalGet.call(this.#journal,'event:'+plan.eventId);
  if(local.sequence!==remote.sequence+1||!record||record.wire===undefined||record.sourceManifestHash!==job.metadata.manifestHash||record.payloadHash!==plan.payloadHash||record.header.sourceEpoch!==job.sourceEpoch||record.header.previousEventHash!==remote.hash||record.header.originSequence!==local.sequence||record.eventHash!==local.hash||hash(parseCanonical(Buffer.from(record.wire)))!==record.eventHash)throw new Error('canonical_source_migration_required');
 }
 async publishCanonicalSource(device,services,proof,{requestSource}={}){
  if(requestSource!=='user')throw new Error('canonical_source_publish_request_denied');
  if(this.#testOnly||process.platform!=='darwin'||process.arch!=='arm64'||process.type!=='browser'||process.versions.electron!=='39.8.10'||process.versions.node!=='22.22.1'||process.env.ELECTRON_RUN_AS_NODE==='1')throw unavailable();
  const main=assertPinnedCanonicalMain(),friend=await main.pending;assertPinnedCanonicalMain();
  this.#assert();if(this.#busy||this.#storeWriting||this.#canonicalJob)throw new Error('device_owner_busy');
  const metadata=friend.assertCanonicalSourceForRawOwner(this,device,services,proof),state=this.#canonicalState(metadata),plans=[];
  for(let index=0;index<metadata.scopes.length;index++){
   const scope=metadata.scopes[index],payload=friend.readCanonicalSourcePayloadForRawOwner(this,device,services,proof,index);
   if(scope.rootKeyId!==this.#identity.rootKeyId||scope.syncGroupId!==this.#identity.syncGroupId||scope.logicalProfileId!==this.#profile||canonical(payload.scope)!==canonical(scope))throw unavailable();
   if(Buffer.byteLength(canonical(payload))>256*1024)throw new Error('snapshot_chunking_required');
   const payloadHash=hash(payload);plans.push({scope:{conversationId:scope.conversationId,branchId:scope.branchId},payloadHash,batchManifestHash:payload.manifestHash,sourceManifestHash:metadata.manifestHash,eventId:'canonical_'+hash(['xiaok/context-sync/canonical-event/v1',state.binding,scope,metadata.manifestHash,payloadHash]),eventType:'canonical-snapshot-v1',parentRevision:payload.conversation.revision});
  }
  const job={cap:Object.freeze({}),device,services,proof,friend,metadata,metadataHash:hash(metadata),plans,scopes:plans.map(plan=>plan.scope),sourceEpoch:'canonical_'+hash(['xiaok/context-sync/canonical-source-epoch/v1',state.binding,this.#registration]),entries:new Map(),phase:0,index:-1,ready:false,requestSource};
  this.#canonicalJob=job;
  try{return await this.#runScopes(job.scopes,requestSource,(_receipt,verified)=>this.#canonicalCollect(job,verified),async(_results,client)=>{
   this.#canonicalComplete(job);const accepted=[];
   for(let index=0;index<plans.length;index++){
    job.index=index;this.#canonicalAssert();this.#canonicalStream(job,index);
    let record=this.#outbox.reserveCanonical(job.cap);
    if(record.wire===undefined)await this.#outbox.sealCanonical(record.eventId,{client:this.#client,expectedHead:job.entries.get(index).verified.head,requestSource},job.cap);
    await this.#canonicalRefresh(job,client);job.index=index;this.#canonicalStream(job,index);
    const wire=this.#outbox.takeCanonical(record.eventId,job.cap).toString('utf8');record=journalGet.call(this.#journal,'event:'+record.eventId);
    const verified=job.entries.get(index).verified,envelope=parseCanonical(Buffer.from(wire)),existing=verified.events.find(event=>event.eventHash===record.eventHash);
    if(existing){if(canonical(existing.envelope)!==wire)throw unavailable();accepted.push(this.#recordOutgoingAcceptance(record.eventId,record,existing.accepted,verified.head));}
    else{
     const requestId=randomUUID(),observedHead=clone(verified.head),intent={schemaVersion:1,eventId:record.eventId,eventHash:record.eventHash,header:clone(record.header),requestId,observedHead,requestSource};
     this.#commit('device_outgoing_push_intent',intent,tx=>{this.#assertPushRecord(tx,record.eventId,record);if(tx.get('outgoing-push-attempt:'+requestId)!==undefined)throw unavailable();tx.set('outgoing-push-attempt:'+requestId,intent);},requestId);
     this.#armCanonicalSend('/v1/events/push',{envelope},{requestId,expectedHead:observedHead,requestSource});
     const response=await originalCall.call(this.#client,'/v1/events/push',{envelope},{expectedHead:observedHead,requestId,requestSource});
     this.#assert();exactObject(response.body.result,['accepted']);accepted.push(this.#recordOutgoingAcceptance(record.eventId,record,response.body.result.accepted,response.body.journalHead,{requestId,responseHash:hash(response),minimumSequence:observedHead.sequence}));
    }
    await this.#canonicalRefresh(job,client);
   }
   return freeze({status:'accepted-canonical-source-only',manifestHash:metadata.manifestHash,accepted});
  });}finally{this.#eraseCanonicalKeys();if(this.#canonicalJob===job)this.#canonicalJob=undefined;}
 }

 #publicationSource(){
  this.#assert();const key='device-publication-source-v1',stored=journalGet.call(this.#journal,key);
  if(this.#publication){if(canonical(stored)!==canonical(this.#publication))throw unavailable();return this.#publication.publicationEpoch;}
  const head=journalHead.call(this.#journal);if(head.sequence>100000)throw new Error('device_publication_history_limit');
  const entries=[];let after=0;while(after<head.sequence){const page=journalRead.call(this.#journal,after,100);if(!page.length)throw unavailable();entries.push(...page);after=page.at(-1).sequence;}
  const initial=entries.filter(entry=>entry.kind==='crypto_publication_source_init');let state=stored;
  if(state===undefined){
   if(initial.length||entries.some(entry=>!['crypto_pin_coordinator','device_verified_control'].includes(entry.kind)))throw unavailable();
   const operationId=randomUUID();state={schemaVersion:1,journalIdentityHash:head.identityHash,identityHash:hash(this.#identity),deviceId:this.#deviceId,logicalProfileId:this.#profile,registrationCommitment:this.#registration,publicationEpoch:'publication_'+randomUUID(),operationId};
   this.#commit('crypto_publication_source_init',state,tx=>{if(tx.get(key)!==undefined)throw unavailable();tx.set(key,state);},operationId);
  }else{
   exactObject(state,['schemaVersion','journalIdentityHash','identityHash','deviceId','logicalProfileId','registrationCommitment','publicationEpoch','operationId']);identifier(state.publicationEpoch);identifier(state.operationId);
   if(state.schemaVersion!==1||state.journalIdentityHash!==head.identityHash||state.identityHash!==hash(this.#identity)||state.deviceId!==this.#deviceId||state.logicalProfileId!==this.#profile||state.registrationCommitment!==this.#registration||initial.length!==1||initial[0].operationId!==state.operationId||canonical(initial[0].request)!==canonical(state)||canonical(initial[0].changes)!==canonical([{key,deleted:false,value:state}]))throw unavailable();
  }
  this.#assert();this.#publication=freeze(clone(state));return state.publicationEpoch;
 }
 #outboxContext(){
  this.#assert();const current=this.#current;
  if(!this.#busy||!this.#outgoingActive||!current||current.generation!==this.#generation||!this.#publication||canonical(journalGet.call(this.#journal,'device-publication-source-v1'))!==canonical(this.#publication))throw unavailable();
  const verified=current.verified,scope=verified.scope.body,membership=verified.membership.body;
  if(scope.ownerDeviceId!==this.#deviceId||scope.logicalProfileId!==this.#profile||scope.conversationId!==current.scope.conversationId||scope.branchId!==current.scope.branchId)throw unavailable();
  return {...current.keys,signingKey:this.#sign.privateKey,membershipEpoch:membership.membershipEpoch,sourceEpoch:this.#publication.publicationEpoch,tuple:{rootKeyId:this.#identity.rootKeyId,syncGroupId:this.#identity.syncGroupId,...current.scope,originDeviceId:this.#deviceId,keyEpoch:membership.keyEpoch,contentEpoch:verified.keyManifest.contentEpoch}};
 }
 async sealOutgoing(scope,request,{requestSource}={}){
  request=clone(request);exactObject(request,['eventId','payload','parentRevision','eventType']);identifier(request.eventId);identifier(request.eventType);integer(request.parentRevision);if(Buffer.byteLength(canonical(request.payload))>256*1024)throw new Error('payload_too_large');
  if(!['user','agent','scheduler'].includes(requestSource))throw new Error('request_source_required');
  if(!this.#testOnly&&request.eventType.startsWith('canonical-'))throw new Error('canonical_source_required');
  return this.#runScope(scope,requestSource,async()=>{
   this.#publicationSource();this.#outgoingActive=true;
   try{
    const record=this.#outbox.reserve(request);
    if(record.wire===undefined)await this.#outbox.sealOnline(request.eventId,{client:this.#client,expectedHead:this.#current.verified.head,requestSource});
    this.#assert();const wire=this.#outbox.takeReady(request.eventId).toString('utf8');this.#assert();
    return freeze({status:'sealed-outgoing-only',eventId:request.eventId,eventHash:hash(parseCanonical(Buffer.from(wire))),wire});
   }finally{this.#outgoingActive=false;}
  });
 }
 #assertPushRecord(tx,eventId,record){
  const current=tx.get('event:'+eventId);
  if(!current||!['ready','admitted','accepted'].includes(current.status)||canonical(current)!==canonical(record)||current.eventId!==eventId||current.wire===undefined||hash(parseCanonical(Buffer.from(current.wire)))!==current.eventHash||current.header.sourceEpoch!==(!this.#testOnly&&record.header.eventType==='canonical-snapshot-v1'?this.#canonicalJob?.sourceEpoch:this.#publication?.publicationEpoch))throw unavailable();
 }
 #recordOutgoingAcceptance(eventId,record,accepted,coordinatorHead,{requestId=null,responseHash=null,minimumSequence=null}={}){
  accepted=clone(accepted);coordinatorHead=clone(coordinatorHead);
  exactObject(accepted,['streamId','originSequence','eventHash','journalSequence']);exactObject(coordinatorHead,['identityHash','sequence','hash']);
  integer(accepted.originSequence,1);integer(accepted.journalSequence,1);integer(coordinatorHead.sequence);
  const header=record.header,streamId=hash([header.syncGroupId,header.conversationId,header.branchId,header.originDeviceId,header.contentEpoch]);
  if(accepted.streamId!==streamId||accepted.originSequence!==header.originSequence||accepted.eventHash!==record.eventHash||coordinatorHead.identityHash!==hash(this.#identity)||!(/^[a-f0-9]{64}$/).test(coordinatorHead.hash)||accepted.journalSequence>coordinatorHead.sequence||minimumSequence!==null&&accepted.journalSequence<=minimumSequence)throw new Error('invalid_outgoing_acceptance');
  const key='outgoing-accepted:'+eventId,fact={schemaVersion:1,eventId,eventHash:record.eventHash,header:clone(header),accepted};
  const previous=journalGet.call(this.#journal,key);
  if(previous!==undefined){
   if(canonical(previous.fact)!==canonical(fact))throw new Error('outgoing_acceptance_conflict');
   this.#assert();this.#assertPushRecord({get:key=>journalGet.call(this.#journal,key)},eventId,record);
  }else this.#commit('device_outgoing_accepted',{fact,coordinatorHead,requestId,responseHash,source:requestId===null?'verified-chain':'push-response'},tx=>{
   this.#assertPushRecord(tx,eventId,record);if(tx.get(key)!==undefined)throw new Error('outgoing_acceptance_conflict');
   tx.set(key,{fact,coordinatorHead,requestId,responseHash,source:requestId===null?'verified-chain':'push-response'});
  });
  return freeze({status:'accepted-ciphertext-only',eventId,eventHash:record.eventHash,accepted});
 }
 async pushOutgoing(scope,request,{requestSource}={}){
  request=clone(request);exactObject(request,['eventId']);identifier(request.eventId);
  if(!['user','agent','scheduler'].includes(requestSource))throw new Error('request_source_required');
  this.#outbox.assertGenericEventId(request.eventId);
  return this.#runScope(scope,requestSource,async()=>{
   this.#publicationSource();this.#outgoingActive=true;
   try{
    const wire=this.#outbox.takeReady(request.eventId).toString('utf8'),record=journalGet.call(this.#journal,'event:'+request.eventId);
    this.#assertPushRecord({get:key=>journalGet.call(this.#journal,key)},request.eventId,record);
    const envelope=parseCanonical(Buffer.from(wire)),header=envelope.header,streamId=hash([header.syncGroupId,header.conversationId,header.branchId,header.originDeviceId,header.contentEpoch]);
    if(record.wire!==wire||canonical(record.header)!==canonical(header))throw unavailable();
    const verified=this.#current.verified,existing=verified.events.find(event=>event.accepted.streamId===streamId&&event.accepted.originSequence===header.originSequence);
    if(existing){
     if(existing.eventHash!==record.eventHash||canonical(existing.envelope)!==wire)throw new Error('outgoing_acceptance_conflict');
     return this.#recordOutgoingAcceptance(request.eventId,record,existing.accepted,verified.head);
    }
    const requestId=randomUUID(),observedHead=clone(verified.head),intent={schemaVersion:1,eventId:request.eventId,eventHash:record.eventHash,header:clone(header),requestId,observedHead,requestSource};
    this.#commit('device_outgoing_push_intent',intent,tx=>{
     this.#assertPushRecord(tx,request.eventId,record);const key='outgoing-push-attempt:'+requestId;if(tx.get(key)!==undefined)throw unavailable();tx.set(key,intent);
    },requestId);
    // Re-enter the same original private provider/floor after the last durable
    // native callback, immediately before the original TLS send.
    if(this.#outbox.takeReady(request.eventId).toString('utf8')!==wire)throw unavailable();this.#assert();
    const response=await originalCall.call(this.#client,'/v1/events/push',{envelope},{expectedHead:observedHead,requestId,requestSource});
    this.#assert();exactObject(response.body.result,['accepted']);
    return this.#recordOutgoingAcceptance(request.eventId,record,response.body.result.accepted,response.body.journalHead,{requestId,responseHash:hash(response),minimumSequence:observedHead.sequence});
   }finally{this.#outgoingActive=false;}
  });
 }
 assertControlCurrent(receipt){this.#assert();const original=this.#receipts.get(receipt);if(!original||this.#busy||original.generation!==this.#generation||!this.#current||original.headHash!==hash(this.#current.verified.head))throw unavailable();}
 assertPublicationCurrent(_receipt){throw new Error('sync_publication_unavailable');}
 close(){
  if(this.#closing)return this.#closing;
  let resolve,reject;this.#closing=new NativePromise((a,b)=>{resolve=a;reject=b;});
  this.#closed=true;this.#eraseCurrent();
  // Key erasure is independent of physical closure. Keep unknown native
  // obligations/namespace locked, but never retain this owner's master copies
  // while waiting for drain, including a synchronous client-close failure.
  this.#eraseMaster();
  try{
   if(this.#client)originalClose.call(this.#client);
   // This resource was created before this owner's first lease.run. A synchronous
   // native-read reentry must not start its drain inside the job it is closing.
   const operation=shutdownScope.call(this.#shutdown,async()=>{
    // A rejected/uncertain transport drain is still a device-wide obligation.
    // Do not close the namespace first: its own jobs may already have settled,
    // which would let another owner choose a different journal and overlap IO.
    if(this.#client)await originalDrain.call(this.#client);
    this.#lease?.close();
    if(this.#lease)await this.#lease.drainClosed();
    this.#release();
   });
   then.call(operation,resolve,reject);
  }catch(error){reject(error);}
  return this.#closing;
 }
}
export function openExistingDeviceOwner(options){try{return new DeviceSyncOwner(options,undefined,false);}catch{throw unavailable();}}
export function openTestExistingDeviceOwner(options,testOptions){try{return new DeviceSyncOwner(options,testOptions,true);}catch{throw unavailable();}}
/** Main-only original assertion. A later public prototype replacement cannot
 * turn a copied candidate DTO or a forged owner into an import authority. */
export function assertOriginalIncoming(owner,receipt,{testOnly=false}={}){return assertIncomingBinding(owner,receipt,testOnly===true);}
/** A current original OS anchor FACT, never proof of a canonical COMMIT/read. */
export function assertOriginalStoreAnchor(owner,receipt,{testOnly=false}={}){return assertStoreAnchorBinding(owner,receipt,testOnly===true);}
/** Genuine writer/control FACT, never source/COMMIT/AEAD permission. */
export function assertOriginalSourceControls(owner,receipt,{testOnly=false}={}){return assertSourceControlsBinding(owner,receipt,testOnly===true);}

/** Validation only; no raw provider, keys, journal or reusable capability leaves
 * this exact private construction. Public options cannot create an owner. */
export function claimOriginalDeviceOutbox(owner,box,options){return claimOutboxBinding(owner,box,options);}

/** One-use original constructor friend. No caller callback or current flag. */
export function claimOriginalDeviceTransport(owner,client,options){return claimTransportBinding(owner,client,options);}

export function originalCanonicalOutboxPlan(owner,box,cap){return canonicalOutboxPlan(owner,box,cap);}
export function originalCanonicalOutboxPayload(owner,box,cap){return canonicalOutboxPayload(owner,box,cap);}
export function armOriginalCanonicalOutboxRequest(owner,box,cap,route,body,options){return canonicalOutboxArm(owner,box,cap,route,body,options);}

export function assertOriginalCanonicalMainFriendReady(owner){return canonicalMainReady(owner);}
