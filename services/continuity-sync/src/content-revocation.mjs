import {canonical,exactObject,hash,identifier,integer,unbase64,verify} from './crypto.mjs';
const ZERO='0'.repeat(64),DOMAIN='xiaok/context-sync/content-revocation/v1';
const FIELDS=['schemaVersion','rootKeyId','syncGroupId','coordinatorId','operationId','conversationId','branchId','logicalProfileId','ownerDeviceId','scopeRevision','sourceSequence','previousHash','targets'];
const KINDS=new Set(['conversation','message','reference','grant','dependency']);
function fail(){throw new Error('invalid_content_revocation');}
/** Only wire/schema/signature checks. Local source authorization stays with its main owner. */
export function validateContentRevocationRecord(record,{identity,device,scope}){
 exactObject(record,['body','signature']);const b=record.body;exactObject(b,FIELDS);
 if(b.schemaVersion!==1)fail();for(const name of ['rootKeyId','syncGroupId','coordinatorId'])if(b[name]!==identity[name])fail();
 for(const name of ['operationId','conversationId','branchId','logicalProfileId','ownerDeviceId'])identifier(b[name]);
 integer(b.scopeRevision,1);integer(b.sourceSequence,1);if(typeof b.previousHash!=='string'||!/^[a-f0-9]{64}$/.test(b.previousHash))fail();
 if(!device||device.state!=='active'||!scope||device.deviceId!==b.ownerDeviceId||scope.ownerDeviceId!==b.ownerDeviceId||scope.conversationId!==b.conversationId||scope.branchId!==b.branchId||scope.logicalProfileId!==b.logicalProfileId||device.logicalProfileId!==b.logicalProfileId||!scope.allowedDeviceIds.includes(b.ownerDeviceId))throw new Error('scope_forbidden');
 if(!verify([DOMAIN,b],record.signature,unbase64(device.signingPublicKey,32)))throw new Error('invalid_signature');
 if(!Array.isArray(b.targets)||!b.targets.length||b.targets.length>64)fail();let previous='';
 for(const target of b.targets){exactObject(target,['kind','id']);identifier(target.id);if(!KINDS.has(target.kind)||target.kind==='conversation'&&target.id!==b.conversationId)fail();const key=target.kind+'\0'+target.id;if(key<=previous)fail();previous=key;}
 return b;
}
export function assertContentRevocationPosition(body,{scope,head={sequence:0,hash:ZERO}}){
 if(body.scopeRevision!==scope.revision||body.sourceSequence!==head.sequence+1||body.previousHash!==head.hash)throw new Error('content_revocation_conflict');
}
export function contentRevocationArtifacts(record,previousRevocationHead={sequence:0,hash:ZERO}){
 const b=record.body,ownerRecordHash=hash(b),scope=[b.rootKeyId,b.syncGroupId,b.conversationId,b.branchId];
 const streamId=hash(['xiaok/context-sync/content-owner-stream/v1',...scope,b.ownerDeviceId]);
 const revocation={schemaVersion:1,type:'content',rootKeyId:b.rootKeyId,syncGroupId:b.syncGroupId,coordinatorId:b.coordinatorId,sequence:previousRevocationHead.sequence+1,previousHash:previousRevocationHead.hash,conversationId:b.conversationId,branchId:b.branchId,ownerDeviceId:b.ownerDeviceId,ownerRecordHash,sourceSequence:b.sourceSequence,targets:b.targets};
 return {streamId,recordKey:'content-revocation:'+streamId+':'+b.sourceSequence,headKey:'content-revocation-head:'+streamId,head:{sequence:b.sourceSequence,hash:ownerRecordHash},revocation,
  tombstones:b.targets.map(target=>({key:'content-tombstone:'+hash(['xiaok/context-sync/content-tombstone/v1',...scope,target.kind,target.id]),value:{rootKeyId:b.rootKeyId,syncGroupId:b.syncGroupId,conversationId:b.conversationId,branchId:b.branchId,target,ownerDeviceId:b.ownerDeviceId,ownerRecordHash,sourceSequence:b.sourceSequence}}))};
}
/** A content entry has only its exact public metadata; no other private control rows. */
export function assertContentRevocationChanges(entry,expected){
 if(entry.changes.length!==expected.size)fail();const seen=new Set();
 for(const change of entry.changes){exactObject(change,['key','deleted','value']);if(change.deleted!==false||seen.has(change.key)||!expected.has(change.key)||canonical(change.value)!==canonical(expected.get(change.key)))fail();seen.add(change.key);}
}
