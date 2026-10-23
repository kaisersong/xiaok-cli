import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {intentApplicationCandidate} from '../../support/intent-application-fixture.js';
import {createIntentApplicationBinding,intentApplicationBindingHash} from '../../../src/runtime/verification/intent-application-binding.js';
import {intentHostSubjectOwner} from '../../../src/runtime/verification/intent-host-subject.js';
import {createLoopApplicationBinding,loopApplicationBindingHash} from '../../../src/runtime/verification/loop-application-binding.js';
import {loopHostSubjectOwner} from '../../../src/runtime/verification/loop-host-subject.js';
import {readPublishedArtifacts} from '../../../src/runtime/verification/published-artifact-reader.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';

const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function payload(owner:any,body:any){const bytes=Buffer.from(json(body));return{owner,businessRevision:1,operationId:'operation',fullTupleHash:'b'.repeat(64),payloadHash:sha(bytes),bytes};}
function loopCandidate(){return{version:1,kind:'loop',subject:{kind:'loop-run',loopId:'artifact-evidence-regression',runId:'run',stage:null},candidateId:'candidate',candidateRevision:1,originalTriggerJson:json({kind:'manual',source:'user'}),logicalRunKey:null,contract:{version:1,kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',objective:'Publish report.',completionCriterion:'Keep original evidence.'},body:{kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',observedAt:100,summary:'original',nextActionKind:'none',nextActionSummary:null,diagnostic:{kind:'artifact-evidence-regression',scannedOwnerCount:1,openAnomalyCount:0,resolvedAnomalyCount:0,anomalies:[]},artifacts:[]}};}

it('readerGoalRejectsReorderedEvidenceAfterArrayFilterReplacement',()=>{
 const owner={profileId:'profile',ownerKind:'goal',ownerId:'goal'},binding={version:1,kind:'goal',sessionId:'session',goalId:'goal',epoch:1,objective:'objective',completionCriterion:null,expectedEvidenceKinds:['file_artifact','answer']},rawHash=sha(Buffer.from('xiaok-goal-application-binding-v1\0'+json(binding))),body={version:1,owner,application:{binding,bindingHash:rawHash,revision:1},dependencies:[],evaluations:[]},encoded=payload(owner,body),original=Array.prototype.filter;let error:unknown;
 try{Array.prototype.filter=function(){return ['answer','file_artifact'];};try{readPublishedArtifacts(encoded,[]);}catch(cause){error=cause;}}
 finally{Array.prototype.filter=original;}
 expect((error as Error)?.message).toBe('application_binding_evidence_order');
});

it('readerLoopBindsEntrySnapshotAfterHashPrototypeReplacement',()=>{
 const binding=createLoopApplicationBinding(loopCandidate()),changed:any=structuredClone(binding);changed.body.summary='tampered';const owner={profileId:'profile',...loopHostSubjectOwner(binding.subject)},body={version:1,owner,application:{binding:changed,bindingHash:loopApplicationBindingHash(binding),revision:1},dependencies:[],evaluations:[]},encoded=payload(owner,body),descriptor=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON');let error:unknown;
 try{Object.defineProperty(Object.prototype,'toJSON',{configurable:true,value(){return {};}});try{readPublishedArtifacts(encoded,[]);}catch(cause){error=cause;}}
 finally{if(descriptor)Object.defineProperty(Object.prototype,'toJSON',descriptor);else delete (Object.prototype as any).toJSON;}
 expect(error).toBeInstanceOf(Error);
});

it('readerIntentStageParsesProducerReportsAfterMapFindAndIteratorReplacement',()=>{
 const raw=intentApplicationCandidate(),stageId=raw.subject.stageId,bytes=Buffer.from('原文');raw.body.producerReports=[{protectionMode:'protected',action:{kind:'artifact-report',stageId,kindOfArtifact:'report',storage:'inline',label:'完整标题',path:null,inlineValue:'原文',summary:null,reportedStructuralValidation:'passed',reportedSemanticValidation:'failed',origin:{kind:'model-report',providerInvocationId:'provider',toolInvocationId:'tool'}},requestSource:'agent',now:100,artifactId:'original-artifact'}];
 const binding=createIntentApplicationBinding(raw),owner={profileId:'profile',...intentHostSubjectOwner(binding.subject)},application={binding,bindingHash:intentApplicationBindingHash(binding),revision:1},section={obligationId:'original',definitionHash:'a'.repeat(64),binding:{},evaluation:{},application,artifacts:[{path:'result.md',sha256:sha(bytes),size:bytes.length,bytesBase64:bytes.toString('base64')}]},body={version:1,owner,application,dependencies:[],evaluations:[section]},encoded=payload(owner,body),arrayIterator=Array.prototype[Symbol.iterator],iteratorPrototype=Object.getPrototypeOf(arrayIterator.call([])),iteratorNext=iteratorPrototype.next,find=Array.prototype.find;let error:unknown,result:any;
 try{
  Array.prototype.find=function(){throw Error('replaced_array_find');};Object.defineProperty(Array.prototype,Symbol.iterator,{configurable:true,writable:true,value:function(){throw Error('replaced_array_iterator');}});Object.defineProperty(iteratorPrototype,'next',{configurable:true,writable:true,value:function(){throw Error('replaced_array_iterator_next');}});
  try{result=readPublishedArtifacts(encoded,[{kind:'local',obligationId:'original',path:'result.md'}]);}catch(cause){error=cause;}
 }finally{Array.prototype.find=find;Object.defineProperty(Array.prototype,Symbol.iterator,{configurable:true,writable:true,value:arrayIterator});Object.defineProperty(iteratorPrototype,'next',{configurable:true,writable:true,value:iteratorNext});}
 expect(error).toBeUndefined();expect(result[0].bytes.equals(bytes)).toBe(true);
});

it('readerIntentStageRequiresOneProducerReportPerArtifact',()=>{
 const raw=intentApplicationCandidate();raw.body.producerReports=[];const owner={profileId:'profile',...intentHostSubjectOwner(raw.subject)},body={version:1,owner,application:{binding:raw,bindingHash:'f'.repeat(64),revision:1},dependencies:[],evaluations:[]};
 expect(()=>readPublishedArtifacts(payload(owner,body),[])).toThrow();
});

it('readerIntentParentRejectsProducerReportExtraField',()=>{
 const raw=intentApplicationCandidate(true);(raw.body as any).producerReports=[];const owner={profileId:'profile',...intentHostSubjectOwner(raw.subject)},body={version:1,owner,application:{binding:raw,bindingHash:'f'.repeat(64),revision:1},dependencies:[],evaluations:[]};
 expect(()=>readPublishedArtifacts(payload(owner,body),[])).toThrow();
});
