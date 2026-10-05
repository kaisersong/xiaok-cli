import {types} from 'node:util';
import {createPublishedArtifactIndex,publishedArtifactLookupKeys,findIndexedPublishedArtifacts,readIndexedPublishedArtifact} from './published-artifact-index.js';
import {assertIndexedIntentApplicationArtifacts} from './intent-application-artifacts.js';
import {createHash} from 'node:crypto';
import type {PublishedPayload} from './publication-client.js';
import type {VerificationOwner} from './proof-authority.js';
import {parseActiveBusinessApplicationBinding,businessApplicationOwner,type BusinessApplicationBinding} from './business-application-binding.js';
import {assertIndexedLoopApplicationArtifacts} from './loop-application-artifacts.js';
import {canonicalVerificationJson as json} from './protocol.js';
import {parsePublishedArtifactSelection,assertPublishedArtifactOwner as owner,assertPublishedArtifactPath as logicalPath,type PublishedArtifactSelection} from './published-artifact-selection.js';
export type {PublishedArtifactSelection} from './published-artifact-selection.js';
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function fields(value:any,keys:string[]){if(!value||typeof value!=='object'||types.isProxy(value)||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.sort().join(','))throw Error('published_artifact_shape');}
function identifier(value:unknown){if(typeof value!=='string'||!value||Buffer.byteLength(value)>160||/[\x00-\x1f\x7f]/.test(value))throw Error('published_artifact_identity');}
function digest(value:unknown){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw Error('published_artifact_hash');}
/** Content decoder only. A copied DTO or returned descriptor is never proof of
 * current verification and never authorizes a completion/store mutation.
 * No filesystem paths are resolved or opened. */
