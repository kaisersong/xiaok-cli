import { canonical,exactObject,hash,hashBytes,identifier,integer,parseCanonical,unbase64,verify,verifyEnvelope,verifyKeyManifest } from './crypto.mjs';
import { journalCommitment } from './journal.mjs';
import { isSingleScopeEventEntry } from './event-entry.mjs';
import { validateCoordinatorIdentity } from './identity.mjs';
import {validateContentRevocationRecord,assertContentRevocationPosition,contentRevocationArtifacts,assertContentRevocationChanges} from './content-revocation.mjs';

const ZERO='0'.repeat(64);
const TYPES={membership:'/v1/membership',scope:'/v1/scopes','pairing-begin':'/v1/pairings/begin','pairing-confirm':'/v1/pairings/confirm',event:'/v1/events/push','key-use':'/v1/key-use/consume','content-revocation':'/v1/content-revocations/append'};
const PROOF_FIELDS=['schemaVersion','identityHash','sequence','previousHash','operationId','kind','recordType','disclosureClass','scopeDigest','requestHash','entryHash','hash'];
const ENTRY_FIELDS=['schemaVersion','identityHash','sequence','previousHash','operationId','requestHash','kind','recordType','disclosureClass','scopeDigest','request','result','changes'];
const MEMBER_FIELDS=['schemaVersion','rootKeyId','syncGroupId','coordinatorId','operationId','membershipEpoch','keyEpoch','previousHash','devices'];
const SCOPE_FIELDS=['schemaVersion','rootKeyId','syncGroupId','coordinatorId','operationId','conversationId','branchId','logicalProfileId','ownerDeviceId','allowedDeviceIds','revision','previousHash'];
const DEVICE_FIELDS=['deviceId','state','role','signingPublicKey','encryptionPublicKey','logicalProfileId','pairingId'];
function fail(code='invalid_sync_proof'){throw new Error(code);}
function equal(a,b,code){if(canonical(a)!==canonical(b))fail(code);}
function digest(value){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail();}
function snapshot(value){return parseCanonical(Buffer.from(canonical(value)));}
function inputFields(value){
  const required=['identity','deviceId','scope','firstNonce','firstHead','finalNonce','finalHead','commitments','controlEntries','privateEntries'];
  if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length)fail();
  const keys=Object.getOwnPropertyNames(value);if(required.some(k=>!keys.includes(k))||keys.some(k=>!required.includes(k)&&k!=='minimumHead'))fail();
  const out={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(!d.enumerable||!('value' in d))fail();out[key]=['commitments','controlEntries','privateEntries'].includes(key)?d.value:snapshot(d.value);}
  for(const key of ['commitments','controlEntries','privateEntries'])if(!Array.isArray(out[key])||Object.keys(out[key]).length!==out[key].length)fail();return out;
}
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function head(value,identityHash){exactObject(value,['sequence','hash','identityHash']);integer(value.sequence);digest(value.hash);if(value.identityHash!==identityHash)fail('invalid_head');}
function identityScope(value,identity){if(value.schemaVersion!==1)fail();for(const field of ['rootKeyId','syncGroupId','coordinatorId'])if(value[field]!==identity[field])fail();}
function trust(identity){const validated=validateCoordinatorIdentity(identity);return {root:validated.rootPublicKey,online:validated.coordinatorPublicKey};}
function verifyHead(response,nonce,identity,deviceId,online){
  try{
    unbase64(nonce,32);exactObject(response,['body','signature']);const b=response.body;
    exactObject(b,['schemaVersion','rootKeyId','syncGroupId','coordinatorId','deviceId','requestId','path','requestBodyHash','result','journalHead']);identityScope(b,identity);
    if(b.deviceId!==deviceId||b.path!=='/v1/head'||b.requestBodyHash!==hash({nonce})||!verify(['xiaok/context-sync/response/v1',b],response.signature,online))fail();identifier(b.requestId);
    exactObject(b.result,['nonce','head','membershipHead','keyManifestHash','revocationHead']);if(b.result.nonce!==nonce)fail();
    head(b.result.head,hash(identity));equal(b.result.head,b.journalHead);exactObject(b.result.membershipHead,['epoch','hash']);integer(b.result.membershipHead.epoch,1);digest(b.result.membershipHead.hash);digest(b.result.keyManifestHash);exactObject(b.result.revocationHead,['sequence','hash']);integer(b.result.revocationHead.sequence);digest(b.result.revocationHead.hash);return b.result;
  }catch{fail('invalid_head');}
}
function rootRecord(record,type,fields,identity,root){exactObject(record,['body','signature']);exactObject(record.body,fields);identityScope(record.body,identity);identifier(record.body.operationId);if(!verify(['xiaok/context-sync/'+type+'/v1',record.body],record.signature,root))fail('invalid_root_signature');}
function validateDevice(d){exactObject(d,DEVICE_FIELDS);identifier(d.deviceId);identifier(d.logicalProfileId);identifier(d.pairingId);unbase64(d.signingPublicKey,32);unbase64(d.encryptionPublicKey,32);if(!['active','revoked'].includes(d.state)||!['root','member'].includes(d.role))fail();}
function validateDevices(devices,old=[]){
  if(!Array.isArray(devices)||!devices.length||devices.length>256)fail();let last='';const keys=new Set();
  for(const d of devices){validateDevice(d);if(d.deviceId<=last||keys.has(d.signingPublicKey)||keys.has(d.encryptionPublicKey))fail();last=d.deviceId;keys.add(d.signingPublicKey);keys.add(d.encryptionPublicKey);}
  for(const previous of old){const current=devices.find(d=>d.deviceId===previous.deviceId);if(!current||previous.state==='revoked'&&current.state!=='revoked')fail();const {state:_,...a}=previous,{state:__,...b}=current;equal(a,b);}
  if(!devices.some(d=>d.state==='active'&&d.role==='root'))fail();
}
function full(bundle,proofs){
  exactObject(bundle,['entry','commitment']);exactObject(bundle.entry,ENTRY_FIELDS);const p=proofs.get(bundle.entry.sequence);if(!p)fail();equal(bundle.commitment,p);
  const {hash:_,...commitment}=p;equal(journalCommitment(bundle.entry),commitment);if(hash({kind:bundle.entry.kind,request:bundle.entry.request})!==bundle.entry.requestHash)fail();
  const r=bundle.entry.request;exactObject(r,['actor','method','path','rootKeyId','syncGroupId','coordinatorId','body']);if(r.method!=='POST'||r.path!==TYPES[bundle.entry.recordType])fail();return bundle.entry;
}

