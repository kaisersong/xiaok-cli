import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {LoopStore} from '../../electron/loop-store.js';
import {ArtifactEvidenceRegressionScanner} from '../../electron/artifact-evidence-regression-loop.js';
import {KSwarmServiceHealthScanner} from '../../electron/kswarm-health-loop.js';
import {CompletionEvidenceStore} from '../../electron/completion-evidence-store.js';
import {validateEveningReflection,validateMorningBriefing} from '../../electron/assistant-llm.js';
const recipe={version:1,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'check',path:'report',sha256:'a'.repeat(64),structure:'bytes'}]}}]};
function fixture(loopId='artifact-evidence-regression'){
 const root=mkdtempSync(join(tmpdir(),'loop-candidate-')),file=join(root,'loop.sqlite'),store=new LoopStore(file);store.ensureBuiltInLoops(1);
 const assistant=loopId.startsWith('personal-assistant-');
 if(assistant){store.ensureAssistantProfile({id:'default-personal-assistant',status:'active',locale:'zh',timeZone:'Asia/Shanghai',eveningTime:'20:00',morningTime:'08:00',workdays:[1],quietHours:{start:'22:00',end:'07:00'},dataScopes:['tasks'],createdAt:1,updatedAt:1});store.setLoopStatus(loopId,'active',1);}
 const contract=assistant?{kind:'assistant',assistantKind:loopId.includes('evening')?'evening':'morning',objective:'完整原目标',completionCriterion:'核验原输出'}:{kind:'builtin-diagnostic',scanner:loopId,objective:'完整原目标',completionCriterion:'核验原输出'};
 store.saveLoopPublicationConfiguration({loopId,expectedRevision:null,requestSource:'user',now:2,configuration:{version:1,contract,verificationDefinitions:{run:recipe,stages:assistant?{}:{scan:recipe}}}});
 const begin=store.beginLoopRun(loopId,{kind:'manual',logicalRunKey:'original-run'},3,1000,{requestSource:'user'});if(begin.status!=='started')throw Error('fixture begin');
 return{root,file,store,run:begin.run,close(){store.close();rmSync(root,{recursive:true,force:true});}};
}
function actualScan(f:ReturnType<typeof fixture>){const evidence=new CompletionEvidenceStore(join(f.root,'evidence.sqlite'));const scanner=new ArtifactEvidenceRegressionScanner(join(f.root,'evidence.sqlite'));try{return scanner.scan({loopRunId:f.run.id,now:10});}finally{scanner.close();evidence.close();}}
function capture(f:ReturnType<typeof fixture>,producer:ReturnType<LoopStore['openLoopPublicationProducer']>,stageId:string|null=null){return f.store.captureLoopPublicationCandidate({runId:f.run.id,stageId,expectedResultRevision:1},producer);}
it('binds producer to the original begin object and actual store, not cloned or reloaded DTOs',()=>{const f=fixture(),other=new LoopStore(f.file);try{
 expect(()=>f.store.openLoopPublicationProducer(structuredClone(f.run))).toThrow();expect(()=>f.store.openLoopPublicationProducer(f.store.getLoopRun(f.run.id)!)).toThrow();expect(()=>other.openLoopPublicationProducer(f.run)).toThrow();
 expect(f.store.openLoopPublicationProducer(f.run)).toBeDefined();
 }finally{other.close();f.close();}});
it('captures actual artifact scanner bytes and run/stage identities, idempotently across reopen',()=>{const f=fixture();try{
 const producer=f.store.openLoopPublicationProducer(f.run),stage=f.store.startLoopStage(f.run.id,f.run.loopId,'scan',4),result=actualScan(f);
 producer.recordScan(stage.id,result,10);const row=capture(f,producer),stageRow=capture(f,producer,stage.id);
 expect(row.binding.subject).toMatchObject({loopId:f.run.loopId,runId:f.run.id,stage:null});expect(row.binding.body).toMatchObject({kind:'builtin-diagnostic',summary:result.summaryEvidence.summary});
 expect(stageRow.binding.subject.stage).toEqual({stageId:stage.id,stageKind:'scan'});expect(stageRow.candidateId).not.toBe(row.candidateId);expect(capture(f,producer)).toEqual(row);
 const reopened=new LoopStore(f.file);try{expect(reopened.getLoopPublicationCandidate(row.candidateId)).toEqual(row);expect(reopened.listLoopPublicationCandidates(f.run.id)).toHaveLength(2);}finally{reopened.close();}
 }finally{f.close();}});
