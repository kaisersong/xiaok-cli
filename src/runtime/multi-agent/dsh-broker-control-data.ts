import {createHash,createHmac,Hash,Hmac,timingSafeEqual} from 'node:crypto';
import {captureGithubReadData,githubReadFreeze} from './dsh-github-read-data.js';
import {dshSourceScopeIdentity} from './dsh-source-configuration.js';
import {dshAFields,dshAHash,dshAJson} from './dsh-admission-data.js';
const apply=Reflect.apply,hashUpdate=Hash.prototype.update,hashDigest=Hash.prototype.digest,hmacUpdate=Hmac.prototype.update,hmacDigest=Hmac.prototype.digest,bytes=Buffer.from;
const safe=Number.isSafeInteger,regexp=RegExp.prototype.test,trim=String.prototype.trim,starts=String.prototype.startsWith,slice=String.prototype.slice,own=Object.hasOwn;
const matches=(pattern:RegExp,value:string)=>apply(regexp,pattern,[value]) as boolean;
function sha(text:string):string{const hash=createHash('sha256');apply(hashUpdate,hash,[text]);return apply(hashDigest,hash,['hex']) as string;}
const rejections=new WeakMap<object,string>();
export function readBrokerControlRejection(raw:unknown):string|undefined{return raw!==null&&(typeof raw==='object'||typeof raw==='function')?rejections.get(raw):undefined;}
function fail():never{throw Error('BROKER_DSH_CONTROL_CONFLICT');}
export function brokerAdmissionDigest(raw:unknown):string {
 const value=captureGithubReadData(raw),hash=createHash('sha256');apply(hashUpdate,hash,['xiaok.broker-admission.v1\0'+dshAJson(value)]);return apply(hashDigest,hash,['hex']) as string;
}
/** Protocol authentication checks the exact original request, not a caller
 * claimed receipt hash. It grants no Main/Broker/DSH authority on its own. */
export function readBrokerAdmissionReply(token:string,challenge:string,input:unknown,raw:unknown):Readonly<Record<string,unknown>> {
 const reply=captureGithubReadData(raw);dshAFields(reply,['protocol','challenge','requestDigest','body','authentication']);
 const requestDigest=brokerAdmissionDigest(input);
 if(reply.protocol!=='broker_dsh_control_v1'||reply.challenge!==challenge||reply.requestDigest!==requestDigest||typeof reply.authentication!=='string'||!matches(/^[a-f0-9]{64}$/,reply.authentication))fail();
 const state=createHmac('sha256',token);apply(hmacUpdate,state,['xiaok.broker-dsh-reply.v1\0'+dshAJson({protocol:reply.protocol,challenge,requestDigest,body:reply.body})]);
 const expected=apply(hmacDigest,state,[]) as Buffer;
 if(!timingSafeEqual(expected,bytes(reply.authentication,'hex')))fail();
 const body=reply.body;
 if(body&&typeof body==='object'&&(body as Record<string,unknown>).ok===false){dshAFields(body,['ok','code']);if(typeof body.code!=='string'||!matches(/^admission_[a-z_]+$/,body.code))fail();const error=Error('BROKER_DSH_CONTROL_REJECTED');rejections.set(error,body.code);throw error;}
 dshAFields(body,['ok','domain','visibility','receipt','current']);if(body.ok!==true||typeof body.current!=='boolean')fail();
 const domain=body.domain;dshAFields(domain,['schemaVersion','kind','ownerKind','domainId','storeId','scope','writerProfile','writerSchemaVersion']);
 if(domain.schemaVersion!==1||domain.kind!=='broker_dsh'||domain.ownerKind!=='active_pointer'||domain.writerProfile!=='broker_dsh_control_v1'||domain.writerSchemaVersion!==9||typeof domain.storeId!=='string'||!matches(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,domain.storeId))fail();
 const request=captureGithubReadData(input);dshAFields(request,['schemaVersion','scope','authority','operationId'],['visibility','realmId','range','axis','controlKey','sourceHeadId','commandHash','epoch','canonicalPolicyHash','policy']);
 if(dshAJson(domain.scope)!==dshAJson(request.scope))fail();
 const visibility=body.visibility;dshAFields(visibility,['kind']);if(visibility.kind!=='no_visibility')fail();
 const receipt=body.receipt;dshAFields(receipt,['schemaVersion','kind','realmId','domainId','scope','authority','operationId','storageRevision','request','durableGuard']);
 if(receipt.schemaVersion!==1||receipt.kind!=='baseline'&&receipt.kind!=='fence'||receipt.realmId!==domain.storeId||receipt.domainId!==domain.domainId||receipt.operationId!==request.operationId||dshAJson(receipt.scope)!==dshAJson(request.scope)||dshAJson(receipt.authority)!==dshAJson(request.authority)||!safe(receipt.storageRevision)||Number(receipt.storageRevision)<1)fail();
 if(request.realmId!==undefined&&request.realmId!==domain.storeId)fail();
 // An authenticated read returns its stored full request; apply/baseline must
 // echo the exact full request including A sourceHeadId/commandHash.
 if(request.visibility!==undefined||request.axis!==undefined){if(dshAJson(receipt.request)!==dshAJson(request))fail();}
 const principal=sha('room-host-installation\n'+token);
 const scopeKey=brokerAdmissionDigest({scope:request.scope,principal});
 if(domain.domainId!=='broker-dsh:'+domain.storeId+':'+scopeKey||receipt.durableGuard!==brokerAdmissionDigest({realmId:domain.storeId,scopeKey,request:receipt.request,storageRevision:receipt.storageRevision}))fail();
 if(receipt.kind==='baseline')readBrokerBaselineReceipt(receipt);else readBrokerFenceReceipt(receipt);
 return githubReadFreeze(body);
}