/** Verifies transport catch-up only. Output stays ciphertext candidates; OS durable heads and
 * AEAD verification are still required by the main owner before canonical storage or disclosure. */
export function verifyCatchUp(input){
  // Each wire record has its own bounded canonical budget. A complete paginated history is
  // not one wire record and must not inherit its 2 MiB limit or be silently truncated.
  const args=inputFields(input),{identity,deviceId,scope}=args,{root,online}=trust(identity);identifier(deviceId);exactObject(scope,['conversationId','branchId']);identifier(scope.conversationId);identifier(scope.branchId);
  if(args.firstNonce===args.finalNonce)fail('invalid_head');
  const first=verifyHead(args.firstHead,args.firstNonce,identity,deviceId,online),final=verifyHead(args.finalHead,args.finalNonce,identity,deviceId,online);
  equal(first.head,final.head,'head_changed');equal({...first,nonce:null},{...final,nonce:null},'head_changed');
  if(args.minimumHead){head(args.minimumHead,hash(identity));if(first.head.sequence<args.minimumHead.sequence||first.head.sequence===args.minimumHead.sequence&&first.head.hash!==args.minimumHead.hash)fail('head_rollback');}
  const scopeDigest=hash(['xiaok/context-sync/scope/v1',identity.rootKeyId,identity.syncGroupId,scope.conversationId,scope.branchId]);
  const proofs=new Map();let previousHash=hash(['xiaok/context-sync/authority-genesis/v2',identity]),sequence=0;
  if(!Array.isArray(args.commitments)||!Array.isArray(args.controlEntries)||!Array.isArray(args.privateEntries))fail();
  for(const raw of args.commitments){const p=snapshot(raw);
    exactObject(p,PROOF_FIELDS);if(p.schemaVersion!==2||p.kind!=='control'||p.identityHash!==hash(identity)||p.sequence!==++sequence||p.previousHash!==previousHash||!Object.hasOwn(TYPES,p.recordType))fail();
    const privateRecord=p.recordType==='event'||p.recordType==='key-use';if(p.recordType==='key-use'&&!identity.certificate.body.capabilities.includes('key-use-v1'))fail();if(p.disclosureClass!==(privateRecord?'scope-private':'global-control')||(privateRecord?typeof p.scopeDigest!=='string':p.scopeDigest!==null))fail();
    for(const f of ['hash','entryHash','requestHash'])digest(p[f]);if(privateRecord)digest(p.scopeDigest);
    const {hash:_,...body}=p;if(hash(body)!==p.hash)fail();previousHash=p.hash;proofs.set(p.sequence,p);
  }
  if(sequence!==first.head.sequence||previousHash!==first.head.hash)fail('incomplete_journal');
  if(args.minimumHead){
    const ancestor=args.minimumHead.sequence===0?hash(['xiaok/context-sync/authority-genesis/v2',identity]):proofs.get(args.minimumHead.sequence)?.hash;
    if(ancestor!==args.minimumHead.hash)fail('head_rollback');
  }
  const globalProofs=[...proofs.values()].filter(p=>p.disclosureClass==='global-control');
  if(args.controlEntries.length!==globalProofs.length)fail('incomplete_control');
  const controls=args.controlEntries.map(b=>full(snapshot(b),proofs)).sort((a,b)=>a.sequence-b.sequence);
  if(controls.some((e,i)=>e.sequence!==globalProofs[i].sequence))fail('incomplete_control');
  const memberships=[],scopes=new Map(),scopeHistory=new Map(),revocations=[],contentHeads=new Map(),contentTombstones=new Map(),contentOperations=new Map();let membership,manifest,revocationHead={sequence:0,hash:ZERO};
  for(const e of controls){
    const r=e.request;for(const k of ['rootKeyId','syncGroupId','coordinatorId'])if(r[k]!==identity[k])fail();
    let expectedRevocation=null,contentChanges=null;
    if(e.recordType==='membership'){
      exactObject(r.body,['record','manifest']);const record=r.body.record,next=record.body;rootRecord(record,'membership',MEMBER_FIELDS,identity,root);validateDevices(next.devices,membership?.body.devices);
      if(next.membershipEpoch!==(membership?.body.membershipEpoch??0)+1||next.keyEpoch!==(membership?.body.keyEpoch??0)+1||next.previousHash!==(membership?hash(membership.body):ZERO))fail();
      if(!membership&&(next.devices.length!==1||next.devices[0].role!=='root'||next.devices[0].pairingId!=='bootstrap'))fail();
      const nextManifest=r.body.manifest;verifyKeyManifest({manifest:nextManifest,membership:next,expected:{rootKeyId:identity.rootKeyId,syncGroupId:identity.syncGroupId,membershipEpoch:next.membershipEpoch,keyEpoch:next.keyEpoch,contentEpoch:nextManifest.contentEpoch,membershipHash:hash(next)},rootPublicKey:root});
      if(manifest&&(nextManifest.keyCommitment===manifest.keyCommitment||nextManifest.salt===manifest.salt||nextManifest.contentEpoch<manifest.contentEpoch))fail();
      const revoked=(membership?.body.devices??[]).filter(d=>d.state==='active'&&next.devices.find(n=>n.deviceId===d.deviceId)?.state==='revoked').map(d=>d.deviceId);
      if(revoked.length)expectedRevocation={type:'device',membershipHash:hash(next),revokedDeviceIds:revoked};
      membership=record;manifest=nextManifest;memberships.push({sequence:e.sequence,record,manifest});
    }else if(e.recordType==='scope'){
      exactObject(r.body,['record']);const record=r.body.record;rootRecord(record,'scope',SCOPE_FIELDS,identity,root);const b=record.body,key=hash([b.conversationId,b.branchId]),old=scopes.get(key);
      for(const k of ['conversationId','branchId','logicalProfileId','ownerDeviceId'])identifier(b[k]);if(!Array.isArray(b.allowedDeviceIds)||!b.allowedDeviceIds.length||canonical([...new Set(b.allowedDeviceIds)].sort())!==canonical(b.allowedDeviceIds)||!b.allowedDeviceIds.includes(b.ownerDeviceId))fail();
      for(const id of b.allowedDeviceIds){const d=membership?.body.devices.find(d=>d.deviceId===id);if(!d||d.state!=='active'||d.logicalProfileId!==b.logicalProfileId)fail();}
      if(b.revision!==(old?.body.revision??0)+1||b.previousHash!==(old?hash(old.body):ZERO))fail();
      const removed=old?.body.allowedDeviceIds.filter(id=>!b.allowedDeviceIds.includes(id))??[];
      if(old&&(removed.length||old.body.logicalProfileId!==b.logicalProfileId||old.body.ownerDeviceId!==b.ownerDeviceId))expectedRevocation={type:'scope-policy',conversationId:b.conversationId,branchId:b.branchId,previousScopeHash:hash(old.body),scopeHash:hash(b),removedDeviceIds:removed};
      scopes.set(key,record);const history=scopeHistory.get(key)??[];history.push({sequence:e.sequence,record});scopeHistory.set(key,history);
    }else if(e.recordType==='content-revocation'){
      exactObject(r.body,['record']);const record=r.body.record,b=record?.body,scope=scopes.get(hash([b?.conversationId,b?.branchId]))?.body,device=membership?.body.devices.find(d=>d.deviceId===r.actor);
      validateContentRevocationRecord(record,{identity,device,scope});
      const parts=contentRevocationArtifacts(record,revocationHead);assertContentRevocationPosition(b,{scope,head:contentHeads.get(parts.streamId)});
      const operation=hash([r.actor,b.conversationId,b.branchId,b.operationId]);if(contentOperations.has(operation))fail('content_revocation_conflict');contentOperations.set(operation,hash(b));
      contentHeads.set(parts.streamId,parts.head);expectedRevocation=parts.revocation;
      contentChanges=new Map([[parts.recordKey,record],[parts.headKey,parts.head]]);
      for(const target of parts.tombstones)if(!contentTombstones.has(target.key)){contentTombstones.set(target.key,target.value);contentChanges.set(target.key,target.value);}
    }else if(e.recordType==='pairing-begin'){exactObject(r.body,['joiningDevice']);validateDevice(r.body.joiningDevice);if(r.body.joiningDevice.state!=='active'||r.body.joiningDevice.pairingId!=='pending')fail();}
    else if(e.recordType==='pairing-confirm'){exactObject(r.body,['pairingId','sponsorSignature','joiningSignature']);identifier(r.body.pairingId);unbase64(r.body.sponsorSignature,64);unbase64(r.body.joiningSignature,64);}
    const revs=e.changes.filter(c=>/^revocation:[0-9]+$/.test(c.key));
    if(revs.length!==(expectedRevocation?1:0))fail('incomplete_revocation');
    for(const change of revs){
      const signed=change.value;exactObject(signed,['body','signature']);const b=signed.body;identityScope(b,identity);
      if(b.type==='device'){
        exactObject(b,['schemaVersion','type','rootKeyId','syncGroupId','coordinatorId','sequence','previousHash','membershipHash','revokedDeviceIds','cutoffs']);
        if(!Array.isArray(b.cutoffs)||b.cutoffs.length>4096||new Set(b.cutoffs.map(c=>c.streamId)).size!==b.cutoffs.length)fail('invalid_cutoff');
        for(const c of b.cutoffs){exactObject(c,['streamId','sequence','hash','originDeviceId']);digest(c.streamId);digest(c.hash);integer(c.sequence,1);if(!b.revokedDeviceIds.includes(c.originDeviceId))fail('invalid_cutoff');}
      }else if(b.type==='scope-policy')exactObject(b,['schemaVersion','type','rootKeyId','syncGroupId','coordinatorId','sequence','previousHash','conversationId','branchId','previousScopeHash','scopeHash','removedDeviceIds']);
      else if(b.type==='content'&&e.recordType==='content-revocation')exactObject(b,Object.keys(expectedRevocation));
      else fail('invalid_revocation');
      if(!verify(['xiaok/context-sync/revocation/v1',b],signed.signature,online)||b.sequence!==revocationHead.sequence+1||b.previousHash!==revocationHead.hash)fail('invalid_revocation');
      for(const [k,v]of Object.entries(expectedRevocation))equal(b[k],v);
      revocationHead={sequence:b.sequence,hash:hash(b)};revocations.push({...signed,journalSequence:e.sequence});
      if(contentChanges){contentChanges.set('revocation:'+b.sequence,signed);contentChanges.set('revocation-head',revocationHead);assertContentRevocationChanges(e,contentChanges);}
    }
  }
  if(!membership||hash(membership.body)!==first.membershipHead.hash||membership.body.membershipEpoch!==first.membershipHead.epoch||hash(manifest)!==first.keyManifestHash)fail('incomplete_control');equal(revocationHead,first.revocationHead,'incomplete_revocation');
  const currentDevice=membership.body.devices.find(d=>d.deviceId===deviceId),currentScope=scopes.get(hash([scope.conversationId,scope.branchId]));
  if(!currentDevice||currentDevice.state!=='active')fail('device_revoked');
  if(!currentScope||!currentScope.body.allowedDeviceIds.includes(deviceId)||currentScope.body.logicalProfileId!==currentDevice.logicalProfileId)fail('scope_forbidden');
  const privateProofs=[...proofs.values()].filter(p=>p.recordType==='event'&&p.scopeDigest===scopeDigest);
  if(args.privateEntries.length!==privateProofs.length)fail('incomplete_scope');const entries=args.privateEntries.map(b=>full(snapshot(b),proofs)).sort((a,b)=>a.sequence-b.sequence);if(entries.some((e,i)=>e.sequence!==privateProofs[i].sequence))fail('incomplete_scope');
  const streams=new Map(),accepted=new Map(),events=[];
  for(const e of entries){
    if(!isSingleScopeEventEntry(e))fail('mixed_private_entry');
    exactObject(e.request.body,['envelope']);exactObject(e.result,['accepted']);const envelope=e.request.body.envelope,h=envelope.header,receipt=e.result.accepted;exactObject(receipt,['streamId','originSequence','eventHash','journalSequence']);
    if(e.scopeDigest!==scopeDigest||h.rootKeyId!==identity.rootKeyId||h.syncGroupId!==identity.syncGroupId||h.conversationId!==scope.conversationId||h.branchId!==scope.branchId)fail('scope_forbidden');
    const eventHash=hash(envelope),streamId=hash([h.syncGroupId,h.conversationId,h.branchId,h.originDeviceId,h.contentEpoch]),key=streamId+':'+h.originSequence;
    if(receipt.streamId!==streamId||receipt.originSequence!==h.originSequence||receipt.eventHash!==eventHash)fail();
    const duplicate=accepted.get(key);if(duplicate){equal(duplicate,receipt);continue;}
    if(receipt.journalSequence!==e.sequence||e.request.actor!==h.originDeviceId)fail();
    const atAcceptance=memberships.findLast(m=>m.sequence<e.sequence);if(!atAcceptance||h.membershipEpoch!==atAcceptance.record.body.membershipEpoch||h.keyEpoch!==atAcceptance.record.body.keyEpoch||h.contentEpoch!==atAcceptance.manifest.contentEpoch)fail();
    const origin=atAcceptance.record.body.devices.find(d=>d.deviceId===h.originDeviceId);if(!origin||origin.state!=='active')fail('device_revoked');
    const acceptedScopeRecord=scopeHistory.get(hash([h.conversationId,h.branchId]))?.findLast(s=>s.sequence<e.sequence)?.record;
    const acceptedScope=acceptedScopeRecord?.body;
    if(!acceptedScope||!acceptedScope.allowedDeviceIds.includes(origin.deviceId)||acceptedScope.logicalProfileId!==origin.logicalProfileId)fail('scope_forbidden');
    verifyEnvelope(envelope,unbase64(origin.signingPublicKey,32));
    const stream=streams.get(streamId)??{sequence:0,hash:ZERO,originDeviceId:h.originDeviceId};if(h.originSequence!==stream.sequence+1||h.previousEventHash!==stream.hash)fail('incomplete_stream');
    streams.set(streamId,{sequence:h.originSequence,hash:eventHash,originDeviceId:h.originDeviceId});accepted.set(key,receipt);events.push({envelope,eventHash,accepted:receipt,membership:atAcceptance.record,keyManifest:atAcceptance.manifest,acceptedScope:acceptedScopeRecord});
  }
  for(const rev of revocations.filter(r=>r.body.type==='device')){
    const expected=new Set(events.filter(e=>e.accepted.journalSequence<rev.journalSequence&&rev.body.revokedDeviceIds.includes(e.envelope.header.originDeviceId)).map(e=>e.accepted.streamId));
    for(const id of expected){const cutoffs=rev.body.cutoffs.filter(c=>c.streamId===id),stream=streams.get(id);if(cutoffs.length!==1||stream.sequence!==cutoffs[0].sequence||stream.hash!==cutoffs[0].hash||stream.originDeviceId!==cutoffs[0].originDeviceId)fail('invalid_cutoff');}
  }
  return freeze({status:'verified-control-only',head:first.head,membership,keyManifest:manifest,scope:currentScope,revocations,events});
}
