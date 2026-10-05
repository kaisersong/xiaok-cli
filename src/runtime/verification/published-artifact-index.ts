import {createHash} from 'node:crypto';
import {canonicalVerificationJson as json} from './protocol.js';
import {assertPublishedArtifactOwner,type PublishedArtifactSelection} from './published-artifact-selection.js';
import type {VerificationOwner} from './proof-authority.js';
/** Captured content only. This token grants no read, verification or mutation authority. */
export interface PublishedArtifactIndex {readonly opaquePublishedArtifactContentIndex:never}
type Entry=Readonly<{path:unknown;sha256:unknown;size:unknown;bytesBase64:unknown}>;
interface Content {ownerKey:string;entries:Map<string,Entry[]>;records:Set<Entry>;decoded:WeakMap<Entry,Buffer>;count:number;selectionBytes:number}
const indexes=new WeakMap<object,Content>();
function data(index:PublishedArtifactIndex){const value=index&&typeof index==='object'?indexes.get(index):undefined;if(!value)throw Error('published_artifact_content_index');return value;}
function key(kind:string,origin:Readonly<VerificationOwner>,obligationId:unknown,original:unknown,path:unknown){return json([kind,origin,obligationId,original,path]);}
export function createPublishedArtifactIndex(payloadOwner:Readonly<VerificationOwner>,sections:readonly unknown[],selectedKeys:ReadonlySet<string>):PublishedArtifactIndex{
 assertPublishedArtifactOwner(payloadOwner);if(!Array.isArray(sections)||sections.length>256)throw Error('published_artifact_sections');
 let encodedArtifactBytes=0;
 const value:Content={ownerKey:json(payloadOwner),entries:new Map(),records:new Set(),decoded:new WeakMap(),count:0,selectionBytes:0};
 for(const raw of sections){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('published_artifact_sections');const s=raw as Record<string,any>,inherited=s.kind==='inherited',origin=inherited?s.originOwner:payloadOwner;assertPublishedArtifactOwner(origin);
  if(!Array.isArray(s.artifacts)||s.artifacts.length>4096)throw Error('published_artifact_limit');
  for(const rawArtifact of s.artifacts){
   if(!rawArtifact||typeof rawArtifact!=='object'||Array.isArray(rawArtifact))throw Error('published_artifact_shape');
   encodedArtifactBytes+=Buffer.byteLength(json(rawArtifact));if(encodedArtifactBytes>32*1024**2)throw Error('published_artifact_limit');
   value.count++;
   value.selectionBytes+=Buffer.byteLength(json({kind:inherited?'inherited':'local',obligationId:s.obligationId,path:rawArtifact.path,...(inherited?{originOwner:origin,originalObligationId:s.originalObligationId}:{})}));
   const k=key(inherited?'inherited':'local',origin,s.obligationId,inherited?s.originalObligationId:null,rawArtifact.path);
   if(!selectedKeys.has(k))continue;
   const list=value.entries.get(k);if(list&&list.length===2)continue; // Two witnesses suffice to reject ambiguity.
   const entry=Object.freeze({path:rawArtifact.path,sha256:rawArtifact.sha256,size:rawArtifact.size,bytesBase64:rawArtifact.bytesBase64});
   if(list)list.push(entry);else value.entries.set(k,[entry]);value.records.add(entry);
  }
 }
 const token=Object.freeze({}) as PublishedArtifactIndex;indexes.set(token,value);return token;
}
export function publishedArtifactPopulation(index:PublishedArtifactIndex){const value=data(index);return Object.freeze({count:value.count,selectionBytes:value.selectionBytes});}
export function assertPublishedArtifactIndexOwner(index:PublishedArtifactIndex,owner:Readonly<VerificationOwner>):void{if(data(index).ownerKey!==json(owner))throw Error('published_artifact_index_owner');}
export function publishedArtifactLookupKeys(applicationOwner:Readonly<VerificationOwner>,selection:Readonly<PublishedArtifactSelection>,allowLocalInheritance=false):readonly string[]{
 const origin=selection.kind==='local'?applicationOwner:selection.originOwner;
 const keys=[key(selection.kind,origin,selection.obligationId,selection.kind==='inherited'?selection.originalObligationId:null,selection.path)];
 if(allowLocalInheritance&&selection.kind==='local')keys.push(key('inherited',origin,selection.obligationId,selection.obligationId,selection.path));return keys;
}
export function findIndexedPublishedArtifacts(index:PublishedArtifactIndex,applicationOwner:Readonly<VerificationOwner>,selection:Readonly<PublishedArtifactSelection>,allowLocalInheritance=false):readonly Entry[]{
 const value=data(index);return Object.freeze(publishedArtifactLookupKeys(applicationOwner,selection,allowLocalInheritance).flatMap(k=>value.entries.get(k)??[]));
}
function decoded(index:PublishedArtifactIndex,entry:Entry):Buffer{
 const value=data(index);if(!value.records.has(entry))throw Error('published_artifact_content_index');const previous=value.decoded.get(entry);if(previous)return previous;
 const {size,sha256,bytesBase64}=entry;if(typeof size!=='number'||!Number.isSafeInteger(size)||size<0||size>16*1024**2||typeof sha256!=='string'||typeof bytesBase64!=='string'||bytesBase64.length!==4*Math.ceil(size/3))throw Error('published_artifact_content');
 const bytes=Buffer.from(bytesBase64,'base64');if(bytes.length!==size||bytes.toString('base64')!==bytesBase64||createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('published_artifact_content');value.decoded.set(entry,bytes);return bytes;
}
export function verifyIndexedPublishedArtifact(index:PublishedArtifactIndex,entry:Entry):void{decoded(index,entry);}
export function readIndexedPublishedArtifact(index:PublishedArtifactIndex,entry:Entry):Buffer{return Buffer.from(decoded(index,entry));}
