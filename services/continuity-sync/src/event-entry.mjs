import { canonical,exactObject,hash,integer,validateHeader } from './crypto.mjs';

/** A full private journal entry may be disclosed only when every private field has one scope. */
export function isSingleScopeEventEntry(entry){
  try{
    if(entry.schemaVersion!==2||entry.kind!=='control'||entry.recordType!=='event'||entry.disclosureClass!=='scope-private')return false;
    exactObject(entry.request,['actor','method','path','rootKeyId','syncGroupId','coordinatorId','body']);
    if(entry.request.method!=='POST'||entry.request.path!=='/v1/events/push')return false;
    exactObject(entry.request.body,['envelope']);exactObject(entry.result,['accepted']);exactObject(entry.result.accepted,['streamId','originSequence','eventHash','journalSequence']);
    const envelope=entry.request.body.envelope,h=validateHeader(envelope.header),receipt=entry.result.accepted;
    if(entry.scopeDigest!==hash(['xiaok/context-sync/scope/v1',h.rootKeyId,h.syncGroupId,h.conversationId,h.branchId])||entry.request.rootKeyId!==h.rootKeyId||entry.request.syncGroupId!==h.syncGroupId)return false;
    const id=hash([h.syncGroupId,h.conversationId,h.branchId,h.originDeviceId,h.contentEpoch]);
    integer(receipt.journalSequence,1);if(receipt.streamId!==id||receipt.originSequence!==h.originSequence||receipt.eventHash!==hash(envelope))return false;
    if(!Array.isArray(entry.changes))return false;
    // A replay decision adds no content or stream state. Its receipt must point backwards.
    if(receipt.journalSequence<entry.sequence)return entry.changes.length===0;
    if(receipt.journalSequence!==entry.sequence||entry.request.actor!==h.originDeviceId)return false;
    const keys=new Set();
    for(const c of entry.changes){
      exactObject(c,['key','deleted','value']);if(c.deleted!==false||keys.has(c.key))return false;keys.add(c.key);
      if(c.key==='event:'+id+':'+h.originSequence){exactObject(c.value,['envelope','accepted']);if(canonical(c.value.envelope)!==canonical(envelope)||canonical(c.value.accepted)!==canonical(receipt))return false;}
      else if(c.key==='stream:'+id){exactObject(c.value,['sequence','hash','originDeviceId']);if(c.value.sequence!==h.originSequence||c.value.hash!==hash(envelope)||c.value.originDeviceId!==h.originDeviceId)return false;}
      else if(c.key==='relay-bytes')integer(c.value);
      else if(c.key==='stream-ids'){if(!Array.isArray(c.value)||c.value.length>4096||new Set(c.value).size!==c.value.length||!c.value.includes(id)||c.value.some(v=>typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v)))return false;}
      else return false;
    }
    return keys.has('event:'+id+':'+h.originSequence)&&keys.has('stream:'+id)&&keys.has('relay-bytes');
  }catch{return false;}
}