it('rejects foreign scanner run and wrong result revision without candidate rows',()=>{const f=fixture();try{
 const producer=f.store.openLoopPublicationProducer(f.run),stage=f.store.startLoopStage(f.run.id,f.run.loopId,'scan',4),result=actualScan(f);
 expect(()=>producer.recordScan(stage.id,{...result,loopRunId:'different'},10)).toThrow();expect(f.store.listLoopPublicationCandidates(f.run.id)).toEqual([]);
 producer.recordScan(stage.id,result,10);expect(()=>f.store.captureLoopPublicationCandidate({runId:f.run.id,stageId:null,expectedResultRevision:2},producer)).toThrow();expect(f.store.listLoopPublicationCandidates(f.run.id)).toEqual([]);
 }finally{f.close();}});
it('rejects copied and foreign producer at capture without publishing a row',()=>{const f=fixture(),g=fixture();try{
 const p=f.store.openLoopPublicationProducer(f.run),q=g.store.openLoopPublicationProducer(g.run),stage=f.store.startLoopStage(f.run.id,f.run.loopId,'scan',4);p.recordScan(stage.id,actualScan(f),10);
 expect(()=>capture(f,{...p})).toThrow();expect(()=>capture(f,q)).toThrow();expect(f.store.listLoopPublicationCandidates(f.run.id)).toEqual([]);
 }finally{g.close();f.close();}});
it('captures actual service-health findings and original diagnostic fields',async()=>{const f=fixture('kswarm-service-health');const scanner=new KSwarmServiceHealthScanner(join(f.root,'health.sqlite'),{probe:()=>({expectedEntryPath:null,spawnEntryExists:true,port:{listening:false},health:{ok:false,error:'offline'},broker:{ok:false}}),logPaths:['original/log']});try{
 const result=await scanner.scan({loopRunId:f.run.id,now:10}),producer=f.store.openLoopPublicationProducer(f.run),stage=f.store.startLoopStage(f.run.id,f.run.loopId,'scan',4);producer.recordScan(stage.id,result,10);
 const body=capture(f,producer).binding.body;if(body.kind!=='builtin-diagnostic')throw Error('diagnostic');expect(body.diagnostic).toMatchObject({findings:result.summaryEvidence.metadata.findings,logPaths:['original/log'],diagnosticKinds:result.summaryEvidence.metadata.diagnosticKinds});
 }finally{scanner.close();f.close();}});
it('records complete validated evening output and all actual staged members without opening them',()=>{const f=fixture('personal-assistant-evening-reflection');try{
 const producer=f.store.openLoopPublicationProducer(f.run),output=validateEveningReflection({summary:'原完整总结',candidates:['first','second'].map(id=>({kind:'memory',title:id,content:'正文 '+id,scope:'global',confidence:0.9,evidenceRefs:[{kind:'task',id}],dedupeKey:id}))});
 producer.recordAssistantOutput(output,10);const row=capture(f,producer),members=f.store.listAssistantCandidates({statuses:['staged']});
 expect(members).toHaveLength(2);if(row.binding.body.kind!=='assistant-evening')throw Error('evening');expect(row.binding.body.summary).toBe(output.summary);expect(row.binding.body.candidates.map((x:{id:string})=>x.id).sort()).toEqual(members.map(x=>x.id).sort());expect(f.store.listAssistantCandidates({statuses:['pending','accepted']})).toEqual([]);
 output.candidates[0]!.content='late';expect(f.store.getLoopPublicationCandidate(row.candidateId)).toEqual(row);
 }finally{f.close();}});
it('records full morning recommendations without fabricating evening members',()=>{const f=fixture('personal-assistant-morning-briefing');try{
 const producer=f.store.openLoopPublicationProducer(f.run),output=validateMorningBriefing({recommendations:[{title:'原建议',reasonCode:'due_task',evidenceRefs:[{kind:'task',id:'original'}]}]});producer.recordAssistantOutput(output,10);
 expect(capture(f,producer).binding.body).toMatchObject({kind:'assistant-morning',recommendations:output.recommendations});expect(f.store.listAssistantCandidates()).toEqual([]);
 }finally{f.close();}});
