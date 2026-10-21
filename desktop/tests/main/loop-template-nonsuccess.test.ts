import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {LoopStore} from '../../electron/loop-store.js';
import {CompletionEvidenceStore} from '../../electron/completion-evidence-store.js';
import {createLoopRunner,createLoopExecutor} from '../../electron/loop-executor.js';
import {createUserLoopTemplateRunner} from '../../electron/user-loop-template-runner.js';
import {withReservedTaskFixture} from '../support/loop-reserved-task-fixture.js';
const recipe={version:1,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'check',path:'report',sha256:'a'.repeat(64),structure:'bytes'}]}}]};
const disposals:(()=>void)[]=[];afterEach(()=>{for(const close of disposals.splice(0))close();});
function fixture(kind:'markdown_file'|'task_completion',outcome:'failed'|'blocked'){
 const root=mkdtempSync(join(tmpdir(),'loop-nonsuccess-')),file=join(root,'loops.sqlite');let store=new LoopStore(file);const evidence=new CompletionEvidenceStore(join(root,'evidence.sqlite'));
 const loopId='template';store.createUserLoopTemplate({loopId,title:'Original',kind,prompt:'Original task',outputDirectory:root,outputFileName:'report.md',now:1});
 if(kind==='task_completion'){
  const template=store.getUserLoopTemplate(loopId)!;const db=new DatabaseSync(file);try{db.prepare('UPDATE user_loop_templates SET contract_json=? WHERE loop_id=?').run(JSON.stringify({...template.contract,successCriteria:[{kind:'task_completed',strength:'strong'}]}),loopId);}finally{db.close();}
 }
 store.saveLoopPublicationConfiguration({loopId,expectedRevision:null,requestSource:'user',now:2,configuration:{version:1,contract:{kind:'user-template'},verificationDefinitions:{run:recipe,stages:{execute:recipe,verify:recipe}}}});
 writeFileSync(join(root,'report.md'),'# Existing artifact\nOriginal content\n');
 const db=new DatabaseSync(file);try{db.prepare('UPDATE user_loop_templates SET auto_run_approved=1 WHERE loop_id=?').run(loopId);}finally{db.close();}
 const createTask=vi.fn(async()=>({taskId:'original-task'})),recoverTask=vi.fn(async()=>({snapshot:{taskId:'original-task',sessionId:'original-session',status:'completed' as const,prompt:'Original task',materials:[],events:[],createdAt:10,updatedAt:10}}));
 const verification=outcome==='failed'?{status:'failed' as const,failureKind:'validation_failed' as const,message:'Strong criterion failed',evidenceIds:['actual-evidence']}:{status:'blocked' as const,nextActionKind:'manual_review',nextActionSummary:'Original independent review required',evidenceIds:['actual-evidence']};
 const verifier=vi.fn(async()=>verification),taskPort=withReservedTaskFixture({createTask,recoverTask,cancelTask:async()=>{}},'original-task');
 function compose(){const template=createUserLoopTemplateRunner({loopStore:store,evidenceStore:evidence,taskPort,verifierRegistry:{file_exists:verifier,task_completed:verifier},now:()=>10});return{template,runner:createLoopRunner({loopStore:store,evidenceStore:evidence,scanner:{scan(){throw Error('unused');}},userLoopTemplateRunner:template,now:()=>10})};}
 disposals.push(()=>{evidence.close();store.close();rmSync(root,{recursive:true,force:true});});
 return{get store(){return store;},evidence,root,file,loopId,createTask,recoverTask,verifier,compose,reopen(){store.close();store=new LoopStore(file);return compose();}};
}
it.each([['markdown_file','failed'],['markdown_file','blocked'],['task_completion','failed'],['task_completion','blocked']] as const)('actual %s strong %s terminates without publishing or rerunning original task',async(kind,outcome)=>{
 const f=fixture(kind,outcome),{runner}=f.compose();const result=await runner.runLoopNow(f.loopId,{kind:'manual',logicalRunKey:'original'},undefined,{requestSource:'user'});
 expect(result.status).toBe(outcome);if(!('run' in result))throw Error('run missing');
 const original=f.store.getLoopRun(result.run.id)!;expect(original.status).toBe(outcome);expect(original.evidenceIds).toEqual(['actual-evidence']);expect(f.store.getLoopDefinition(f.loopId)?.activeRunId).toBeUndefined();
 expect(f.store.getLoopRunLifecycle(original.id)).toMatchObject({executionPhase:'execution_terminal',businessState:outcome,terminalResultPresent:false});
 expect(f.store.listLoopPublicationCandidates(original.id).map(c=>c.binding.body.kind)).toEqual(['user-template-execute']);
 const stages=f.store.listLoopStages(original.id);expect(stages.find(s=>s.stageKind==='execute')?.status).toBe('running');expect(stages.find(s=>s.stageKind==='verify')).toMatchObject({status:outcome,metadata:{localEvaluationStarted:true,localEvaluation:{status:outcome,evidenceIds:['actual-evidence']}}});
 expect(f.store.finishLoopRunSuccess(original.id,[],100,'forged')?.status).toBe(outcome);
 const reads=f.recoverTask.mock.calls.length,{template}=f.reopen();const recovered=await template.recoverTemplateLoop!({loopId:f.loopId,runId:original.id,requestSource:'scheduler'});
 expect(recovered).toEqual({status:outcome,run:original});expect(f.createTask).toHaveBeenCalledTimes(1);expect(f.verifier).toHaveBeenCalledTimes(1);expect(f.recoverTask).toHaveBeenCalledTimes(reads);
});
it('timed executor receives actual strong failure instead of an executing placeholder',async()=>{
 const f=fixture('task_completion','failed'),{runner}=f.compose(),executor=createLoopExecutor({runLoop:(...args)=>runner.runLoopNow(...args)});
 await expect(executor.execute({executor:{kind:'loop',loopId:f.loopId}} as any,{scheduledDueAt:1,claimedAt:2,overdueMs:1,recoveryReason:'normal_tick'} as any)).rejects.toThrow('Strong criterion failed');
 expect(f.store.listLoopRuns(f.loopId,1)[0].status).toBe('failed');expect(f.createTask).toHaveBeenCalledTimes(1);
});

