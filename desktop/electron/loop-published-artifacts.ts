import {types} from 'node:util';
import {parsePublishedArtifactSelection} from '../../src/runtime/verification/published-artifact-selection.js';
import {freezeLoopPublicationValue} from './loop-publication-config.js';
import type {LoopArtifactPageRequest,LoopArtifactPage,LoopArtifactExportSelection} from '../shared/loop-artifacts.js';
import {captureExecutionValue,executionFields,executionIdentity} from './loop-verification-execution.js';
import {parseLoopApplicationBinding,type LoopApplicationBinding} from '../../src/runtime/verification/loop-application-binding.js';
import {readPublishedArtifacts} from '../../src/runtime/verification/published-artifact-reader.js';
import type {PublishedPayload} from '../../src/runtime/verification/publication-client.js';
import {canonicalVerificationJson as json} from '../../src/runtime/verification/protocol.js';
const PAGE_SIZE=20;
export function parseLoopArtifactPageRequest(raw:unknown):LoopArtifactPageRequest{
 const page=captureExecutionValue(raw);executionFields(page,['offset','identity']);
 if(!Number.isSafeInteger(page.offset)||page.offset<0||page.offset%PAGE_SIZE!==0)throw Error('loop_artifact_page');
 if(page.offset===0){if(page.identity!==null)throw Error('loop_artifact_page');}
 else{executionFields(page.identity,['runId','candidateId','candidateRevision','payloadHash']);executionIdentity(page.identity.runId);executionIdentity(page.identity.candidateId);if(!Number.isSafeInteger(page.identity.candidateRevision)||page.identity.candidateRevision<1||typeof page.identity.payloadHash!=='string'||!/^[a-f0-9]{64}$/.test(page.identity.payloadHash))throw Error('loop_artifact_page');}
 return page as unknown as LoopArtifactPageRequest;
}
/** Pure content projection. The fixed service must separately obtain a fresh full publication. */
export function readLoopArtifactPage(raw:Readonly<LoopApplicationBinding>,payload:Readonly<PublishedPayload>,rawPage:LoopArtifactPageRequest):LoopArtifactPage{
 const binding=parseLoopApplicationBinding(raw),page=parseLoopArtifactPageRequest(rawPage);
 if(binding.subject.kind!=='loop-run'||binding.subject.stage!==null||binding.contract.kind!=='user-template'||binding.body.kind!=='user-template')throw Error('loop_artifact_binding');
 const identity=Object.freeze({runId:binding.subject.runId,candidateId:binding.candidateId,candidateRevision:binding.candidateRevision,payloadHash:payload.payloadHash});
 if(page.identity&&json(page.identity)!==json(identity))throw Error('loop_artifact_publication_changed');
 const declared=binding.body.artifacts,decoded=readPublishedArtifacts(payload,declared.map(a=>a.selection));
 for(let i=0;i<declared.length;i++)if(decoded[i].sha256!==declared[i].sha256||decoded[i].size!==declared[i].size)throw Error('loop_artifact_content');
 if(page.offset>0&&page.offset>=decoded.length)throw Error('loop_artifact_page');
 const items=decoded.slice(page.offset,page.offset+PAGE_SIZE).map(a=>Object.freeze({selection:a.selection,path:a.path,sha256:a.sha256,size:a.size}));
 return Object.freeze({identity,offset:page.offset,total:decoded.length,nextOffset:page.offset+PAGE_SIZE<decoded.length?page.offset+PAGE_SIZE:null,items:Object.freeze(items)});
}

export function parseLoopArtifactExportSelection(raw:unknown):Readonly<LoopArtifactExportSelection>{
 // Reject proxies before capture can invoke traps or wash them into plain data.
 const seen=new WeakSet<object>();let nodes=0;
 function preflight(value:unknown,depth:number):void {
  if(++nodes>200000||depth>64)throw Error('loop_artifact_export_input');
  if(!value||typeof value!=='object')return;
  if(types.isProxy(value)||seen.has(value)||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length)throw Error('loop_artifact_export_input');seen.add(value);
  for(const d of Object.values(Object.getOwnPropertyDescriptors(value))){if(!('value'in d)||!d.enumerable)throw Error('loop_artifact_export_input');preflight(d.value,depth+1);}
 }
 preflight(raw,0);const input=captureExecutionValue(raw);executionFields(input,['identity','descriptor']);
 const identity=input.identity;executionFields(identity,['runId','candidateId','candidateRevision','payloadHash']);executionIdentity(identity.runId);executionIdentity(identity.candidateId);
 if(!Number.isSafeInteger(identity.candidateRevision)||identity.candidateRevision<1||typeof identity.payloadHash!=='string'||!/^[a-f0-9]{64}$/.test(identity.payloadHash))throw Error('loop_artifact_export_identity');
 const descriptor=input.descriptor;executionFields(descriptor,['selection','sha256','size']);descriptor.selection=parsePublishedArtifactSelection(descriptor.selection);
 if(typeof descriptor.sha256!=='string'||!/^[a-f0-9]{64}$/.test(descriptor.sha256)||!Number.isSafeInteger(descriptor.size)||descriptor.size<0||descriptor.size>16*1024**2)throw Error('loop_artifact_export_descriptor');
 return freezeLoopPublicationValue(input) as Readonly<LoopArtifactExportSelection>;
}
/** Decode the entire declared set; this returned content is never a write grant. */
export function readLoopArtifactSelection(raw:Readonly<LoopApplicationBinding>,payload:Readonly<PublishedPayload>,rawSelection:LoopArtifactExportSelection){
 const input=parseLoopArtifactExportSelection(rawSelection),binding=parseLoopApplicationBinding(raw);
 if(binding.subject.kind!=='loop-run'||binding.subject.stage!==null||binding.contract.kind!=='user-template'||binding.body.kind!=='user-template')throw Error('loop_artifact_binding');
 const declared=binding.body.artifacts,decoded=readPublishedArtifacts(payload,declared.map(a=>a.selection),binding);
 for(let i=0;i<declared.length;i++)if(decoded[i].sha256!==declared[i].sha256||decoded[i].size!==declared[i].size)throw Error('loop_artifact_content');
 const matches=declared.map((descriptor,index)=>({descriptor,index})).filter(({descriptor})=>json(descriptor)===json(input.descriptor));
 if(matches.length!==1)throw Error('loop_artifact_selection');const artifact=decoded[matches[0].index];
 const identity=Object.freeze({runId:binding.subject.runId,candidateId:binding.candidateId,candidateRevision:binding.candidateRevision,payloadHash:artifact.payloadHash});
 if(json(identity)!==json(input.identity))throw Error('loop_artifact_publication_changed');
 return Object.freeze({identity,artifact});
}