it('rolls candidate and all member inserts back together on actual SQLite member failure',()=>{const f=fixture('personal-assistant-evening-reflection'),db=new DatabaseSync(f.file);try{
 const producer=f.store.openLoopPublicationProducer(f.run),output=validateEveningReflection({summary:'summary',candidates:['one','two'].map(id=>({kind:'memory',title:id,content:id,scope:'global',confidence:1,evidenceRefs:[{kind:'task',id}],dedupeKey:id}))});producer.recordAssistantOutput(output,10);
 db.exec("CREATE TRIGGER reject_second_member BEFORE INSERT ON loop_publication_candidate_members WHEN (SELECT count(*) FROM loop_publication_candidate_members)>0 BEGIN SELECT RAISE(ABORT,'member write failure'); END");
 expect(()=>capture(f,producer)).toThrow('member write failure');expect(f.store.listLoopPublicationCandidates(f.run.id)).toEqual([]);expect(db.prepare('SELECT count(*) AS count FROM loop_publication_candidate_members').get()).toMatchObject({count:0});expect(f.store.listAssistantCandidates({statuses:['staged']})).toHaveLength(2);
 db.exec('DROP TRIGGER reject_second_member');const body=capture(f,producer).binding.body;if(body.kind!=='assistant-evening')throw Error('evening');expect(body.candidates).toHaveLength(2);
 }finally{db.close();f.close();}});
it('does not silently omit a late staged evening member from a captured complete result',()=>{const f=fixture('personal-assistant-evening-reflection');try{
 const producer=f.store.openLoopPublicationProducer(f.run),output=validateEveningReflection({summary:'summary',candidates:[{kind:'memory',title:'one',content:'one',scope:'global',confidence:1,evidenceRefs:[{kind:'task',id:'one'}],dedupeKey:'one'}]});producer.recordAssistantOutput(output,10);
 try{f.store.stageAssistantCandidates(f.run.id,[{...output.candidates[0]!,title:'late',dedupeKey:'late'}],11);}catch{expect(f.store.listAssistantCandidates({statuses:['staged']})).toHaveLength(1);const body=capture(f,producer).binding.body;if(body.kind!=='assistant-evening')throw Error('evening');expect(body.candidates).toHaveLength(1);return;}
 expect(()=>capture(f,producer)).toThrow();expect(f.store.listLoopPublicationCandidates(f.run.id)).toEqual([]);
 }finally{f.close();}});
it('derives template task identity from actual successful execute and matching verify metadata',()=>{const f=fixture();try{
 const loopId='actual-template';f.store.createUserLoopTemplate({loopId,kind:'task_completion',title:'template',prompt:'Original task',now:1});
 f.store.saveLoopPublicationConfiguration({loopId,expectedRevision:null,requestSource:'user',now:2,configuration:{version:1,contract:{kind:'user-template'},verificationDefinitions:{run:recipe,stages:{execute:recipe,verify:recipe}}}});
 const begin=f.store.beginLoopRun(loopId,{kind:'manual'},3,1000,{requestSource:'user'});if(begin.status!=='started')throw Error('begin template');const producer=f.store.openLoopPublicationProducer(begin.run);
 const execute=f.store.startLoopStage(begin.run.id,loopId,'execute',4),verify=f.store.startLoopStage(begin.run.id,loopId,'verify',5);
 historicalStageSuccess(f,execute.id,'actual-task');f.store.updateLoopStageMetadata(verify.id,{taskId:'actual-task'});
 producer.recordTemplateTerminal({executeStageId:execute.id,verifyStageId:verify.id,summary:'Original verification',evidenceIds:['verify-evidence'],artifacts:[],now:10});
 const row=f.store.captureLoopPublicationCandidate({runId:begin.run.id,stageId:verify.id,expectedResultRevision:1},producer);expect(row.binding.body).toMatchObject({kind:'user-template',taskId:'actual-task',executeStageId:execute.id,verifyStageId:verify.id,summary:'Original verification'});
 expect(()=>f.store.captureLoopPublicationCandidate({runId:begin.run.id,stageId:execute.id,expectedResultRevision:1},producer)).toThrow();
 }finally{f.close();}});
