import {claimOriginalDeviceOutbox,originalCanonicalOutboxPlan,originalCanonicalOutboxPayload,armOriginalCanonicalOutboxRequest} from './device-owner.mjs';
import {AuthorityJournal} from './journal.mjs';
import { randomBytes,randomUUID } from 'node:crypto';
import { base64,bytes,canonical,deriveSenderKey,hash,hashBytes,identifier,integer,parseCanonical,sealEnvelope,SUITE } from './crypto.mjs';
import {validateCoordinatorIdentity} from './identity.mjs';
import {privateKeyUseConsumer} from './transport.mjs';
import {originalOsOutboxGuard} from '../../continuity-device/src/os-guard.mjs';

const MAX_PAYLOAD_BYTES=256*1024;
const journalHead=AuthorityJournal.prototype.head,journalGet=AuthorityJournal.prototype.get,journalTransact=AuthorityJournal.prototype.transact;
function unavailable(){return new Error('crypto_unavailable');}
function clone(value){return parseCanonical(Buffer.from(canonical(value)));}
function synchronous(value){if(value&&typeof value.then==='function'){Promise.resolve(value).catch(()=>{});throw unavailable();}return value;}
function advance(guard,before,after){const result=synchronous(guard.advance(before,after));if(result!==undefined&&result!==true)throw unavailable();}