export function readBrokerBaselineReceipt(raw:unknown):Readonly<Record<string,unknown>> {
 const receipt=captureGithubReadData(raw);dshAFields(receipt,['schemaVersion','kind','realmId','domainId','scope','authority','operationId','storageRevision','request','durableGuard']);
 const input=receipt.request;dshAFields(input,['schemaVersion','scope','authority','operationId','visibility']);
 const scope=receipt.scope,authority=receipt.authority;dshAFields(scope,['profileId','workspaceId']);dshAFields(authority,['authorityId','authorityEpoch']);
 for(const value of [scope.profileId,scope.workspaceId,authority.authorityId,receipt.operationId])if(typeof value!=='string'||!value||apply(trim,value,[])!==value||matches(/[\x00-\x1f\x7f]/,value))fail();
 const visibility=input.visibility;dshAFields(visibility,['kind']);
 if(receipt.schemaVersion!==1||receipt.kind!=='baseline'||input.schemaVersion!==1||visibility.kind!=='no_visibility'||receipt.storageRevision!==1||!safe(authority.authorityEpoch)||Number(authority.authorityEpoch)<1||receipt.operationId!==input.operationId||dshAJson(scope)!==dshAJson(input.scope)||dshAJson(authority)!==dshAJson(input.authority)||typeof receipt.realmId!=='string'||!matches(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,receipt.realmId)||typeof receipt.domainId!=='string')fail();
 const prefix='broker-dsh:'+receipt.realmId+':';if(!apply(starts,receipt.domainId,[prefix]))fail();const scopeKey=apply(slice,receipt.domainId,[prefix.length]) as string;if(!matches(/^[a-f0-9]{64}$/,scopeKey)||receipt.durableGuard!==brokerAdmissionDigest({realmId:receipt.realmId,scopeKey,request:input,storageRevision:1}))fail();return receipt;
}

export function readBrokerFenceReceipt(raw:unknown):Readonly<Record<string,unknown>> {
 const r=captureGithubReadData(raw);dshAFields(r,['schemaVersion','kind','realmId','domainId','scope','authority','operationId','storageRevision','request','durableGuard']);
 const q=r.request;dshAFields(q,['schemaVersion','scope','authority','realmId','range','axis','controlKey','sourceHeadId','commandHash','epoch','operationId','canonicalPolicyHash','policy']);
 dshAFields(q.scope,['profileId','workspaceId']);dshAFields(q.authority,['authorityId','authorityEpoch']);dshAFields(q.range,['sourceBindingId','mandateId','workId']);
 const range=q.range;for(const key of ['sourceBindingId','mandateId','workId'])if(range[key]!==null&&(typeof range[key]!=='string'||!range[key]))fail();
 if(range.mandateId!==null&&range.sourceBindingId===null||range.workId!==null&&range.mandateId===null)fail();
 if(q.axis==='mode'){dshAFields(q.policy,['mode']);if(q.policy.mode!=='off'&&q.policy.mode!=='observe'&&q.policy.mode!=='auto_draft')fail();}
 else if(q.axis==='authorization'){dshAFields(q.policy,['allowed','reasonCode']);if(typeof q.policy.allowed!=='boolean'||q.policy.reasonCode!=='BASELINE'&&q.policy.reasonCode!=='POLICY_CHANGE'&&q.policy.reasonCode!=='VISIBILITY_NARROWING')fail();}
 else if(q.axis==='egress'&&own(q.policy as object,'allowed')){dshAFields(q.policy,['allowed']);if(typeof q.policy.allowed!=='boolean')fail();}
 else if(q.axis==='egress'){dshAFields(q.policy,['enabled','policyRef']);if(typeof q.policy.enabled!=='boolean'||q.policy.policyRef!==null&&(typeof q.policy.policyRef!=='string'||!q.policy.policyRef)||q.policy.enabled&&q.policy.policyRef===null)fail();}else fail();
 for(const value of [q.commandHash,q.controlKey,q.canonicalPolicyHash,r.durableGuard])if(typeof value!=='string'||!matches(/^[a-f0-9]{64}$/,value))fail();
 for(const value of [q.sourceHeadId,q.operationId,q.scope.profileId,q.scope.workspaceId,q.authority.authorityId])if(typeof value!=='string'||!value||apply(trim,value,[])!==value||matches(/[\x00-\x1f\x7f]/,value))fail();
 if(r.schemaVersion!==1||r.kind!=='fence'||q.schemaVersion!==1||!safe(q.epoch)||Number(q.epoch)<1||!safe(q.authority.authorityEpoch)||Number(q.authority.authorityEpoch)<1||!safe(r.storageRevision)||Number(r.storageRevision)<2||r.realmId!==q.realmId||typeof r.realmId!=='string'||!matches(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,r.realmId)||r.operationId!==q.operationId||dshAJson(r.scope)!==dshAJson(q.scope)||dshAJson(r.authority)!==dshAJson(q.authority)||q.controlKey!==brokerAdmissionDigest({sourceHeadId:q.sourceHeadId,axis:q.axis})||q.canonicalPolicyHash!==brokerAdmissionDigest(q.policy)||typeof r.domainId!=='string')fail();
 const prefix='broker-dsh:'+r.realmId+':';if(!apply(starts,r.domainId,[prefix]))fail();const scopeKey=apply(slice,r.domainId,[prefix.length]) as string;if(!matches(/^[a-f0-9]{64}$/,scopeKey)||r.durableGuard!==brokerAdmissionDigest({realmId:r.realmId,scopeKey,request:q,storageRevision:r.storageRevision}))fail();return r;
}

