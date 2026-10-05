import type {VerificationOwner} from './proof-authority.js';
import {canonicalVerificationJson as json} from './protocol.js';

export type PublishedArtifactSelection={path:string;obligationId:string}&({kind:'local'}|{kind:'inherited';originOwner:VerificationOwner;originalObligationId:string});
function fields(value:unknown,keys:string[]):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.sort().join(','))throw Error('published_artifact_shape');}
function identifier(value:unknown):asserts value is string{if(typeof value!=='string'||!value||Buffer.byteLength(value)>160||/[\x00-\x1f\x7f]/.test(value))throw Error('published_artifact_identity');}
export function assertPublishedArtifactOwner(value:unknown):asserts value is VerificationOwner{
 fields(value,['profileId','ownerKind','ownerId']);identifier(value.profileId);identifier(value.ownerId);
 if(!['task','intent','goal','loop','project'].includes(value.ownerKind as string))throw Error('published_artifact_owner');
}
export function assertPublishedArtifactPath(value:unknown):asserts value is string{
 if(typeof value!=='string'||!value||value.length>4096||value.includes('\\')||value.split('/').some(part=>!part||part==='.'||part==='..'||/[:\x00-\x1f\x7f]/.test(part)))throw Error('published_artifact_path');
}
/** A content selector only, never a material/archive grant or a filesystem path. */
export function parsePublishedArtifactSelection(raw:unknown):Readonly<PublishedArtifactSelection>{
 const captured:unknown=JSON.parse(json(raw));
 if(!captured||typeof captured!=='object'||Array.isArray(captured)||!('kind' in captured))throw Error('published_artifact_shape');
 const selection=captured as Record<string,unknown>;
 fields(selection,selection.kind==='local'?['kind','obligationId','path']:['kind','obligationId','path','originOwner','originalObligationId']);
 if(selection.kind!=='local'&&selection.kind!=='inherited')throw Error('published_artifact_selection');
 identifier(selection.obligationId);assertPublishedArtifactPath(selection.path);
 if(selection.kind==='inherited'){assertPublishedArtifactOwner(selection.originOwner);identifier(selection.originalObligationId);Object.freeze(selection.originOwner);}
 return Object.freeze(selection) as Readonly<PublishedArtifactSelection>;
}
