import {it,expect} from 'vitest';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {LoopStore} from '../../electron/loop-store.js';import type {TaskSnapshot} from '../../../src/runtime/task-host/types.js';
const recipe={version:1,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'check',path:'report',sha256:'a'.repeat(64),structure:'bytes'}]}}]};
// Explicit TaskSnapshot data fixture. This does not stand in for a TaskHost receipt.
function snapshot():TaskSnapshot{return{taskId:'actual-task',sessionId:'independent-session',status:'completed',prompt:'Original task',materials:[],events:[],createdAt:4,updatedAt:8,usage:{inputTokens:10,outputTokens:2,known:true}};}
function fixture(){const root=mkdtempSync(join(tmpdir(),'loop-execution-')),file=join(root,'loop.sqlite'),store=new LoopStore(file),loopId='template';store.createUserLoopTemplate({loopId,kind:'task_completion',title:'Actual template',prompt:'Original task',now:1});store.saveLoopPublicationConfiguration({loopId,expectedRevision:null,requestSource:'user',now:2,configuration:{version:1,contract:{kind:'user-template'},verificationDefinitions:{run:recipe,stages:{execute:recipe,verify:recipe}}}});const begin=store.beginLoopRun(loopId,{kind:'manual'},3,1000,{requestSource:'user'});if(begin.status!=='started')throw Error('fixture');const producer=store.openLoopPublicationProducer(begin.run),execute=store.startLoopStage(begin.run.id,loopId,'execute',4,{taskId:'actual-task'});return{root,file,store,loopId,run:begin.run,producer,execute,close(){store.close();rmSync(root,{recursive:true,force:true});}};}
function record(f:ReturnType<typeof fixture>,taskSnapshot=snapshot()){f.producer.recordTemplateExecution({executeStageId:f.execute.id,taskSnapshot,summary:'Original execution',evidenceIds:[],artifacts:[],now:9});}
function capture(f:ReturnType<typeof fixture>,stageId:string|null=f.execute.id){return f.store.captureLoopPublicationCandidate({runId:f.run.id,stageId,expectedResultRevision:1},f.producer);}
it('records execution once without marking stage or run business success and selects only execute',()=>{const f=fixture();try{
 record(f);expect(f.store.listLoopStages(f.run.id).find(stage=>stage.id===f.execute.id)?.status).toBe('running');expect(f.store.getLoopRun(f.run.id)?.status).toBe('running');const row=capture(f);
 expect(row.binding.subject.stage).toEqual({stageId:f.execute.id,stageKind:'execute'});expect(row.binding.body).toMatchObject({kind:'user-template-execute',taskId:'actual-task',executeStageId:f.execute.id,summary:'Original execution'});
 expect(()=>capture(f,null)).toThrow();expect(()=>record(f)).toThrow();expect(capture(f)).toEqual(row);
 }finally{f.close();}});
it.each(['failed','wrong-task','missing-session','getter','already-success'] as const)('rejects invalid or foreign execution snapshot: %s',mode=>{const f=fixture();try{
 expect(typeof f.producer.recordTemplateExecution).toBe('function');let value=snapshot(),calls=0;
 if(mode==='failed')value.status='failed';if(mode==='wrong-task')value.taskId='other-task';if(mode==='missing-session')delete (value as Partial<TaskSnapshot>).sessionId;
 if(mode==='getter')Object.defineProperty(value,'status',{enumerable:true,get(){calls++;return 'completed';}});
 if(mode==='already-success')historicalSuccess(f);
 expect(()=>record(f,value)).toThrow();expect(calls).toBe(0);expect(f.store.listLoopPublicationCandidates(f.run.id)).toEqual([]);
 }finally{f.close();}});
