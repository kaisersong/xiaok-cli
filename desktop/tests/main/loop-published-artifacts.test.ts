import {it,expect} from 'vitest';
import * as published from '../../electron/loop-published-artifacts.js';
import {createHash} from 'node:crypto';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
import {createLoopApplicationBinding,loopApplicationBindingHash} from '../../../src/runtime/verification/loop-application-binding.js';
import {loopHostSubjectOwner} from '../../../src/runtime/verification/loop-host-subject.js';
import {readLoopArtifactPage,parseLoopArtifactPageRequest} from '../../electron/loop-published-artifacts.js';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function fixture(count=45,bad=-1,content=Buffer.from('Original published bytes')){
 const subject={kind:'loop-run' as const,loopId:'report',runId:'run',stage:null},owner={profileId:'profile',...loopHostSubjectOwner(subject)};
 const artifacts=Array.from({length:count},(_,i)=>({selection:{kind:'local' as const,obligationId:'output',path:`report-${i}.bin`},sha256:hash(content),size:content.length}));
 const binding=createLoopApplicationBinding({version:1,kind:'loop',subject,candidateId:'candidate',candidateRevision:1,originalTriggerJson:json({kind:'manual'}),logicalRunKey:null,contract:{version:1,kind:'user-template',templateKind:'task_completion',prompt:'Original',outputDirectory:'',outputFileName:'',loopContract:{schemaVersion:'loop_contract_v1',objective:'Original objective',triggerPolicy:{kind:'manual'},successCriteria:[{kind:'task_completed',strength:'weak'}],stopPolicy:{},permissionPolicy:{mode:'read_only',autoRunApproved:false,allowedToolCategories:[]},concurrencyPolicy:{perLoop:'skip_if_running',coalesceMissedRuns:false}}},body:{kind:'user-template',taskId:'task',executeStageId:'execute',verifyStageId:'verify',summary:'Original',evidenceIds:[],artifacts}});
 const application={binding,bindingHash:loopApplicationBindingHash(binding),revision:1},bytes=Buffer.from(json({version:1,owner,dependencies:[],application,evaluations:[{obligationId:'output',definitionHash:'b'.repeat(64),binding:{},evaluation:{},application,artifacts:artifacts.map((a,i)=>({path:a.selection.path,sha256:i===bad?'c'.repeat(64):a.sha256,size:a.size,bytesBase64:content.toString('base64')}))}]}));
 return {binding,payload:{owner,businessRevision:1,operationId:'operation',fullTupleHash:'a'.repeat(64),payloadHash:hash(bytes),bytes}};
}
it('pages every original declared artifact without returning bytes or dropping later pages',()=>{
 const {binding,payload}=fixture(),first=readLoopArtifactPage(binding,payload,{offset:0,identity:null}),second=readLoopArtifactPage(binding,payload,{offset:first.nextOffset!,identity:first.identity}),last=readLoopArtifactPage(binding,payload,{offset:second.nextOffset!,identity:second.identity});
 expect(first.total).toBe(45);expect(first.items).toHaveLength(20);expect(second.items).toHaveLength(20);expect(last.items).toHaveLength(5);expect(last.nextOffset).toBeNull();
 expect([...first.items,...second.items,...last.items].map(i=>i.path)).toEqual(Array.from({length:45},(_,i)=>`report-${i}.bin`));expect(JSON.stringify(first)).not.toContain('Original published bytes');expect(first.items[0]).not.toHaveProperty('bytes');
});
it('a corrupt artifact outside the requested page rejects the complete listing',()=>{const f=fixture(45,44);expect(()=>readLoopArtifactPage(f.binding,f.payload,{offset:0,identity:null})).toThrow();});
it('rejects changed publication identity and invalid page boundaries',()=>{const f=fixture(),first=readLoopArtifactPage(f.binding,f.payload,{offset:0,identity:null});expect(()=>readLoopArtifactPage(f.binding,f.payload,{offset:20,identity:{...first.identity,payloadHash:'c'.repeat(64)}})).toThrow();expect(()=>readLoopArtifactPage(f.binding,f.payload,{offset:60,identity:first.identity})).toThrow();for(const page of [{offset:1,identity:null},{offset:20,identity:null},{offset:0,identity:first.identity},{offset:0,identity:null,source:'user'}])expect(()=>parseLoopArtifactPageRequest(page)).toThrow();});
it('returns an empty original declaration without treating workspace content as an artifact',()=>{const f=fixture(0);expect(readLoopArtifactPage(f.binding,f.payload,{offset:0,identity:null})).toMatchObject({items:[],total:0,nextOffset:null});});

