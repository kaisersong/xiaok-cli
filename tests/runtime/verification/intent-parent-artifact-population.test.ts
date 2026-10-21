import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {intentApplicationCandidate} from '../../support/intent-application-fixture.js';
import {createIntentApplicationBinding} from '../../../src/runtime/verification/intent-application-binding.js';
import {intentHostSubjectOwner} from '../../../src/runtime/verification/intent-host-subject.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
// Whole parent population remains pending: these real parser failures must not be
// recast as an accepted smaller product contract or a routine green count.
it.runIf(process.env.SOLPI_INTENT_POPULATION==='1').each([1,10000,61000])('preserves all original 99 individually legal stage artifacts of %i bytes in parent',size=>{
 const raw=structuredClone(intentApplicationCandidate()),sample=structuredClone(raw.contract.stages[0]),bytes='x'.repeat(size),sha256=createHash('sha256').update(bytes).digest('hex'),H='a'.repeat(64),definition={version:1 as const,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject' as const,recipe:{kind:'artifact-content' as const,checks:[{id:'content',path:'result',sha256,structure:'bytes' as const}]}}]};
 raw.contract.verification=definition;raw.contract.stages=[];
 for(let i=0;i<99;i++)raw.contract.stages.push({...structuredClone(sample),stageId:`s${i}`,order:i,label:'stage',deliverable:'result',templateId:'template',verification:definition,dependsOnStageIds:[],steps:[{...sample.steps[0],stepId:`p${i}`,key:'main',order:0,skillName:null,dependsOn:[]}]});
 const stages:any[]=[],artifacts:any[]=[];let maximumStage=0;
 for(const stage of raw.contract.stages){const subject={...raw.subject,stageId:stage.stageId},artifact={artifactId:'artifact-'+stage.stageId,stageId:stage.stageId,kind:'report',label:'result',summary:null,createdAt:1,content:{kind:'inline',text:bytes},selection:{kind:'local',obligationId:'original',path:'result'},sha256,size};
  const binding=createIntentApplicationBinding({...raw,subject,candidateId:'candidate-'+stage.stageId,body:{kind:'intent-stage',stageId:stage.stageId,summary:'actual complete output',executionReports:[],...(size===10000?{producerReports:[{protectionMode:'protected',requestSource:'user',now:1,artifactId:artifact.artifactId,action:{kind:'artifact-report',stageId:stage.stageId,kindOfArtifact:'report',storage:'inline',label:artifact.label,path:null,inlineValue:bytes,summary:null,reportedStructuralValidation:'pending',reportedSemanticValidation:'pending',origin:{kind:'model-report',providerInvocationId:'provider-'+stage.stageId,toolInvocationId:'tool-'+stage.stageId}}}]}:{}),artifacts:[artifact]}});
  const {contract,...body}=binding;maximumStage=Math.max(maximumStage,Buffer.byteLength(json(body)));expect(binding.body.artifacts[0]!.content).toEqual(artifact.content);
  stages.push({subject,candidateId:binding.candidateId,candidateRevision:1,bindingHash:H,immutablePayloadHash:H,operationId:'publication-'+stage.stageId,fullTupleHash:H,committedBusinessRevision:1,receiverId:'receiver',receiverProtocolVersion:1,receiverInstanceEpoch:1});
  artifacts.push({...artifact,selection:{kind:'inherited',originOwner:{profileId:'profile',...intentHostSubjectOwner(subject)},originalObligationId:'original',obligationId:'original',path:'result'}});
 }
 const parent={...raw,subject:{...raw.subject,stageId:null},body:{kind:'intent-parent',summary:'complete original result',stages,artifacts}}, {contract,...nonContract}=parent;
 console.info(json({stageCount:99,artifactBytes:size,contractBytes:Buffer.byteLength(json(contract)),maximumLegalStageNonContractBytes:maximumStage,parentNonContractBytes:Buffer.byteLength(json(nonContract)),parentCompleteBytes:Buffer.byteLength(json(parent))}));
 expect(createIntentApplicationBinding(parent).body.artifacts).toHaveLength(99);
});
