import {createPublishedArtifactIndex,publishedArtifactLookupKeys,assertPublishedArtifactIndexOwner,findIndexedPublishedArtifacts,verifyIndexedPublishedArtifact,type PublishedArtifactIndex} from './published-artifact-index.js';
import type {VerificationOwner} from './proof-authority.js';
import {parseLoopApplicationBinding,type LoopApplicationBinding} from './loop-application-binding.js';
import {loopHostSubjectOwner} from './loop-host-subject.js';
import {assertPublishedArtifactOwner} from './published-artifact-selection.js';

/** Compare declared candidate artifacts with actual exported verification bytes.
 * This content check grants neither read access nor completion authority. */
export function assertLoopApplicationArtifacts(applicationOwner:Readonly<VerificationOwner>,raw:Readonly<LoopApplicationBinding>,payloadOwner:Readonly<VerificationOwner>,sections:readonly unknown[]):void {
 const binding=parseLoopApplicationBinding(raw),keys=new Set<string>();
 for(const descriptor of binding.body.artifacts)for(const key of publishedArtifactLookupKeys(applicationOwner,descriptor.selection,true))keys.add(key);
 assertIndexedLoopApplicationArtifacts(applicationOwner,binding,payloadOwner,createPublishedArtifactIndex(payloadOwner,sections,keys));
}
export function assertIndexedLoopApplicationArtifacts(applicationOwner:Readonly<VerificationOwner>,raw:Readonly<LoopApplicationBinding>,payloadOwner:Readonly<VerificationOwner>,index:PublishedArtifactIndex):void {
 assertPublishedArtifactOwner(applicationOwner);assertPublishedArtifactOwner(payloadOwner);
 const binding=parseLoopApplicationBinding(raw),mapped=loopHostSubjectOwner(binding.subject);
 if(applicationOwner.ownerKind!==mapped.ownerKind||applicationOwner.ownerId!==mapped.ownerId)throw Error('loop_application_artifact_owner');
 assertPublishedArtifactIndexOwner(index,payloadOwner);
 for(const descriptor of binding.body.artifacts){
  const selection=descriptor.selection,target=selection.kind==='local'?applicationOwner:selection.originOwner;
  if(target.profileId!==applicationOwner.profileId)throw Error('loop_application_artifact_owner');
  const matches=findIndexedPublishedArtifacts(index,applicationOwner,selection,true);
  if(matches.length!==1)throw Error('loop_application_artifact_not_unique');
  const artifact=matches[0];
  if(artifact.sha256!==descriptor.sha256||artifact.size!==descriptor.size||typeof artifact.bytesBase64!=='string'
   ||artifact.bytesBase64.length!==4*Math.ceil(descriptor.size/3))throw Error('loop_application_artifact_content');
  try{verifyIndexedPublishedArtifact(index,artifact);}catch{throw Error('loop_application_artifact_content');}
 }
}