it('refuses verify or another run stage as execute',()=>{const f=fixture();try{
 expect(typeof f.producer.recordTemplateExecution).toBe('function');const verify=f.store.startLoopStage(f.run.id,f.loopId,'verify',5,{taskId:'actual-task'});
 expect(()=>f.producer.recordTemplateExecution({executeStageId:verify.id,taskSnapshot:snapshot(),summary:'wrong stage',evidenceIds:[],artifacts:[],now:9})).toThrow();
 f.store.createUserLoopTemplate({loopId:'other',kind:'task_completion',title:'other',prompt:'other',now:1});const other=f.store.beginLoopRun('other',{kind:'manual'},3,1000);if(other.status!=='started')throw Error('other');const otherStage=f.store.startLoopStage(other.run.id,'other','execute',4,{taskId:'actual-task'});
 expect(()=>f.producer.recordTemplateExecution({executeStageId:otherStage.id,taskSnapshot:snapshot(),summary:'wrong run',evidenceIds:[],artifacts:[],now:9})).toThrow();
 }finally{f.close();}});
it('allows terminal after actual execution fact while execute remains business pending',()=>{const f=fixture();try{
 const value=snapshot();record(f,value);value.prompt='late input mutation';const verify=f.store.startLoopStage(f.run.id,f.loopId,'verify',10,{taskId:'actual-task'});
 f.producer.recordTemplateTerminal({executeStageId:f.execute.id,verifyStageId:verify.id,summary:'Original verification',evidenceIds:[],artifacts:[],now:11});
 const execution=capture(f),terminal=capture(f,verify.id),run=capture(f,null);expect(new Set([execution.candidateId,terminal.candidateId,run.candidateId]).size).toBe(3);expect(f.store.listLoopStages(f.run.id).find(stage=>stage.id===f.execute.id)?.status).toBe('running');expect(terminal.binding.body).toMatchObject({kind:'user-template',taskId:'actual-task'});
 }finally{f.close();}});
it('reopens execution-only facts into exactly one execute candidate without inventing terminal or producer',()=>{const f=fixture();let closed=false;try{
 record(f);f.store.close();closed=true;const restored=new LoopStore(f.file);try{const rows=restored.recoverLoopPublicationCandidates({runId:f.run.id,requestSource:'scheduler'});expect(rows).toHaveLength(1);expect(rows[0]!.stageId).toBe(f.execute.id);expect(rows[0]!.binding.body.kind).toBe('user-template-execute');expect(restored.recoverLoopPublicationCandidates({runId:f.run.id,requestSource:'user'})).toEqual(rows);expect(()=>restored.openLoopPublicationProducer(f.run)).toThrow();}finally{restored.close();}
 }finally{if(!closed)f.store.close();rmSync(f.root,{recursive:true,force:true});}});
it('rejects task identity drift before terminal without replacing the original execution result',()=>{const f=fixture();try{
 record(f);f.store.updateLoopStageMetadata(f.execute.id,{taskId:'late-task'});const verify=f.store.startLoopStage(f.run.id,f.loopId,'verify',10,{taskId:'late-task'});
 expect(()=>f.producer.recordTemplateTerminal({executeStageId:f.execute.id,verifyStageId:verify.id,summary:'late',evidenceIds:[],artifacts:[],now:11})).toThrow();expect(f.store.listLoopPublicationCandidates(f.run.id)).toEqual([]);
 }finally{f.close();}});
it('all execute/verify/run recovery inserts roll back on terminal candidate write failure',()=>{const f=fixture(),db=new DatabaseSync(f.file);try{
 record(f);const verify=f.store.startLoopStage(f.run.id,f.loopId,'verify',10,{taskId:'actual-task'});f.producer.recordTemplateTerminal({executeStageId:f.execute.id,verifyStageId:verify.id,summary:'checked',evidenceIds:[],artifacts:[],now:11});
 db.exec("CREATE TRIGGER refuse_run BEFORE INSERT ON loop_publication_candidates WHEN NEW.stage_id IS NULL BEGIN SELECT RAISE(ABORT,'terminal candidate failure'); END");expect(()=>f.store.recoverLoopPublicationCandidates({runId:f.run.id,requestSource:'scheduler'})).toThrow('terminal candidate failure');expect(f.store.listLoopPublicationCandidates(f.run.id)).toEqual([]);
 db.exec('DROP TRIGGER refuse_run');const rows=f.store.recoverLoopPublicationCandidates({runId:f.run.id,requestSource:'scheduler'});expect(rows).toHaveLength(3);expect(f.store.recoverLoopPublicationCandidates({runId:f.run.id,requestSource:'scheduler'})).toEqual(rows);
 }finally{db.close();f.close();}});