export function readPublishedArtifact(payload:Readonly<PublishedPayload>,rawSelection:PublishedArtifactSelection){return readPublishedArtifacts(payload,[rawSelection])[0];}
/** One bounded payload parse/index shared by all selected content and application checks. */
export function readPublishedArtifacts(payload:Readonly<PublishedPayload>,rawSelections:readonly PublishedArtifactSelection[],expectedRootBinding?:Readonly<BusinessApplicationBinding>){
 const source=payload.bytes;
 if(!Buffer.isBuffer(source)||source.length<1||source.length>32*1024**2)throw Error('published_artifact_limit');
 const bytes=Buffer.from(source),identity=JSON.parse(json({owner:payload.owner,businessRevision:payload.businessRevision,operationId:payload.operationId,fullTupleHash:payload.fullTupleHash,payloadHash:payload.payloadHash}));
 owner(identity.owner);identifier(identity.operationId);digest(identity.fullTupleHash);digest(identity.payloadHash);
 if(!Number.isSafeInteger(identity.businessRevision)||identity.businessRevision<1||hash(bytes)!==identity.payloadHash)throw Error('published_artifact_payload');

 let body:any;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('published_artifact_encoding');}
 fields(body,['version','owner','dependencies','evaluations',...(Object.hasOwn(body??{},'application')?['application']:[])]);owner(body.owner);
 if(body.version!==1||json(body.owner)!==json(identity.owner)||!Array.isArray(body.dependencies)||body.dependencies.length>256||!Array.isArray(body.evaluations)||body.evaluations.length>256||!Buffer.from(json(body)).equals(bytes))throw Error('published_artifact_payload');
 if(expectedRootBinding!==undefined&&json(body.application?.binding??null)!==json(expectedRootBinding))throw Error('published_artifact_application');
 let artifactCount=0,availableSelectionBytes=0;
 const applicationChecks:{origin:Readonly<VerificationOwner>;raw:unknown}[]=[];
 if(Object.hasOwn(body,'application'))applicationChecks.push({origin:body.owner,raw:body.application});
 for(const section of body.evaluations){
  const inherited=section?.kind==='inherited';fields(section,['obligationId','definitionHash','binding','evaluation','artifacts',...(inherited?['kind','originOwner','originalObligationId']:[]),...(Object.hasOwn(section??{},'application')?['application']:[])]);
  identifier(section.obligationId);digest(section.definitionHash);
  if(inherited){owner(section.originOwner);identifier(section.originalObligationId);}
  if(Object.hasOwn(section,'application'))applicationChecks.push({origin:inherited?section.originOwner:body.owner,raw:section.application});
  if(!inherited&&json(section.application??null)!==json(body.application??null))throw Error('published_artifact_application');
  if(!Array.isArray(section.artifacts)||section.artifacts.length>4096)throw Error('published_artifact_limit');

  for(const artifact of section.artifacts){
   artifactCount++;
   availableSelectionBytes+=Buffer.byteLength(json({kind:inherited?'inherited':'local',obligationId:section.obligationId,path:artifact.path,...(inherited?{originOwner:section.originOwner,originalObligationId:section.originalObligationId}:{})}));
   fields(artifact,['path','sha256','size','bytesBase64']);logicalPath(artifact.path);digest(artifact.sha256);
   if(!Number.isSafeInteger(artifact.size)||artifact.size<0||artifact.size>16*1024**2||typeof artifact.bytesBase64!=='string'||artifact.bytesBase64.length!==4*Math.ceil(artifact.size/3))throw Error('published_artifact_size');

  }
 }

 if(types.isProxy(rawSelections)||!Array.isArray(rawSelections))throw Error('published_artifact_selection_limit');
 const selectionCount=rawSelections.length;if(!Number.isSafeInteger(selectionCount)||selectionCount>artifactCount)throw Error('published_artifact_selection_limit');
 const selections:Readonly<PublishedArtifactSelection>[]=[],seen=new Set<string>();let selectionBytes=0;
 for(let i=0;i<selectionCount;i++){
  const d=Object.getOwnPropertyDescriptor(rawSelections,String(i));if(!d||!('value'in d))throw Error('published_artifact_selection');
  const raw=d.value;preflightSelection(raw);const selection=parsePublishedArtifactSelection(raw),encoded=json(selection);
  if(seen.has(encoded))throw Error('published_artifact_selection_duplicate');seen.add(encoded);selectionBytes+=Buffer.byteLength(encoded);
  if(selectionBytes>availableSelectionBytes)throw Error('published_artifact_selection_limit');selections.push(selection);
 }
 const keys=new Set<string>();for(const selection of selections)for(const key of publishedArtifactLookupKeys(body.owner,selection))keys.add(key);
 const applications=applicationChecks.map(check=>{
  const active=parseActiveBusinessApplicationBinding(check.raw);if(json({ownerKind:check.origin.ownerKind,ownerId:check.origin.ownerId})!==json(businessApplicationOwner(active.binding)))throw Error('published_artifact_application');
  if(active.binding.kind==='loop'||active.binding.kind==='intent')for(const artifact of active.binding.body.artifacts)for(const key of publishedArtifactLookupKeys(check.origin,artifact.selection,true))keys.add(key);
  return {...check,active};
 });
 const index=createPublishedArtifactIndex(body.owner,body.evaluations,keys);
 for(const {origin,active} of applications){
  if(active.binding.kind==='loop')assertIndexedLoopApplicationArtifacts(origin,active.binding,body.owner,index);
  if(active.binding.kind==='intent')assertIndexedIntentApplicationArtifacts(origin,active.binding,body.owner,index);
 }
 const result=selections.map(selection=>{
  const matches=findIndexedPublishedArtifacts(index,body.owner,selection);if(matches.length!==1)throw Error('published_artifact_not_unique');
  const selected=matches[0],content=readIndexedPublishedArtifact(index,selected);
  return Object.freeze({...identity,owner:Object.freeze(identity.owner) as Readonly<VerificationOwner>,selection,path:selected.path as string,sha256:selected.sha256 as string,size:selected.size as number,bytes:content});
 });return Object.freeze(result);
}
function preflightSelection(raw:unknown):void{
 if(!raw||typeof raw!=='object'||types.isProxy(raw)||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))throw Error('published_artifact_selection');
 const kind=Object.getOwnPropertyDescriptor(raw,'kind');if(!kind||!('value'in kind)||!['local','inherited'].includes(kind.value))throw Error('published_artifact_selection');
 const allowed=kind.value==='local'?['kind','obligationId','path']:['kind','obligationId','path','originOwner','originalObligationId'];
 let count=0;for(const k in raw){if(k.length>20||!allowed.includes(k)||++count>allowed.length)throw Error('published_artifact_selection');const d=Object.getOwnPropertyDescriptor(raw,k);if(!d||!('value'in d))throw Error('published_artifact_selection');const value=d.value;
  if(k==='originOwner'){if(!value||typeof value!=='object'||types.isProxy(value)||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('published_artifact_selection');let fields=0;for(const field in value){if(field.length>10||!['profileId','ownerKind','ownerId'].includes(field)||++fields>3)throw Error('published_artifact_selection');const member=Object.getOwnPropertyDescriptor(value,field);if(!member||!('value'in member)||typeof member.value!=='string'||Buffer.byteLength(member.value)>160)throw Error('published_artifact_selection');}if(Object.getOwnPropertySymbols(value).length)throw Error('published_artifact_selection');}
  else if(typeof value!=='string'||(k==='path'?value.length>4096:Buffer.byteLength(value)>160))throw Error('published_artifact_selection');
 }if(Object.getOwnPropertySymbols(raw).length)throw Error('published_artifact_selection');
}