it.each(['execute','verify'] as const)('rejects %s task metadata changed between result and first candidate capture',which=>{const f=fixture();try{
 const loopId='template-drift';f.store.createUserLoopTemplate({loopId,kind:'task_completion',title:'template',prompt:'original',now:1});f.store.saveLoopPublicationConfiguration({loopId,expectedRevision:null,requestSource:'user',now:2,configuration:{version:1,contract:{kind:'user-template'},verificationDefinitions:{run:recipe,stages:{execute:recipe,verify:recipe}}}});
 const begin=f.store.beginLoopRun(loopId,{kind:'manual'},3,1000,{requestSource:'user'});if(begin.status!=='started')throw Error('begin');const p=f.store.openLoopPublicationProducer(begin.run),execute=f.store.startLoopStage(begin.run.id,loopId,'execute',4),verify=f.store.startLoopStage(begin.run.id,loopId,'verify',5);
 historicalStageSuccess(f,execute.id,'original-task');f.store.updateLoopStageMetadata(verify.id,{taskId:'original-task'});
 p.recordTemplateTerminal({executeStageId:execute.id,verifyStageId:verify.id,summary:'checked',evidenceIds:[],artifacts:[],now:10});f.store.updateLoopStageMetadata(which==='execute'?execute.id:verify.id,{taskId:'other-task'});
 expect(()=>f.store.captureLoopPublicationCandidate({runId:begin.run.id,stageId:null,expectedResultRevision:1},p)).toThrow();expect(f.store.listLoopPublicationCandidates(begin.run.id)).toEqual([]);
 }finally{f.close();}});
it('does not blend pre-existing staged rows into a different actual evening response',()=>{const f=fixture('personal-assistant-evening-reflection');try{
 const p=f.store.openLoopPublicationProducer(f.run),proposal={kind:'memory' as const,title:'previous',content:'previous',scope:'global' as const,confidence:1,evidenceRefs:[{kind:'task',id:'previous'}],dedupeKey:'previous'};
 f.store.stageAssistantCandidates(f.run.id,[proposal],5);
 const output=validateEveningReflection({summary:'This response is empty',candidates:[]});
 expect(()=>p.recordAssistantOutput(output,10)).toThrow();expect(f.store.listLoopPublicationCandidates(f.run.id)).toEqual([]);
 }finally{f.close();}});
it('rejects getter output without invoking it and permits original data result only once',()=>{const f=fixture();try{
 const p=f.store.openLoopPublicationProducer(f.run),stage=f.store.startLoopStage(f.run.id,f.run.loopId,'scan',4),result=actualScan(f);let calls=0;
 const getter={...result,get summaryEvidence(){calls++;return result.summaryEvidence;}};expect(()=>p.recordScan(stage.id,getter,10)).toThrow();expect(calls).toBe(0);
 p.recordScan(stage.id,result,10);expect(()=>p.recordScan(stage.id,result,10)).toThrow();const row=capture(f,p);expect(capture(f,p)).toEqual(row);
 }finally{f.close();}});
it('retains immutable candidate after closing and reopening the DB without recreating a producer',()=>{const f=fixture();let closed=false;try{
 const producer=f.store.openLoopPublicationProducer(f.run),stage=f.store.startLoopStage(f.run.id,f.run.loopId,'scan',4);producer.recordScan(stage.id,actualScan(f),10);const row=capture(f,producer);
 f.store.close();closed=true;const reopened=new LoopStore(f.file);try{
 expect(reopened.getLoopPublicationCandidate(row.candidateId)).toEqual(row);expect(Object.isFrozen(reopened.getLoopPublicationCandidate(row.candidateId)!.binding.body)).toBe(true);
 expect(()=>reopened.openLoopPublicationProducer(f.run)).toThrow();expect(()=>reopened.openLoopPublicationProducer(reopened.getLoopRun(f.run.id)!)).toThrow();
 expect(()=>reopened.captureLoopPublicationCandidate({runId:f.run.id,stageId:null,expectedResultRevision:1},producer)).toThrow();
 }finally{reopened.close();}
 }finally{if(!closed)f.store.close();rmSync(f.root,{recursive:true,force:true});}});