it.each(['failed','blocked'] as const)('SQL tail rollback preserves started verdict and both stores; recovery cannot wash %s through default file verifier',async outcome=>{
 const f=fixture('markdown_file',outcome),{runner}=f.compose();
 f.verifier.mockImplementation(async()=>{
  const db=new DatabaseSync(f.file);try{db.exec(`CREATE TRIGGER fail_nonsuccess_tail AFTER UPDATE ON automation_store_metadata WHEN EXISTS(SELECT 1 FROM loop_runs WHERE status IN ('failed','blocked')) BEGIN UPDATE loop_runs SET summary='late changed';END`);}finally{db.close();}
  return outcome==='failed'?{status:'failed',failureKind:'validation_failed',message:'Strong criterion failed',evidenceIds:['actual-evidence']}:{status:'blocked',nextActionKind:'manual_review',nextActionSummary:'Original independent review required',evidenceIds:['actual-evidence']};
 });
 await expect(runner.runLoopNow(f.loopId,{kind:'manual'},undefined,{requestSource:'user'})).rejects.toThrowError(new Error('loop_template_outcome_changed'));
 const run=f.store.listLoopRuns(f.loopId,1)[0],verify=f.store.listLoopStages(run.id).find(s=>s.stageKind==='verify')!,execute=f.store.listLoopStages(run.id).find(s=>s.stageKind==='execute')!;
 expect(run.status).toBe('running');expect(verify.metadata.localEvaluationStarted).toBe(true);expect(verify.metadata.localEvaluation).toBeUndefined();
 expect(f.evidence.listEvidenceForOwner('loop_run',run.id)).toEqual([]);expect(f.evidence.listCompletionRecords({ownerKind:'loop_run',ownerId:run.id})).toEqual([]);
 let getters=0;expect(()=>f.store.updateLoopStageMetadata(verify.id,{get localEvaluationStarted(){getters++;return false;}})).toThrow();expect(getters).toBe(0);
 expect(()=>f.store.updateLoopStageMetadata(verify.id,{localEvaluationStarted:false})).toThrow();expect(()=>f.store.updateLoopStageMetadata(verify.id,{localEvaluation:{status:'success',evidenceIds:[],summary:'forged'}})).toThrow();
 const {template}=f.reopen();expect((await template.recoverTemplateLoop!({loopId:f.loopId,runId:run.id,requestSource:'scheduler'})).status).toBe('executing');
 const {createLoopTemplateExecutionRecovery}=await import('../../electron/loop-template-execution-recovery.js');const host=createLoopTemplateExecutionRecovery({store:f.store,taskPort:{recoverTask:f.recoverTask}});
 await expect(host.prepareMarkdownTerminal({runId:run.id,executeStageId:execute.id,verifyStageId:verify.id,requestSource:'user',now:100})).rejects.toThrow();
 expect(f.createTask).toHaveBeenCalledTimes(1);expect(f.verifier).toHaveBeenCalledTimes(1);expect(f.store.listLoopPublicationCandidates(run.id)).toHaveLength(1);
});