function selected(f:ReturnType<typeof fixture>,index=0){
 const item=f.binding.body.artifacts[index];
 return {identity:{runId:f.binding.subject.runId,candidateId:f.binding.candidateId,candidateRevision:f.binding.candidateRevision,payloadHash:f.payload.payloadHash},descriptor:JSON.parse(json(item))};
}
function replacePayloadBody(f:ReturnType<typeof fixture>,edit:(body:any)=>void){const body=JSON.parse(f.payload.bytes.toString());edit(body);f.payload.bytes=Buffer.from(json(body));f.payload.payloadHash=hash(f.payload.bytes);}
it('selects the 45th declared original item, including its immutable bytes',()=>{
 const f=fixture(),input=selected(f,44),result=published.readLoopArtifactSelection(f.binding,f.payload,input);
 expect(result.identity).toEqual(input.identity);expect(result.artifact.path).toBe('report-44.bin');expect(result.artifact.bytes.toString()).toBe('Original published bytes');
 input.descriptor.selection.path='changed.bin';f.payload.bytes.fill(0);expect(result.artifact.path).toBe('report-44.bin');expect(result.artifact.bytes.toString()).toBe('Original published bytes');
});
it('rejects a corrupt nonselected declaration in a later page',()=>{const f=fixture(45,44);expect(()=>published.readLoopArtifactSelection(f.binding,f.payload,selected(f))).toThrow();});
it.each(['runId','candidateId','candidateRevision','payloadHash'] as const)('rejects a stale %s content identity',key=>{
 const f=fixture(),s=selected(f);(s.identity as any)[key]=key==='candidateRevision'?2:key==='payloadHash'?'f'.repeat(64):'another';expect(()=>published.readLoopArtifactSelection(f.binding,f.payload,s)).toThrow();
});
it.each(['selection','sha256','size'])('rejects a changed %s descriptor',key=>{
 const f=fixture(),s=selected(f);if(key==='selection')s.descriptor.selection.path='not-declared.bin';else s.descriptor[key]=key==='sha256'?'f'.repeat(64):1;expect(()=>published.readLoopArtifactSelection(f.binding,f.payload,s)).toThrow();
});
it('rejects an evaluation artifact absent from the original root declaration',()=>{
 const f=fixture(1);replacePayloadBody(f,b=>b.evaluations[0].artifacts.push({...b.evaluations[0].artifacts[0],path:'hidden.bin'}));
 const input=selected(f);input.descriptor.selection.path='hidden.bin';expect(()=>published.readLoopArtifactSelection(f.binding,f.payload,input)).toThrow();
});
it('requires the exact root binding inside the payload, even if selected content agrees',()=>{
 const f=fixture(1),{triggerHash:_,contractHash:__,candidatePayloadHash:___,...candidate}=f.binding,other=createLoopApplicationBinding({...candidate,candidateId:'other-candidate'});const input=selected(f);input.identity.candidateId='other-candidate';
 expect(()=>published.readLoopArtifactSelection(other,f.payload,input)).toThrow('published_artifact_application');
});
it('rejects a payload without its root application',()=>{
 const f=fixture(1);replacePayloadBody(f,b=>{delete b.application;delete b.evaluations[0].application;});expect(()=>published.readLoopArtifactSelection(f.binding,f.payload,selected(f))).toThrow();
});
it('preserves the original 16 MiB single-artifact boundary',()=>{
 const bytes=Buffer.alloc(16*1024**2,97),f=fixture(1,-1,bytes),result=published.readLoopArtifactSelection(f.binding,f.payload,selected(f));expect(result.artifact.size).toBe(bytes.length);expect(hash(result.artifact.bytes)).toBe(hash(bytes));
});
it('captures the strict selection DTO independently of later caller changes',()=>{
 const f=fixture(),s=selected(f),copy=published.parseLoopArtifactExportSelection(s);s.identity.runId='changed';s.descriptor.selection.path='changed';expect(copy.identity.runId).toBe('run');expect(copy.descriptor.selection.path).toBe('report-0.bin');
});
it.each(['top','identity','descriptor','selection','originOwner'])('rejects throwing and revoked Proxy at %s before any trap',place=>{
 for(const revoked of [false,true]){
  const s:any=selected(fixture());s.descriptor.selection={kind:'inherited',obligationId:'output',path:'report-0.bin',originOwner:{profileId:'profile',ownerKind:'task',ownerId:'task'},originalObligationId:'output'};
  let traps=0;const pair=Proxy.revocable({},new Proxy({}, {get(){return()=>{traps++;throw Error('trap');};}}));if(revoked)pair.revoke();
  let input=s;if(place==='top')input=pair.proxy;else if(place==='identity')s.identity=pair.proxy;else if(place==='descriptor')s.descriptor=pair.proxy;else if(place==='selection')s.descriptor.selection=pair.proxy;else s.descriptor.selection.originOwner=pair.proxy;
  expect(()=>published.parseLoopArtifactExportSelection(input)).toThrow();expect(traps).toBe(0);
 }
});
it('rejects accessors and extra input fields without invoking the getter',()=>{
 let calls=0;const s=selected(fixture());Object.defineProperty(s.identity,'runId',{enumerable:true,get(){calls++;return 'run';}});expect(()=>published.parseLoopArtifactExportSelection(s)).toThrow();expect(calls).toBe(0);
 for(const place of ['top','identity','descriptor','selection']){const v:any=selected(fixture());const target=place==='top'?v:place==='selection'?v.descriptor.selection:v[place];target.destination='/tmp/other';expect(()=>published.parseLoopArtifactExportSelection(v)).toThrow();}
});
it.each([-1,16*1024**2+1,1.1,Number.MAX_SAFE_INTEGER+1])('rejects invalid size %s before decoding',size=>{const s=selected(fixture());s.descriptor.size=size;expect(()=>published.parseLoopArtifactExportSelection(s)).toThrow();});
it.each(['top','identity','descriptor','selection'])('rejects nonenumerable extra fields at %s before capture',place=>{
 const v:any=selected(fixture());const target=place==='top'?v:place==='selection'?v.descriptor.selection:v[place];Object.defineProperty(target,'destination',{value:'/tmp/other',enumerable:false});expect(()=>published.parseLoopArtifactExportSelection(v)).toThrow('loop_artifact_export_input');
});
it('rejects a sparse array before JSON capture can expand its length',()=>{const huge=new Array(1000001);expect(()=>published.parseLoopArtifactExportSelection(huge)).toThrow('loop_artifact_export_input');});