it.each([false,true])('recovers durable scan results after real close/reopen, partial capture=%s',partial=>{const f=fixture();let closed=false;try{
 const producer=f.store.openLoopPublicationProducer(f.run),stage=f.store.startLoopStage(f.run.id,f.run.loopId,'scan',4);producer.recordScan(stage.id,actualScan(f),10);
 const first=partial?capture(f,producer,stage.id):undefined;f.store.close();closed=true;const reopened=new LoopStore(f.file);try{
 const rows=reopened.recoverLoopPublicationCandidates({runId:f.run.id,requestSource:'scheduler'});expect(rows).toHaveLength(2);expect(rows.map(row=>row.stageId).sort()).toEqual([null,stage.id].sort());
 if(first)expect(rows.find(row=>row.stageId===stage.id)).toEqual(first);
 expect(reopened.recoverLoopPublicationCandidates({runId:f.run.id,requestSource:'user'})).toEqual(rows);expect(reopened.listLoopPublicationCandidates(f.run.id)).toEqual(rows);
 expect(()=>reopened.openLoopPublicationProducer(f.run)).toThrow();expect(()=>reopened.captureLoopPublicationCandidate({runId:f.run.id,stageId:null,expectedResultRevision:1},producer)).toThrow();
 }finally{reopened.close();}
 }finally{if(!closed)f.store.close();rmSync(f.root,{recursive:true,force:true});}});
it('rejects recovery without a durable result and rejects agent source without side effects',()=>{const f=fixture();try{
 expect(typeof f.store.recoverLoopPublicationCandidates).toBe('function');
 expect(()=>f.store.recoverLoopPublicationCandidates({runId:f.run.id,requestSource:'scheduler'})).toThrow('loop_publication_result_missing');expect(f.store.listLoopPublicationCandidates(f.run.id)).toEqual([]);
 const p=f.store.openLoopPublicationProducer(f.run),stage=f.store.startLoopStage(f.run.id,f.run.loopId,'scan',4);p.recordScan(stage.id,actualScan(f),10);
 expect(()=>f.store.recoverLoopPublicationCandidates({runId:f.run.id,requestSource:'agent' as never})).toThrow('loop_publication_recovery_source');expect(f.store.listLoopPublicationCandidates(f.run.id)).toEqual([]);
 }finally{f.close();}});
it('rejects changed actual configuration during factual recovery without allocating candidates',()=>{const f=fixture();try{
 expect(typeof f.store.recoverLoopPublicationCandidates).toBe('function');
 const p=f.store.openLoopPublicationProducer(f.run),stage=f.store.startLoopStage(f.run.id,f.run.loopId,'scan',4);p.recordScan(stage.id,actualScan(f),10);
 const original=f.store.getLoopPublicationConfiguration(f.run.loopId)!;const configuration=structuredClone(original.configuration);if(configuration.contract.kind!=='builtin-diagnostic')throw Error('fixture contract');configuration.contract.objective='Changed after execution';
 f.store.saveLoopPublicationConfiguration({loopId:f.run.loopId,configuration,expectedRevision:1,requestSource:'user',now:11});
 expect(()=>f.store.recoverLoopPublicationCandidates({runId:f.run.id,requestSource:'scheduler'})).toThrow('loop_publication_producer_stale');expect(f.store.listLoopPublicationCandidates(f.run.id)).toEqual([]);
 }finally{f.close();}});
it('recovery failure never leaves a newly half-captured subject set',()=>{const f=fixture(),db=new DatabaseSync(f.file);try{
 expect(typeof f.store.recoverLoopPublicationCandidates).toBe('function');const p=f.store.openLoopPublicationProducer(f.run),stage=f.store.startLoopStage(f.run.id,f.run.loopId,'scan',4);p.recordScan(stage.id,actualScan(f),10);
 db.exec("CREATE TRIGGER fail_run_candidate BEFORE INSERT ON loop_publication_candidates WHEN NEW.stage_id IS NULL BEGIN SELECT RAISE(ABORT,'run candidate write failure'); END");
 expect(()=>f.store.recoverLoopPublicationCandidates({runId:f.run.id,requestSource:'scheduler'})).toThrow('run candidate write failure');expect(f.store.listLoopPublicationCandidates(f.run.id)).toEqual([]);
 db.exec('DROP TRIGGER fail_run_candidate');expect(f.store.recoverLoopPublicationCandidates({runId:f.run.id,requestSource:'scheduler'})).toHaveLength(2);
 }finally{db.close();f.close();}});

// Explicit pre-gate historical stage fixture. New raw success is separately rejected.
function historicalStageSuccess(f:{file:string;store:LoopStore},stageId:string,taskId:string){f.store.updateLoopStageMetadata(stageId,{taskId});const db=new DatabaseSync(f.file);try{db.prepare("UPDATE loop_stages SET status='success',finished_at=6,updated_at=6 WHERE id=?").run(stageId);}finally{db.close();}}
