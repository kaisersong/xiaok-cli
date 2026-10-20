import { randomBytes,randomUUID } from 'node:crypto';
import { base64,bytes,canonical,exactObject,hash,hashBytes,identifier,integer,parseCanonical,sign,unbase64,validateHeader,verify,verifyEnvelope,verifyKeyManifest } from './crypto.mjs';
import { journalCommitment } from './journal.mjs';
import { isSingleScopeEventEntry } from './event-entry.mjs';
import { validateCoordinatorIdentity } from './identity.mjs';
import {validateContentRevocationRecord,assertContentRevocationPosition,contentRevocationArtifacts} from './content-revocation.mjs';

const CONTROL_TYPES={'/v1/membership':'membership','/v1/scopes':'scope','/v1/pairings/begin':'pairing-begin','/v1/pairings/confirm':'pairing-confirm','/v1/events/push':'event','/v1/key-use/consume':'key-use','/v1/content-revocations/append':'content-revocation'};
const ZERO='0'.repeat(64),DEVICE_FIELDS=['deviceId','state','role','signingPublicKey','encryptionPublicKey','logicalProfileId','pairingId'];
const MEMBERSHIP_FIELDS=['schemaVersion','rootKeyId','syncGroupId','coordinatorId','operationId','membershipEpoch','keyEpoch','previousHash','devices'];
const SCOPE_FIELDS=['schemaVersion','rootKeyId','syncGroupId','coordinatorId','operationId','conversationId','branchId','logicalProfileId','ownerDeviceId','allowedDeviceIds','revision','previousHash'];
const AUTH_FIELDS=['schemaVersion','method','path','rootKeyId','syncGroupId','coordinatorId','deviceId','requestId','challengeId','bodyHash','expectedHead'];
function reject(code){throw new Error(code);}
function snapshot(v){return parseCanonical(Buffer.from(canonical(v)));}
function user(source){if(source!=='user')reject('forbidden');}
function deviceRow(d){exactObject(d,DEVICE_FIELDS);identifier(d.deviceId);identifier(d.logicalProfileId);identifier(d.pairingId);if(!['active','revoked'].includes(d.state)||!['root','member'].includes(d.role))reject('invalid_device');unbase64(d.signingPublicKey,32);unbase64(d.encryptionPublicKey,32);}