it('stores the entire immutable task snapshot with its independent session identity',()=>{const f=fixture(),db=new DatabaseSync(f.file);try{
 const original=snapshot();record(f,original);original.prompt='changed';original.usage!.inputTokens=999;
 const row=db.prepare('SELECT task_snapshot_json FROM loop_stage_execution_results WHERE stage_id=?').get(f.execute.id) as {task_snapshot_json:string};expect(JSON.parse(row.task_snapshot_json)).toEqual(snapshot());expect(JSON.parse(row.task_snapshot_json).sessionId).not.toBe(f.run.id);
 db.prepare('UPDATE loop_stage_execution_results SET task_snapshot_json=? WHERE stage_id=?').run(JSON.stringify({...snapshot(),sessionId:'wrong-session'}),f.execute.id);
 expect(()=>capture(f)).toThrow();expect(f.store.listLoopPublicationCandidates(f.run.id)).toEqual([]);
 }finally{db.close();f.close();}});
it('actual execution-result insert failure retains pending stage and allows one clean retry',()=>{const f=fixture(),db=new DatabaseSync(f.file);try{
 expect(typeof f.producer.recordTemplateExecution).toBe('function');db.exec("CREATE TRIGGER refuse_execution BEFORE INSERT ON loop_stage_execution_results BEGIN SELECT RAISE(ABORT,'execution result failure'); END");
 expect(()=>record(f)).toThrow('execution result failure');expect(db.prepare('SELECT count(*) AS count FROM loop_stage_execution_results').get()).toMatchObject({count:0});expect(f.store.listLoopStages(f.run.id).find(stage=>stage.id===f.execute.id)?.status).toBe('running');
 db.exec('DROP TRIGGER refuse_execution');record(f);expect(capture(f).binding.body.kind).toBe('user-template-execute');
 }finally{db.close();f.close();}});
it('late execution cannot change an already captured terminal candidate or create a new subject',()=>{const f=fixture();try{
 historicalSuccess(f);const verify=f.store.startLoopStage(f.run.id,f.loopId,'verify',10,{taskId:'actual-task'});
 f.producer.recordTemplateTerminal({executeStageId:f.execute.id,verifyStageId:verify.id,summary:'Original terminal',evidenceIds:[],artifacts:[],now:11});const before=capture(f,null);
 const late=f.store.startLoopStage(f.run.id,f.loopId,'execute',12,{taskId:'actual-task'});expect(()=>f.producer.recordTemplateExecution({executeStageId:late.id,taskSnapshot:snapshot(),summary:'late',evidenceIds:[],artifacts:[],now:13})).toThrow('loop_publication_result_exists');
 expect(capture(f,null)).toEqual(before);expect(f.store.getLoopPublicationCandidate(before.candidateId)).toEqual(before);expect(()=>capture(f,late.id)).toThrow();
 }finally{f.close();}});
it('a sibling execute stage cannot select another stage durable execution result',()=>{const f=fixture();try{
 record(f);const original=capture(f),sibling=f.store.startLoopStage(f.run.id,f.loopId,'execute',10,{taskId:'actual-task'});
 expect(()=>capture(f,sibling.id)).toThrow('loop_publication_result_revision');expect(capture(f)).toEqual(original);expect(f.store.listLoopPublicationCandidates(f.run.id)).toHaveLength(1);
 }finally{f.close();}});

// Deliberate historical/corrupt success state; no production completion grant is minted.
function historicalSuccess(f:ReturnType<typeof fixture>){const db=new DatabaseSync(f.file);try{db.prepare("UPDATE loop_stages SET status='success',finished_at=8,updated_at=8 WHERE id=?").run(f.execute.id);}finally{db.close();}}
