import { canonical,exactObject,hash,hashBytes,identifier,integer,parseCanonical,unbase64,verify } from './crypto.mjs';
const CAPABILITIES=[['head','receipt','authority'],['head','receipt','authority','key-use-v1']];

export function validateCoordinatorIdentity(input){
  const identity=parseCanonical(Buffer.from(canonical(input)));exactObject(identity,['rootKeyId','rootPublicKey','syncGroupId','coordinatorId','certificate']);
  for(const k of ['rootKeyId','syncGroupId','coordinatorId'])identifier(identity[k]);
  const rootPublicKey=unbase64(identity.rootPublicKey,32),certificate=identity.certificate;exactObject(certificate,['body','signature']);
  exactObject(certificate.body,['schemaVersion','rootKeyId','syncGroupId','coordinatorId','generation','coordinatorPublicKey','capabilities','deploymentMode']);
  if(!['self-hosted','test'].includes(certificate.body.deploymentMode)||hashBytes(rootPublicKey)!==identity.rootKeyId||certificate.body.schemaVersion!==1||certificate.body.generation!==1||!CAPABILITIES.some(value=>canonical(certificate.body.capabilities)===canonical(value)))throw new Error('invalid_certificate');
  for(const k of ['rootKeyId','syncGroupId','coordinatorId'])if(certificate.body[k]!==identity[k])throw new Error('invalid_certificate');
  if(!verify(['xiaok/context-sync/coordinator-certificate/v1',certificate.body],certificate.signature,rootPublicKey))throw new Error('invalid_certificate');
  return {identity,rootPublicKey,coordinatorPublicKey:unbase64(certificate.body.coordinatorPublicKey,32)};
}
export function verifyServerResponse({response,identity,coordinatorPublicKey,path,requestId,deviceId,requestBodyHash,operationId,control=false}){
  exactObject(response,['body','signature']);const b=response.body;
  exactObject(b,control?['schemaVersion','rootKeyId','syncGroupId','coordinatorId','path','operationId','requestBodyHash','result','journalHead']:['schemaVersion','rootKeyId','syncGroupId','coordinatorId','deviceId','requestId','path','requestBodyHash','result','journalHead']);
  if(b.schemaVersion!==1||b.path!==path||b.requestBodyHash!==requestBodyHash||(control&&b.operationId!==operationId))throw new Error('invalid_response');
  for(const k of ['rootKeyId','syncGroupId','coordinatorId'])if(b[k]!==identity[k])throw new Error('invalid_response');
  if(!control&&(b.deviceId!==deviceId||b.requestId!==requestId))throw new Error('invalid_response');
  if(!verify(['xiaok/context-sync/'+(control?'control-response':'response')+'/v1',b],response.signature,coordinatorPublicKey))throw new Error('invalid_response');
  exactObject(b.journalHead,['identityHash','sequence','hash']);integer(b.journalHead.sequence);if(b.journalHead.identityHash!==hash(identity)||!/^[a-f0-9]{64}$/.test(b.journalHead.hash))throw new Error('invalid_response');return response;
}