it('live producer rejects wrong source, success DTO and accessors before writing a non-success outcome',()=>{
 const f=fixture('task_completion','failed'),began=f.store.beginLoopRun(f.loopId,{kind:'manual'},3,1000,{requestSource:'user'});if(began.status!=='started')throw Error('begin');
 const producer=f.store.openLoopPublicationProducer(began.run),execute=f.store.startLoopStage(began.run.id,f.loopId,'execute',4,{taskId:'original-task'});
 producer.recordTemplateExecution({executeStageId:execute.id,taskSnapshot:{taskId:'original-task',sessionId:'original-session',status:'completed',prompt:'Original',materials:[],events:[],createdAt:4,updatedAt:5} as any,summary:'Original',evidenceIds:[],artifacts:[],now:6});
 const verify=f.store.startLoopStage(began.run.id,f.loopId,'verify',7,{taskId:'original-task',localEvaluationStarted:true}),input={executeStageId:execute.id,verifyStageId:verify.id,evaluation:{status:'failed' as const,failureKind:'validation_failed' as const,message:'Original failure',evidenceIds:[]},requestSource:'user' as const,now:8};
 const before=f.store.listLoopStages(began.run.id);
 for(const requestSource of ['agent','scheduler'] as const)expect(()=>producer.recordTemplateNonSuccess({...input,requestSource})).toThrow('source');
 expect(()=>producer.recordTemplateNonSuccess({...input,evaluation:{status:'success',evidenceIds:[],summary:'forged'}} as any)).toThrow();
 let calls=0;expect(()=>producer.recordTemplateNonSuccess({...input,get now(){calls++;return 8;}})).toThrow();expect(calls).toBe(0);
 expect(f.store.listLoopStages(began.run.id)).toEqual(before);expect(f.store.getLoopRun(began.run.id)?.status).toBe('running');
 producer.recordTemplateNonSuccess(input);expect(f.store.getLoopRun(began.run.id)?.status).toBe('failed');
 expect(()=>producer.recordTemplateTerminal({executeStageId:execute.id,verifyStageId:verify.id,summary:'forged',evidenceIds:[],artifacts:[],now:9})).toThrow();
});
it('commit followed by lost reply recovers the durable failed row after actual DB reopen without redoing verifier',async()=>{
 const f=fixture('markdown_file','failed');
 await expect(f.compose().runner.runLoopNow(f.loopId,undefined,undefined,{requestSource:'user'}).then(()=>{throw Error('outcome reply lost');})).rejects.toThrow('outcome reply lost');
 const row=f.store.listLoopRuns(f.loopId,1)[0];expect(row.status).toBe('failed');const {template}=f.reopen();
 expect(await template.recoverTemplateLoop!({loopId:f.loopId,runId:row.id,requestSource:'scheduler'})).toEqual({status:'failed',run:row});expect(f.verifier).toHaveBeenCalledTimes(1);expect(f.createTask).toHaveBeenCalledTimes(1);
});

it.each(['delete','rewind'] as const)('non-success transaction rolls back %s of the original store version at SQL tail',async mutation=>{
 const f=fixture('markdown_file','failed');let beforeVersion=0;
 f.verifier.mockImplementation(async()=>{
  beforeVersion=f.store.getAutomationStoreVersion();
  const db=new DatabaseSync(f.file);try{db.exec(`CREATE TRIGGER corrupt_outcome_version AFTER UPDATE ON automation_store_metadata WHEN EXISTS(SELECT 1 FROM loop_runs WHERE status='failed') BEGIN ${mutation==='delete'?"DELETE FROM automation_store_metadata WHERE key='version'":"UPDATE automation_store_metadata SET value=OLD.value WHERE key='version'"}; END`);}finally{db.close();}
  return {status:'failed',failureKind:'validation_failed',message:'Strong criterion failed',evidenceIds:['actual-evidence']};
 });
 await expect(f.compose().runner.runLoopNow(f.loopId,undefined,undefined,{requestSource:'user'})).rejects.toThrowError(new Error('loop_template_outcome_changed'));
 const run=f.store.listLoopRuns(f.loopId,1)[0];expect(run.status).toBe('running');expect(f.store.getLoopDefinition(f.loopId)?.activeRunId).toBe(run.id);
 expect(f.store.getAutomationStoreVersion()).toBe(beforeVersion);expect(f.store.listLoopStages(run.id).find(s=>s.stageKind==='verify')?.metadata.localEvaluation).toBeUndefined();
});
