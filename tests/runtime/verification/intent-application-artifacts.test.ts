import {expect,it} from 'vitest';import {createHash} from 'node:crypto';
import {intentApplicationCandidate} from '../../support/intent-application-fixture.js';
import {createIntentApplicationBinding,intentApplicationBindingHash} from '../../../src/runtime/verification/intent-application-binding.js';
import {intentHostSubjectOwner} from '../../../src/runtime/verification/intent-host-subject.js';
import {readPublishedArtifact} from '../../../src/runtime/verification/published-artifact-reader.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
const hash=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
function fixture(change?:(body:any)=>void){const binding=createIntentApplicationBinding(intentApplicationCandidate()),owner={profileId:'profile',...intentHostSubjectOwner(binding.subject)},application={binding,bindingHash:intentApplicationBindingHash(binding),revision:1};
 const bytes=Buffer.from('原文'),body:any={version:1,owner,application,dependencies:[],evaluations:[{application,obligationId:'original',definitionHash:'a'.repeat(64),binding:{},evaluation:{},artifacts:[{path:'result.md',sha256:hash(bytes),size:bytes.length,bytesBase64:bytes.toString('base64')}]}]};change?.(body);const encoded=Buffer.from(json(body));return{owner:body.owner,businessRevision:1,operationId:'publication',fullTupleHash:'b'.repeat(64),payloadHash:hash(encoded),bytes:encoded};}
it('decodes the exact declared Intent bytes through the actual published reader',()=>{expect(readPublishedArtifact(fixture(),{kind:'local',obligationId:'original',path:'result.md'}).bytes.toString()).toBe('原文');});
it('does not accept internally consistent different bytes instead of the original declared candidate',()=>{
 const value=fixture(body=>{const bytes=Buffer.from('替换'),artifact=body.evaluations[0].artifacts[0];Object.assign(artifact,{sha256:hash(bytes),size:bytes.length,bytesBase64:bytes.toString('base64')});});
 expect(()=>readPublishedArtifact(value,{kind:'local',obligationId:'original',path:'result.md'})).toThrow();
});
it('checks every declared artifact, not only the selected artifact',()=>{
 const value=fixture(body=>{const raw=intentApplicationCandidate();raw.body.artifacts.push({...raw.body.artifacts[0],artifactId:'second',selection:{kind:'local',obligationId:'original',path:'missing.md'}});const binding=createIntentApplicationBinding(raw);body.application=body.evaluations[0].application={binding,bindingHash:intentApplicationBindingHash(binding),revision:1};});
 expect(()=>readPublishedArtifact(value,{kind:'local',obligationId:'original',path:'result.md'})).toThrow();
});
it('validates inherited stage declarations against the actual origin section',()=>{
 const value=fixture(body=>{const originOwner=body.owner;body.owner={...originOwner,ownerKind:'task',ownerId:'parent'};delete body.application;Object.assign(body.evaluations[0],{kind:'inherited',originOwner,originalObligationId:'original'});});const body=JSON.parse(value.bytes.toString());
 expect(readPublishedArtifact(value,{kind:'inherited',obligationId:'original',originalObligationId:'original',originOwner:body.evaluations[0].originOwner,path:'result.md'}).bytes.toString()).toBe('原文');
});