/** One projection shared by the original producer, A transaction and cold
 * relation validator. Full original command hash remains separate. */
export function projectDshBrokerControlTarget(raw:unknown,scope:unknown,authority:unknown,realmId:unknown):Readonly<Record<string,unknown>> {
 const original=captureGithubReadData(raw);dshAFields(original,['schemaVersion','scopeId','operationId','ownerDomain','controlId','epoch','canonicalHash','command']);
 const command=original.command;dshAFields(command,['scope','type','identity','epoch','value','authorityRef'],['axis','factKind']);
 if(dshAJson(command.scope)!==dshAJson(scope)||command.epoch!==original.epoch||command.authorityRef!=='dsh-a-control:'+original.operationId)fail();
 const identity=dshSourceScopeIdentity(command.identity),leaf=command.type==='leaf';if(!leaf&&command.type!=='policy')fail();
 const kind=leaf?command.factKind:command.axis,value=command.value;let axis:string,policy:unknown;
 if(kind==='mode'){dshAFields(value,['mode']);if(value.mode!=='off'&&value.mode!=='observe'&&value.mode!=='auto_draft')fail();axis='mode';policy={mode:value.mode};}
 else if(kind==='egress'&&leaf){dshAFields(value,['policyRef','policyHash','provider','destinationRef','purposes','enabled']);if(typeof value.enabled!=='boolean'||typeof value.policyRef!=='string')fail();axis='egress';policy={enabled:value.enabled,policyRef:value.policyRef};}
 else if(kind==='egress'&&!leaf){dshAFields(value,['allowed','restriction']);if(typeof value.allowed!=='boolean')fail();axis='egress';policy={allowed:value.allowed};}
 else {
  axis='authorization';let allowed:boolean;
  if(!leaf){if(kind!=='mandate'&&kind!=='egress'&&kind!=='privacy'&&kind!=='readonly')fail();dshAFields(value,['allowed','restriction']);if(typeof value.allowed!=='boolean')fail();allowed=value.allowed;}
  else if(kind==='mandate'){if(!value||typeof value!=='object')fail();const status=(value as Record<string,unknown>).status;if(status!=='active'&&status!=='revoked'&&status!=='expired')fail();allowed=status==='active';}
  else if(kind==='source_auth'){dshAFields(value,['authScope','sourceBindingVersion','roleMappingVersion','provenanceVersion','status','attestationRef']);if(value.status!=='active'&&value.status!=='revoked'&&value.status!=='unavailable')fail();allowed=value.status==='active';}
  else if(kind==='readonly'){dshAFields(value,['executionProfile','schemaVersion','snapshotHash','snapshotPolicyDigest','approvalRef']);if(value.schemaVersion!==1||value.executionProfile!=='model_text_only_v1'&&value.executionProfile!=='readonly_step_v1')fail();allowed=true;}
  else fail();policy={allowed,reasonCode:'POLICY_CHANGE'};
 }
 return {schemaVersion:1,scope,authority,realmId,range:{sourceBindingId:identity.sourceBindingId??null,mandateId:identity.mandateId??null,workId:null},axis,controlKey:brokerAdmissionDigest({sourceHeadId:original.controlId,axis}),sourceHeadId:original.controlId,commandHash:dshAHash(command),epoch:original.epoch,operationId:original.operationId,canonicalPolicyHash:brokerAdmissionDigest(policy),policy};
}