/** Ciphertext relay and single control-plane owner. Device content keys never enter this class. */
export class Coordinator {
  #journal;#identity;#root;#signing;#challenges=new Map();#now;#maxBytes;#disposed=false;
  constructor({journal,identity,signingKey,now=()=>Date.now(),maxRelayBytes=1024**3}){
    const validated=validateCoordinatorIdentity(identity);identity=validated.identity;const root=validated.rootPublicKey,online=validated.coordinatorPublicKey;bytes(signingKey,64);
    if(!verify(['xiaok/context-sync/signing-key-check/v1',identity],sign(['xiaok/context-sync/signing-key-check/v1',identity],signingKey),online))reject('invalid_signing_key');
    if(journal.head().identityHash!==hash(identity))reject('identity_mismatch');
    this.#journal=journal;this.#identity=identity;this.#root=root;this.#signing=new Uint8Array(signingKey);this.#now=now;integer(maxRelayBytes,1);this.#maxBytes=maxRelayBytes;
  }
  get identity(){this.#live();return snapshot(this.#identity);}
  #live(){if(this.#disposed)reject('coordinator_disposed');this.#journal.head();}
  #operationId(id,request){return hash(['xiaok/context-sync/operation-id/v1',request.actor,request.method,request.path,id]);}
  #write(operationId,request,apply){
    const recordType=CONTROL_TYPES[request.path];if(!recordType)reject('unknown_record_type');const privateRecord=recordType==='event'||recordType==='key-use',header=recordType==='event'?request.body.envelope.header:recordType==='key-use'?request.body.header:null;
    return this.#journal.transact({operationId:this.#operationId(operationId,request),kind:'control',recordType,disclosureClass:privateRecord?'scope-private':'global-control',scopeDigest:privateRecord?hash(['xiaok/context-sync/scope/v1',this.#identity.rootKeyId,this.#identity.syncGroupId,header.conversationId,header.branchId]):null,request},apply);
  }
  #scopeIdentity(body){if(body.schemaVersion!==1)reject('invalid_schema');for(const k of ['rootKeyId','syncGroupId','coordinatorId'])if(body[k]!==this.#identity[k])reject('scope_mismatch');}
  #rootRecord(record,kind,fields){exactObject(record,['body','signature']);exactObject(record.body,fields);this.#scopeIdentity(record.body);identifier(record.body.operationId);if(!verify(['xiaok/context-sync/'+kind+'/v1',record.body],record.signature,this.#root))reject('invalid_signature');}
  #membership(){return this.#journal.get('membership');}
  #device(id){const d=this.#membership()?.body.devices.find(x=>x.deviceId===id);if(!d)reject('unknown_device');return d;}
  #active(id){const d=this.#device(id);if(d.state!=='active')reject('device_revoked');return d;}
  #controlRequest(actor,path,body){return {actor,method:'POST',path,rootKeyId:this.#identity.rootKeyId,syncGroupId:this.#identity.syncGroupId,coordinatorId:this.#identity.coordinatorId,body};}
  #decision(id,request){const old=this.#journal.getDecision(this.#operationId(id,request));if(!old)return undefined;if(old.requestHash!==hash({kind:'control',request}))reject('operation_conflict');return old.result;}
  appendMembership({record,manifest,requestSource}){
    this.#live();user(requestSource);record=snapshot(record);manifest=snapshot(manifest);this.#rootRecord(record,'membership',MEMBERSHIP_FIELDS);
    const body=record.body;integer(body.membershipEpoch,1);integer(body.keyEpoch,1);
    if(!Array.isArray(body.devices)||body.devices.length<1||body.devices.length>256)reject('invalid_devices');
    const ids=new Set(),publicKeys=new Set();let last='';
    for(const d of body.devices){deviceRow(d);if(d.deviceId<=last||ids.has(d.deviceId)||publicKeys.has(d.signingPublicKey)||publicKeys.has(d.encryptionPublicKey))reject('invalid_devices');last=d.deviceId;ids.add(d.deviceId);publicKeys.add(d.signingPublicKey);publicKeys.add(d.encryptionPublicKey);}
    if(!body.devices.some(d=>d.role==='root'&&d.state==='active'))reject('active_root_required');
    verifyKeyManifest({manifest,membership:body,expected:{rootKeyId:body.rootKeyId,syncGroupId:body.syncGroupId,membershipEpoch:body.membershipEpoch,keyEpoch:body.keyEpoch,contentEpoch:manifest.contentEpoch,membershipHash:hash(body)},rootPublicKey:this.#root});
    const request=this.#controlRequest('root:'+this.#identity.rootKeyId,'/v1/membership',{record,manifest});const prior=this.#decision(body.operationId,request);if(prior!==undefined)return prior;
    const current=this.#membership();
    if(body.membershipEpoch!==(current?.body.membershipEpoch??0)+1||body.keyEpoch!==(current?.body.keyEpoch??0)+1||body.previousHash!==(current?hash(current.body):ZERO))reject('membership_gap');
    if(current&&manifest.contentEpoch<this.#journal.get('key-manifest').contentEpoch)reject('key_epoch_rollback');
    if(current){const oldManifest=this.#journal.get('key-manifest');if(manifest.keyCommitment===oldManifest.keyCommitment||manifest.salt===oldManifest.salt)reject('key_rotation_required');}
    const pairings=[],revoked=[];
    for(const old of current?.body.devices??[]){const next=body.devices.find(d=>d.deviceId===old.deviceId);if(!next)reject('device_history_required');const {state:_,...a}=old,{state:__,...b}=next;if(canonical(a)!==canonical(b))reject('device_identity_changed');if(old.state==='revoked'&&next.state!=='revoked')reject('device_revoked');if(old.state==='active'&&next.state==='revoked')revoked.push(old.deviceId);}
    for(const d of body.devices.filter(d=>!current?.body.devices.some(x=>x.deviceId===d.deviceId))){
      if(!current){if(body.devices.length!==1||d.state!=='active'||d.role!=='root'||d.pairingId!=='bootstrap')reject('bootstrap_root_required');continue;}
      const p=this.#journal.get('pairing:'+d.pairingId);if(!p||p.status!=='confirmed'||p.consumed||p.body.expiresAt<this.#now())reject('pairing_required');
      if(canonical({...p.body.joiningDevice,pairingId:d.pairingId})!==canonical(d)||this.#active(p.body.sponsorDeviceId).state!=='active')reject('pairing_required');pairings.push(d.pairingId);
    }
    return this.#write(body.operationId,request,tx=>{
      tx.set('membership',record);tx.set('membership-log:'+body.membershipEpoch,record);tx.set('key-manifest',manifest);tx.set('key-manifest:'+body.keyEpoch,manifest);
      for(const id of pairings)tx.set('pairing:'+id,{...tx.get('pairing:'+id),consumed:true});
      if(revoked.length){
        const previous=tx.get('revocation-head')??{sequence:0,hash:ZERO};
        const cutoffs=(tx.get('stream-ids')??[]).map(id=>({streamId:id,...tx.get('stream:'+id)})).filter(s=>revoked.includes(s.originDeviceId));
        const revocation={schemaVersion:1,type:'device',rootKeyId:body.rootKeyId,syncGroupId:body.syncGroupId,coordinatorId:body.coordinatorId,sequence:previous.sequence+1,previousHash:previous.hash,membershipHash:hash(body),revokedDeviceIds:revoked,cutoffs};
        const signed={body:revocation,signature:sign(['xiaok/context-sync/revocation/v1',revocation],this.#signing)};
        tx.set('revocation:'+revocation.sequence,signed);tx.set('revocation-head',{sequence:revocation.sequence,hash:hash(revocation)});
      }
      return {membershipHead:{epoch:body.membershipEpoch,hash:hash(body)},keyManifestHash:hash(manifest)};
    }).result;
  }
  registerScope({record,requestSource}){
    this.#live();user(requestSource);record=snapshot(record);this.#rootRecord(record,'scope',SCOPE_FIELDS);const b=record.body;
    for(const k of ['conversationId','branchId','logicalProfileId','ownerDeviceId'])identifier(b[k]);integer(b.revision,1);
    if(!Array.isArray(b.allowedDeviceIds)||!b.allowedDeviceIds.length||b.allowedDeviceIds.length>256||canonical([...new Set(b.allowedDeviceIds)].sort())!==canonical(b.allowedDeviceIds)||!b.allowedDeviceIds.includes(b.ownerDeviceId))reject('invalid_scope');
    for(const id of b.allowedDeviceIds)if(this.#active(id).logicalProfileId!==b.logicalProfileId)reject('profile_mapping_required');
    const request=this.#controlRequest('root:'+this.#identity.rootKeyId,'/v1/scopes',{record}),prior=this.#decision(b.operationId,request);if(prior!==undefined)return prior;
    const key='scope:'+hash([b.conversationId,b.branchId]),old=this.#journal.get(key);
    if(b.revision!==(old?.body.revision??0)+1||b.previousHash!==(old?hash(old.body):ZERO))reject('scope_revision_conflict');
    return this.#write(b.operationId,request,tx=>{
      tx.set(key,record);
      const removed=old?.body.allowedDeviceIds.filter(id=>!b.allowedDeviceIds.includes(id))??[];
      if(old&&(removed.length||old.body.logicalProfileId!==b.logicalProfileId||old.body.ownerDeviceId!==b.ownerDeviceId)){
        const previous=tx.get('revocation-head')??{sequence:0,hash:ZERO};
        const revocation={schemaVersion:1,type:'scope-policy',rootKeyId:b.rootKeyId,syncGroupId:b.syncGroupId,coordinatorId:b.coordinatorId,sequence:previous.sequence+1,previousHash:previous.hash,conversationId:b.conversationId,branchId:b.branchId,previousScopeHash:hash(old.body),scopeHash:hash(b),removedDeviceIds:removed};
        tx.set('revocation:'+revocation.sequence,{body:revocation,signature:sign(['xiaok/context-sync/revocation/v1',revocation],this.#signing)});tx.set('revocation-head',{sequence:revocation.sequence,hash:hash(revocation)});
      }
      return {scopeHash:hash(b)};
    }).result;
  }
  createChallenge({deviceId,clientNonce}){
    this.#live();this.#active(deviceId);const now=this.#now();for(const [id,c]of this.#challenges)if(c.expiresAt<=now)this.#challenges.delete(id);
    if(clientNonce!==undefined)unbase64(clientNonce,32);
    if(this.#challenges.size>=1024||[...this.#challenges.values()].filter(x=>x.deviceId===deviceId).length>=16)reject('challenge_capacity');
    const body={schemaVersion:1,rootKeyId:this.#identity.rootKeyId,syncGroupId:this.#identity.syncGroupId,coordinatorId:this.#identity.coordinatorId,deviceId,challengeId:base64(randomBytes(32)),expiresAt:now+30_000,...(clientNonce!==undefined?{clientNonce}:{})};this.#challenges.set(body.challengeId,body);
    return {body,signature:sign(['xiaok/context-sync/challenge/v1',body],this.#signing)};
  }
  #authenticate(req){
    exactObject(req,['method','path','auth','signature','body','requestSource']);exactObject(req.auth,AUTH_FIELDS);const a=req.auth;this.#scopeIdentity(a);
    if(a.method!=='POST'||req.method!==a.method||req.path!==a.path||a.bodyHash!==hash(req.body))reject('invalid_request');identifier(a.requestId);identifier(a.deviceId);
    const device=this.#active(a.deviceId),challenge=this.#challenges.get(a.challengeId);
    if(!challenge||challenge.deviceId!==a.deviceId||challenge.expiresAt<=this.#now())reject('challenge_unavailable');
    if(!verify(['xiaok/context-sync/request/v1',a],req.signature,unbase64(device.signingPublicKey,32)))reject('invalid_signature');
    this.#challenges.delete(a.challengeId);exactObject(a.expectedHead,['sequence','hash','identityHash']);integer(a.expectedHead.sequence);return {actor:device,challenge};
  }
  #scope(conversationId,branchId,actor){const s=this.#journal.get('scope:'+hash([conversationId,branchId]));if(!s||!s.body.allowedDeviceIds.includes(actor.deviceId)||s.body.logicalProfileId!==actor.logicalProfileId)reject('scope_forbidden');return s;}
  #current(a){if(canonical(a.expectedHead)!==canonical(this.#journal.head()))reject('head_changed');}
  #respond(req,result){const body={schemaVersion:1,rootKeyId:this.#identity.rootKeyId,syncGroupId:this.#identity.syncGroupId,coordinatorId:this.#identity.coordinatorId,deviceId:req.auth.deviceId,requestId:req.auth.requestId,path:req.path,requestBodyHash:hash(req.body),result,journalHead:this.#journal.head()};try{canonical({body,signature:'x'.repeat(86)});}catch{reject('response_too_large');}return {body,signature:sign(['xiaok/context-sync/response/v1',body],this.#signing)};}
  handle(request){
    this.#live();const req=snapshot(request),{actor,challenge}=this.#authenticate(req),a=req.auth;
    if(!['user','agent','scheduler'].includes(req.requestSource))reject('forbidden');
    if(req.path==='/v1/head'){
      exactObject(req.body,['nonce']);unbase64(req.body.nonce,32);const m=this.#membership();
      return this.#respond(req,{nonce:req.body.nonce,head:this.#journal.head(),membershipHead:{epoch:m.body.membershipEpoch,hash:hash(m.body)},keyManifestHash:hash(this.#journal.get('key-manifest')),revocationHead:this.#journal.get('revocation-head')??{sequence:0,hash:ZERO}});
    }
    if(req.path==='/v1/journal/pull'){
      exactObject(req.body,['after','limit','targetHead']);this.#current(a);if(canonical(req.body.targetHead)!==canonical(a.expectedHead))reject('head_changed');
      return this.#respond(req,{entries:this.#journal.readCommitments(req.body.after,req.body.limit),targetHead:a.expectedHead});
    }
    if(req.path==='/v1/events/pull'||req.path==='/v1/control/pull'){
      const events=req.path==='/v1/events/pull';
      exactObject(req.body,events?['conversationId','branchId','after','limit','targetHead']:['after','limit','targetHead']);
      if(events)this.#scope(req.body.conversationId,req.body.branchId,actor);
      this.#current(a);if(canonical(req.body.targetHead)!==canonical(a.expectedHead))reject('head_changed');
      const scanned=this.#journal.readJournal(req.body.after,req.body.limit),entries=[];
      const globalPaths=['/v1/membership','/v1/scopes','/v1/pairings/begin','/v1/pairings/confirm','/v1/content-revocations/append'];
      for(const row of scanned){
        if(events){
          if(row.request.path!=='/v1/events/push')continue;
          if(row.disclosureClass!=='scope-private'||row.recordType!=='event')reject('unknown_control_type');
          const h=row.request.body.envelope?.header;if(!h||h.conversationId!==req.body.conversationId||h.branchId!==req.body.branchId)continue;
          if(!isSingleScopeEventEntry(row))reject('private_entry_unavailable');
        }else {if(row.disclosureClass!=='global-control')continue;if(row.kind!=='control'||!globalPaths.includes(row.request.path)||CONTROL_TYPES[row.request.path]!==row.recordType)reject('unknown_control_type');}
        const {hash:entryHash,...entry}=row;entries.push({entry,commitment:{...journalCommitment(entry),hash:entryHash}});
      }
      return this.#respond(req,{entries,scannedUntil:scanned.at(-1)?.sequence??req.body.after,targetHead:a.expectedHead});
    }
    const stable=this.#controlRequest(a.deviceId,req.path,req.body);
    if(req.path==='/v1/pairings/begin'){
      user(req.requestSource);exactObject(req.body,['joiningDevice']);deviceRow(req.body.joiningDevice);const d=req.body.joiningDevice;
      if(d.state!=='active'||d.pairingId!=='pending'||this.#membership().body.devices.some(x=>x.deviceId===d.deviceId))reject('pairing_required');
      const prior=this.#decision(a.requestId,stable);if(prior!==undefined)return this.#respond(req,prior);this.#current(a);
      const pairing={schemaVersion:1,rootKeyId:this.#identity.rootKeyId,syncGroupId:this.#identity.syncGroupId,coordinatorId:this.#identity.coordinatorId,coordinatorCertificateHash:hash(this.#identity.certificate),pairingId:randomUUID(),sponsorDeviceId:actor.deviceId,sponsorSigningPublicKey:actor.signingPublicKey,sponsorEncryptionPublicKey:actor.encryptionPublicKey,sponsorRole:actor.role,joiningDevice:d,nonce:base64(randomBytes(32)),expiresAt:this.#now()+300_000};
      const result=this.#write(a.requestId,stable,tx=>{tx.set('pairing:'+pairing.pairingId,{body:pairing,status:'pending',consumed:false});return {pairing};}).result;
      return this.#respond(req,result);
    }
    if(req.path==='/v1/events/push')return this.#push(req,actor,stable);
    if(req.path==='/v1/key-use/consume')return this.#consumeKeyUse(req,actor,stable,challenge);
    if(req.path==='/v1/content-revocations/append')return this.#appendContentRevocation(req,actor,stable);
    reject('unknown_route');
  }
  confirmPairing({pairingId,sponsorSignature,joiningSignature,requestSource}){
    this.#live();user(requestSource);identifier(pairingId);const p=this.#journal.get('pairing:'+pairingId);if(!p||p.body.expiresAt<=this.#now()||p.consumed)reject('pairing_unavailable');
    const sponsor=this.#active(p.body.sponsorDeviceId);if(sponsor.signingPublicKey!==p.body.sponsorSigningPublicKey||sponsor.encryptionPublicKey!==p.body.sponsorEncryptionPublicKey||sponsor.role!==p.body.sponsorRole)reject('pairing_unavailable');
    const input=['xiaok/context-sync/pairing/v1',p.body];
    if(!verify(input,sponsorSignature,unbase64(sponsor.signingPublicKey,32))||!verify(input,joiningSignature,unbase64(p.body.joiningDevice.signingPublicKey,32)))reject('invalid_signature');
    const request=this.#controlRequest('both:'+pairingId,'/v1/pairings/confirm',{pairingId,sponsorSignature,joiningSignature});
    return this.#write(pairingId,request,tx=>{tx.set('pairing:'+pairingId,{...p,status:'confirmed',sponsorSignature,joiningSignature});return {confirmed:true};}).result;
  }
  handleControl({path,body,requestSource}){
    this.#live();user(requestSource);body=snapshot(body);let result,operationId;
    if(path==='/v1/membership'){exactObject(body,['record','manifest']);result=this.appendMembership({...body,requestSource});operationId=body.record.body.operationId;}
    else if(path==='/v1/scopes'){exactObject(body,['record']);result=this.registerScope({...body,requestSource});operationId=body.record.body.operationId;}
    else if(path==='/v1/pairings/confirm'){exactObject(body,['pairingId','sponsorSignature','joiningSignature']);result=this.confirmPairing({...body,requestSource});operationId=body.pairingId;}
    else reject('unknown_route');
    const response={schemaVersion:1,rootKeyId:this.#identity.rootKeyId,syncGroupId:this.#identity.syncGroupId,coordinatorId:this.#identity.coordinatorId,path,operationId,requestBodyHash:hash(body),result,journalHead:this.#journal.head()};
    return {body:response,signature:sign(['xiaok/context-sync/control-response/v1',response],this.#signing)};
  }
  #appendContentRevocation(req,actor,stable){
    user(req.requestSource);exactObject(req.body,['record']);const record=req.body.record,b=record?.body;
    const scope=this.#scope(b?.conversationId,b?.branchId,actor).body;
    validateContentRevocationRecord(record,{identity:this.#identity,device:actor,scope});
    // The inner source operation, not a replaceable network requestId, owns idempotence.
    const operation=hash(['content-revocation-operation/v1',b.conversationId,b.branchId,b.operationId]),prior=this.#decision(operation,stable);
    if(prior!==undefined)return this.#respond(req,prior);this.#current(req.auth);
    const parts=contentRevocationArtifacts(record,this.#journal.get('revocation-head'));
    assertContentRevocationPosition(b,{scope,head:this.#journal.get(parts.headKey)});
    const result=this.#write(operation,stable,tx=>{
      assertContentRevocationPosition(b,{scope,head:tx.get(parts.headKey)});
      tx.set(parts.recordKey,record);tx.set(parts.headKey,parts.head);
      for(const target of parts.tombstones)if(tx.get(target.key)===undefined)tx.set(target.key,target.value);
      tx.set('revocation:'+parts.revocation.sequence,{body:parts.revocation,signature:sign(['xiaok/context-sync/revocation/v1',parts.revocation],this.#signing)});
      const head={sequence:parts.revocation.sequence,hash:hash(parts.revocation)};tx.set('revocation-head',head);return {revocationHead:head,ownerRecordHash:hash(b)};
    }).result;return this.#respond(req,result);
  }
  #consumeKeyUse(req,actor,stable,challenge){
    if(!this.#identity.certificate.body.capabilities.includes('key-use-v1'))reject('key_use_unavailable');
    if(challenge.clientNonce===undefined)reject('key_use_unavailable');
    exactObject(req.body,['header','reservationId','workerBootId','useId','derivedKeyId']);const b=req.body,h=validateHeader(b.header);
    identifier(b.reservationId);identifier(b.useId);unbase64(b.workerBootId,32);
    if(h.rootKeyId!==this.#identity.rootKeyId||h.syncGroupId!==this.#identity.syncGroupId)reject('scope_mismatch');
    if(h.originDeviceId!==actor.deviceId)reject('origin_mismatch');this.#scope(h.conversationId,h.branchId,actor);
    const m=this.#membership().body,manifest=this.#journal.get('key-manifest');
    if(h.membershipEpoch!==m.membershipEpoch||h.keyEpoch!==m.keyEpoch||h.contentEpoch!==manifest.contentEpoch)reject('key_epoch_changed');
    const tuple=Object.fromEntries(['rootKeyId','syncGroupId','conversationId','branchId','keyEpoch','contentEpoch','originDeviceId'].map(k=>[k,h[k]]));
    const derivedKeyId=hash(['xiaok/context-sync/derived-key-id/v1',tuple,manifest.keyCommitment,manifest.salt]);if(b.derivedKeyId!==derivedKeyId)reject('key_use_unavailable');
    // This mutation is deliberately non-idempotent: a lost ACK burns the permit.
    if(this.#decision(req.auth.requestId,stable)!==undefined)reject('key_use_consumed');this.#current(req.auth);
    const nonceKey='key-use-nonce:'+derivedKeyId+':'+h.nonce,reservationKey='key-use-reservation:'+hash([actor.deviceId,b.reservationId]),countKey='key-use-count:'+derivedKeyId;
    const result=this.#write(req.auth.requestId,stable,tx=>{
      if(tx.get(nonceKey)!==undefined||tx.get(reservationKey)!==undefined)reject('key_use_consumed');
      const before=tx.get(countKey)??0;integer(before);if(before>=2**32)reject('key_use_exhausted');
      const permit={useId:b.useId,reservationId:b.reservationId,workerBootId:b.workerBootId,challengeId:req.auth.challengeId,headerHash:hash(h),derivedKeyId,count:before+1};
      tx.set(nonceKey,{reservationId:b.reservationId,deviceId:actor.deviceId});tx.set(reservationKey,{derivedKeyId,nonce:h.nonce});tx.set(countKey,permit.count);return permit;
    }).result;
    return this.#respond(req,result);
  }
  #push(req,actor,stable){
    exactObject(req.body,['envelope']);const envelope=req.body.envelope,h=envelope.header;
    if(!h||h.rootKeyId!==this.#identity.rootKeyId||h.syncGroupId!==this.#identity.syncGroupId)reject('scope_mismatch');
    this.#scope(h.conversationId,h.branchId,actor);const origin=this.#device(h.originDeviceId);verifyEnvelope(envelope,unbase64(origin.signingPublicKey,32));
    if(Buffer.byteLength(canonical(envelope))>512*1024)reject('event_too_large');
    const streamId=hash([h.syncGroupId,h.conversationId,h.branchId,h.originDeviceId,h.contentEpoch]),eventHash=hash(envelope),eventKey='event:'+streamId+':'+h.originSequence;
    const prior=this.#decision(req.auth.requestId,stable);if(prior!==undefined)return this.#respond(req,prior);
    const accepted=this.#journal.get(eventKey);
    if(accepted){
      if(accepted.accepted.eventHash!==eventHash)reject('event_conflict');this.#current(req.auth);
      const result=this.#write(req.auth.requestId,stable,()=>({accepted:accepted.accepted})).result;
      return this.#respond(req,result);
    }
    if(origin.state!=='active')reject('device_revoked');if(origin.deviceId!==actor.deviceId)reject('origin_mismatch');
    const m=this.#membership().body,manifest=this.#journal.get('key-manifest');
    if(h.membershipEpoch!==m.membershipEpoch||h.keyEpoch!==m.keyEpoch||h.contentEpoch!==manifest.contentEpoch)reject('key_epoch_changed');
    this.#current(req.auth);
    const stream=this.#journal.get('stream:'+streamId)??{sequence:0,hash:ZERO,originDeviceId:actor.deviceId};if(h.originSequence!==stream.sequence+1||h.previousEventHash!==stream.hash)reject('stream_gap');
    const size=Buffer.byteLength(canonical(envelope)),stored=this.#journal.get('relay-bytes')??0;if(stored+size>this.#maxBytes)reject('relay_quota');
    const receipt={streamId,originSequence:h.originSequence,eventHash,journalSequence:this.#journal.head().sequence+1};
    const result=this.#write(req.auth.requestId,stable,tx=>{
      const ids=tx.get('stream-ids')??[];if(!ids.includes(streamId)){if(ids.length>=4096)reject('stream_quota');tx.set('stream-ids',[...ids,streamId]);}
      tx.set('stream:'+streamId,{sequence:h.originSequence,hash:eventHash,originDeviceId:actor.deviceId});tx.set(eventKey,{envelope,accepted:receipt});tx.set('relay-bytes',stored+size);return {accepted:receipt};
    }).result;return this.#respond(req,result);
  }
  dispose(){this.#disposed=true;this.#signing.fill(0);this.#challenges.clear();}
}