/** Local main-owner component; no renderer/network API may access an unsealed reservation. */
export class CryptoOutbox {
  #journal;#guard;#keys;#owner;#fault;#random;#boot=randomUUID();#workerBoot=base64(randomBytes(32));#poisoned=false;#testOnly;#coordinatorHash;#identityScope;#deviceId;#inflight=new Set();
  constructor({journal,guard,keyProvider,coordinatorIdentity,owner,initialize=false,testOnly=false,fault=()=>{},randomNonce=()=>randomBytes(24)}){
    const explicitTest=testOnly===true;
    if(!guard||!['read','advance'].every(k=>typeof guard[k]==='function')||!(guard.kind==='os-protected'||(explicitTest&&guard.kind==='test-only')))throw new Error('os_guard_unavailable');
    // A genuine production guard cannot be downgraded into the synchronous test-only sibling.
    if(explicitTest&&guard.kind!=='test-only')throw new Error('os_guard_unavailable');
    if(typeof keyProvider!=='function')throw new Error('verified_key_provider_required');
    if(!explicitTest||owner!==undefined)try{claimOriginalDeviceOutbox(owner,this,{journal,guard,keyProvider,coordinatorIdentity,testOnly:explicitTest});}catch(cause){throw Object.assign(new Error('crypto_unavailable',{cause}),{code:'verified_device_owner_required'});}
    this.#owner=owner;this.#journal=journal;this.#guard=guard;this.#keys=keyProvider;this.#fault=fault;this.#random=randomNonce;this.#testOnly=explicitTest;
    if(coordinatorIdentity!==undefined){const identity=validateCoordinatorIdentity(coordinatorIdentity).identity;this.#coordinatorHash=hash(identity);this.#identityScope={rootKeyId:identity.rootKeyId,syncGroupId:identity.syncGroupId};}
    try{
      this.#guard=this.#testOnly&&guard.kind==='test-only'?guard:originalOsOutboxGuard(guard,{identityHash:this.#coordinatorHash});
      if(!this.#testOnly)this.#deviceId=this.#guard.deviceId;
      guard=this.#guard;const current=synchronous(guard.read()),head=journalHead.call(journal);
      // Production provisioning happens through an explicit verified new-key/OS flow. A lost
      // OS item must never be recreated from a body backup, even if that backup has sequence zero.
      if(current===null){if(!initialize||head.sequence!==0||!explicitTest||guard.kind!=='test-only')throw unavailable();advance(guard,null,head);}
      this.#checkGuard();
      const pinned=journalGet.call(journal,'crypto-coordinator-pin');
      if(pinned!==undefined&&pinned!==this.#coordinatorHash)throw new Error('coordinator_identity_mismatch');
      if(this.#coordinatorHash&&pinned===undefined){
        // A nonempty legacy/restored journal cannot acquire a different coordinator retrospectively.
        if(journalHead.call(journal).sequence!==0)throw unavailable();
        this.#commit('crypto_pin_coordinator',{identityHash:this.#coordinatorHash},tx=>{tx.set('crypto-coordinator-pin',this.#coordinatorHash);return null;});
      }
    }catch{this.#poisoned=true;throw unavailable();}
  }
  #checkGuard(){
    if(this.#poisoned)throw unavailable();
    try{const head=journalHead.call(this.#journal);if(canonical(synchronous(this.#guard.read()))!==canonical(head))throw unavailable();return head;}
    catch{this.#poisoned=true;throw unavailable();}
  }
  #context(cap){
    this.#checkGuard();
    // The provider is owned by the verified control-plane receiver. It must close on reconnect,
    // missing revocation tails, loss of OS heads, or a non-current root-signed key manifest.
    const c=cap===undefined?this.#keys():originalCanonicalOutboxPlan(this.#owner,this,cap).context;bytes(c.contentKey,32);bytes(c.salt,32);bytes(c.signingKey,64);integer(c.membershipEpoch,1);identifier(c.sourceEpoch);
    const tuple=clone(c.tuple);
    if(this.#deviceId!==undefined&&tuple.originDeviceId!==this.#deviceId||this.#identityScope&&(tuple.rootKeyId!==this.#identityScope.rootKeyId||tuple.syncGroupId!==this.#identityScope.syncGroupId))throw unavailable();
    const derived=deriveSenderKey(c.contentKey,c.salt,tuple);
    derived.fill(0);
    return {...c,tuple,derivedKeyId:hash(['xiaok/context-sync/derived-key-id/v1',tuple,hashBytes(c.contentKey),base64(c.salt)])};
  }
  #commit(kind,request,apply){
    const before=this.#checkGuard();
    const decision=journalTransact.call(this.#journal,{operationId:randomUUID(),kind,request},apply);
    try{
      this.#fault('before_guard_advance');
      const after=journalHead.call(this.#journal);advance(this.#guard,before,after);this.#checkGuard();return decision.result;
    }catch{this.#poisoned=true;throw unavailable();}
  }
  #assertGenericEvent(eventType){if(!this.#testOnly&&typeof eventType==='string'&&eventType.startsWith('canonical-'))throw new Error('canonical_source_required');}
  #assertGenericRecord(record){
    this.#assertGenericEvent(record.eventType);this.#assertGenericEvent(record.header?.eventType);
    // Inspect the actual persisted wire too, including legacy ready records.
    if(!this.#testOnly&&record.wire!==undefined){const envelope=parseCanonical(Buffer.from(record.wire));this.#assertGenericEvent(envelope?.header?.eventType);}
  }
  #record(eventId){identifier(eventId);const r=journalGet.call(this.#journal,'event:'+eventId);if(!r)throw new Error('event_not_found');return r;}
  #stream(c){return hash([c.tuple.syncGroupId,c.tuple.conversationId,c.tuple.branchId,c.tuple.originDeviceId,c.tuple.contentEpoch]);}
  #allocate({eventId,payload,payloadHash,parentRevision,eventType,requestHash,sourceManifestHash},c,old){
    let nonce;
    try{nonce=base64(bytes(this.#random(),24));}catch{this.#poisoned=true;throw unavailable();}
    const nonceKey='nonce:'+c.derivedKeyId+':'+nonce,countKey='count:'+c.derivedKeyId;
    const count=journalGet.call(this.#journal,countKey)??0;
    if(count>=2**32||journalGet.call(this.#journal,nonceKey)!==undefined){this.#poisoned=true;throw unavailable();}
    const streamId=this.#stream(c),stream=journalGet.call(this.#journal,'stream:'+streamId)??{sequence:0,hash:'0'.repeat(64),pendingEventId:null};
    if(stream.pendingEventId!==null&&stream.pendingEventId!==eventId)throw new Error('stream_pending');
    const header={...c.tuple,schemaVersion:1,cryptoSuite:SUITE,membershipEpoch:c.membershipEpoch,sourceEpoch:c.sourceEpoch,originSequence:stream.sequence+1,previousEventHash:stream.hash,parentRevision,eventType,nonce};
    if(old){
      const {nonce:_,...accepted}=old.header,{nonce:__,...proposed}=header;
      if(canonical(accepted)!==canonical(proposed))throw new Error('key_epoch_changed');
    }
    const record={eventId,...(sourceManifestHash===undefined?{payload:clone(payload)}:{sourceManifestHash}),payloadHash,parentRevision,eventType,requestHash,header,nonce,streamId,derivedKeyId:c.derivedKeyId,reservationId:randomUUID(),bootId:this.#boot,status:'reserved'};
    return this.#commit('crypto_reserve',{eventId,payloadHash,reservationId:record.reservationId,previousReservationId:old?.reservationId??null},tx=>{
      const prior=tx.get('event:'+eventId);if(old?prior?.reservationId!==old.reservationId:prior!==undefined)throw new Error('event_conflict');
      if(tx.get(nonceKey)!==undefined||(tx.get(countKey)??0)!==count)throw new Error('nonce_conflict');
      tx.set(nonceKey,{reservationId:record.reservationId});tx.set(countKey,count+1);
      tx.set('event:'+eventId,record);tx.set('stream:'+streamId,{...stream,pendingEventId:eventId});return record;
    });
  }
  reserve({eventId,payload,parentRevision,eventType}){
    this.#assertGenericEvent(eventType);
    const c=this.#context();identifier(eventId);integer(parentRevision);identifier(eventType);
    if(Buffer.byteLength(canonical(payload))>MAX_PAYLOAD_BYTES)throw new Error('payload_too_large');
    const payloadHash=hash(payload),requestHash=hash({payloadHash,parentRevision,eventType,tuple:c.tuple,membershipEpoch:c.membershipEpoch,sourceEpoch:c.sourceEpoch});
    const old=journalGet.call(this.#journal,'event:'+eventId);
    if(old){this.#assertGenericRecord(old);if(old.requestHash!==requestHash)throw new Error('event_conflict');return old;}
    const record=this.#allocate({eventId,payload,payloadHash,parentRevision,eventType,requestHash},c);
    this.#fault('reservation_committed');return record;
  }
  /** Metadata-only early deny for the original production owner, no read permit. */
  assertGenericEventId(eventId){this.#assertGenericRecord(this.#record(eventId));}
  retryUnsealed(eventId){
    if(this.#inflight.has(eventId))throw new Error('encryption_in_flight');
    const old=this.#record(eventId);this.#assertGenericRecord(old);const c=this.#context();
    if(old.wire!==undefined||['ready','admitted','accepted'].includes(old.status))throw new Error('already_sealed');
    if(old.derivedKeyId!==c.derivedKeyId||old.header.membershipEpoch!==c.membershipEpoch||old.header.sourceEpoch!==c.sourceEpoch)throw new Error('key_epoch_changed');
    return this.#allocate(old,c,old);
  }
  seal(eventId){
    if(this.#inflight.has(eventId))throw new Error('encryption_in_flight');
    if(!this.#testOnly)throw new Error('online_key_use_required');
    const record=this.#record(eventId);this.#assertGenericRecord(record);const c=this.#context();
    if(record.wire!==undefined)throw new Error('already_sealed');
    if(record.bootId!==this.#boot)throw new Error('reservation_from_old_boot');
    if(record.status!=='reserved')throw new Error('reservation_consumed');
    if(record.derivedKeyId!==c.derivedKeyId||record.header.membershipEpoch!==c.membershipEpoch||record.header.sourceEpoch!==c.sourceEpoch)throw new Error('key_epoch_changed');
    this.#commit('crypto_mark_encrypting',{eventId,reservationId:record.reservationId},tx=>{
      const current=tx.get('event:'+eventId);if(current.status!=='reserved'||current.reservationId!==record.reservationId)throw new Error('reservation_consumed');
      tx.set('event:'+eventId,{...current,status:'encrypting'});return null;
    });
    this.#fault('encrypting_marked');
    return this.#finishSeal(c,record);
  }
  #fingerprint(c){return hash([c.tuple,c.derivedKeyId,c.membershipEpoch,c.sourceEpoch,hashBytes(c.signingKey)]);}
  #assertCanonicalRecord(record,cap){
    const plan=originalCanonicalOutboxPlan(this.#owner,this,cap);
    if(Object.hasOwn(record,'payload')||record.eventId!==plan.eventId||record.eventType!==plan.eventType||record.sourceManifestHash!==plan.sourceManifestHash||record.payloadHash!==plan.payloadHash||record.parentRevision!==plan.parentRevision)throw unavailable();
  }
  reserveCanonical(cap){
    const plan=originalCanonicalOutboxPlan(this.#owner,this,cap),c=this.#context(cap);
    const {eventId,payloadHash,parentRevision,eventType,sourceManifestHash}=plan;
    identifier(eventId);integer(parentRevision);if(eventType!=='canonical-snapshot-v1')throw unavailable();
    const requestHash=hash({payloadHash,parentRevision,eventType,sourceManifestHash,tuple:c.tuple,membershipEpoch:c.membershipEpoch,sourceEpoch:c.sourceEpoch});
    const old=journalGet.call(this.#journal,'event:'+eventId);
    if(old){this.#assertCanonicalRecord(old,cap);if(old.requestHash!==requestHash)throw new Error('event_conflict');return old;}
    return this.#allocate({eventId,payloadHash,parentRevision,eventType,sourceManifestHash,requestHash},c);
  }
  #assertOriginal(record,c,cap){
    const context=this.#context(cap),current=this.#record(record.eventId);
    if(cap===undefined)this.#assertGenericRecord(current);else this.#assertCanonicalRecord(current,cap);
    if(current.bootId!==this.#boot||current.status!=='encrypting'||current.reservationId!==record.reservationId||hash(current.header)!==hash(record.header)||current.payloadHash!==record.payloadHash||(cap===undefined&&hash(current.payload)!==record.payloadHash)||this.#fingerprint(context)!==this.#fingerprint(c))throw new Error('key_epoch_changed');
    return current;
  }
  async sealOnline(eventId,{client,expectedHead,requestSource}={},cap){
    identifier(eventId);if(this.#inflight.has(eventId))throw new Error('encryption_in_flight');
    // Register before any key/guard/fault callback can reenter this event's owner.
    this.#inflight.add(eventId);let c;
    try{
      const record=this.#record(eventId);if(cap===undefined)this.#assertGenericRecord(record);else this.#assertCanonicalRecord(record,cap);
      const context=this.#context(cap);c={...context,tuple:clone(context.tuple),contentKey:new Uint8Array(context.contentKey),salt:new Uint8Array(context.salt),signingKey:new Uint8Array(context.signingKey)};
      if(!this.#coordinatorHash)throw new Error('coordinator_identity_mismatch');
      const requestId=randomUUID(),consume=privateKeyUseConsumer(client,{requestId,identityHash:this.#coordinatorHash,deviceId:c.tuple.originDeviceId,expectedHead,requestSource});
      if(record.wire!==undefined)throw new Error('already_sealed');
      if(record.bootId!==this.#boot)throw new Error('reservation_from_old_boot');
      if(record.status!=='reserved')throw new Error('reservation_consumed');
      if(record.derivedKeyId!==c.derivedKeyId||record.header.membershipEpoch!==c.membershipEpoch||record.header.sourceEpoch!==c.sourceEpoch)throw new Error('key_epoch_changed');
      this.#commit('crypto_mark_encrypting',{eventId,reservationId:record.reservationId},tx=>{
        const current=tx.get('event:'+eventId);if(current.status!=='reserved'||current.reservationId!==record.reservationId)throw new Error('reservation_consumed');
        tx.set('event:'+eventId,{...current,status:'encrypting'});return null;
      });
      this.#fault('encrypting_marked');
      const body={header:record.header,reservationId:record.reservationId,workerBootId:this.#workerBoot,useId:randomUUID(),derivedKeyId:record.derivedKeyId};
      if(cap!==undefined)armOriginalCanonicalOutboxRequest(this.#owner,this,cap,'/v1/key-use/consume',body,{requestId,expectedHead,requestSource});
      const response=await consume(body);
      this.#assertOriginal(record,c,cap);
      const keyUse={result:clone(response.body.result),responseHash:hash(response),coordinatorHead:clone(response.body.journalHead)};
      this.#commit('crypto_online_permit',{eventId,reservationId:record.reservationId,keyUse},tx=>{
        const current=tx.get('event:'+eventId);if(current.status!=='encrypting'||current.reservationId!==record.reservationId||current.keyUse!==undefined)throw new Error('reservation_consumed');
        tx.set('event:'+eventId,{...current,keyUse});return null;
      });
      // Recheck after the final durable guard write; no callback/await separates this and AEAD.
      this.#assertOriginal(record,c,cap);
      return this.#finishSeal(c,record,cap);
    }finally{
      c?.contentKey.fill(0);c?.salt.fill(0);c?.signingKey.fill(0);this.#inflight.delete(eventId);
    }
  }
  #finishSeal(c,record,cap){
    if(cap===undefined)this.#assertGenericRecord(record);else this.#assertCanonicalRecord(record,cap);
    const eventId=record.eventId;
    // Only this path calls AEAD. It can never be reached twice for the same persisted reservation.
    const payload=cap===undefined?record.payload:originalCanonicalOutboxPayload(this.#owner,this,cap);
    if(hash(payload)!==record.payloadHash)throw unavailable();
    const envelope=sealEnvelope({header:record.header,payload,contentKey:c.contentKey,salt:c.salt,signingKey:c.signingKey});
    this.#fault('encrypted');
    const wire=canonical(envelope),eventHash=hash(envelope);
    this.#commit('crypto_seal',{eventId,reservationId:record.reservationId,eventHash},tx=>{
      const current=tx.get('event:'+eventId),stream=tx.get('stream:'+record.streamId);
      if(current.status!=='encrypting'||current.reservationId!==record.reservationId||stream.pendingEventId!==eventId||stream.sequence+1!==record.header.originSequence)throw new Error('seal_conflict');
      const {payload:_,...metadata}=current;
      tx.set('event:'+eventId,{...metadata,status:'ready',wire,eventHash});
      tx.set('stream:'+record.streamId,{sequence:record.header.originSequence,hash:eventHash,pendingEventId:null});return null;
    });
    this.#fault('sealed');return clone(envelope);
  }
  readSealed(eventId){const record=this.#record(eventId);this.#assertGenericRecord(record);this.#context();if(record.wire===undefined)throw new Error('not_sealed');return parseCanonical(Buffer.from(record.wire));}
  takeReady(eventId,cap){
    const record=this.#record(eventId);if(cap===undefined)this.#assertGenericRecord(record);else this.#assertCanonicalRecord(record,cap);const c=this.#context(cap);
    if(record.wire===undefined||!['ready','admitted','accepted'].includes(record.status))throw new Error('not_sealed');
    if(record.derivedKeyId!==c.derivedKeyId||record.header.membershipEpoch!==c.membershipEpoch||record.header.sourceEpoch!==c.sourceEpoch)throw new Error('key_epoch_changed');
    if(record.status==='ready')this.#commit('crypto_network_admission',{eventId,eventHash:record.eventHash},tx=>{const current=tx.get('event:'+eventId);if(current.wire!==record.wire)throw new Error('outbox_conflict');tx.set('event:'+eventId,{...current,status:'admitted'});return null;});
    this.#fault('network_admitted');
    // A transport gets only persisted canonical bytes, never the result of encrypt in memory.
    const current=this.#record(eventId);if(cap===undefined)this.#assertGenericRecord(current);else this.#assertCanonicalRecord(current,cap);return Buffer.from(current.wire);
  }
}

// Capture inside this module after class initialization. The owner/outbox import
// cycle is safe in either entry order and later prototype edits cannot hijack IO.
const OriginalCryptoOutbox=CryptoOutbox,ownedReserve=CryptoOutbox.prototype.reserve,ownedSeal=CryptoOutbox.prototype.sealOnline,ownedTake=CryptoOutbox.prototype.takeReady,ownedAssertGeneric=CryptoOutbox.prototype.assertGenericEventId,ownedCanonicalReserve=CryptoOutbox.prototype.reserveCanonical;
export function createDeviceOwnedOutbox(owner,options){
 const box=new OriginalCryptoOutbox({...options,owner});
 return Object.freeze({reserveCanonical:cap=>ownedCanonicalReserve.call(box,cap),sealCanonical:(eventId,input,cap)=>ownedSeal.call(box,eventId,input,cap),takeCanonical:(eventId,cap)=>ownedTake.call(box,eventId,cap),assertGenericEventId:eventId=>ownedAssertGeneric.call(box,eventId),reserve:input=>ownedReserve.call(box,input),sealOnline:(eventId,input)=>ownedSeal.call(box,eventId,input),takeReady:eventId=>ownedTake.call(box,eventId)});
}
