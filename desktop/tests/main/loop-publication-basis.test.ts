import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {LoopStore} from '../../electron/loop-store.js';
import {parseLoopPublicationConfiguration} from '../../electron/loop-publication-config.js';
const recipe={version:1,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'check',path:'report',sha256:'a'.repeat(64),structure:'bytes'}]}}]};
const builtin=()=>({version:1,contract:{kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',objective:'原目标',completionCriterion:'原完整条件'},verificationDefinitions:{run:structuredClone(recipe),stages:{scan:structuredClone(recipe)}}});
function fixture(){const root=mkdtempSync(join(tmpdir(),'loop-basis-')),file=join(root,'loop.sqlite'),store=new LoopStore(file);store.ensureBuiltInLoops(1);return{store,file,close(){store.close();rmSync(root,{recursive:true,force:true});}};}
function save(store:LoopStore,configuration:unknown=builtin(),loopId='artifact-evidence-regression',expectedRevision:number|null=null){return store.saveLoopPublicationConfiguration({loopId,configuration,expectedRevision,requestSource:'user',now:2});}
it('keeps explicit independent recipes and rejects unknown fields, absent stage definitions and weak recipe substitutes',()=>{
 expect(parseLoopPublicationConfiguration(builtin())).toEqual(builtin());
 for(const change of [ {...builtin(),extra:true},{...builtin(),verificationDefinitions:{run:recipe,stages:{}}},{...builtin(),verificationDefinitions:{run:{success:true},stages:{scan:recipe}}}])expect(()=>parseLoopPublicationConfiguration(change)).toThrow();
});
it('only user may configure an actual matching loop; CAS preserves the original rows',()=>{const f=fixture();try{
 for(const requestSource of ['agent','scheduler'] as const)expect(()=>f.store.saveLoopPublicationConfiguration({loopId:'artifact-evidence-regression',configuration:builtin(),expectedRevision:null,requestSource,now:2})).toThrow(/source/);
 expect(()=>save(f.store,builtin(),'missing')).toThrow();expect(()=>save(f.store,builtin(),'kswarm-service-health')).toThrow();
 const first=save(f.store);expect(first.revision).toBe(1);expect(()=>save(f.store)).toThrow(/conflict/);expect(f.store.getLoopPublicationConfiguration('artifact-evidence-regression')).toEqual(first);
 }finally{f.close();}});
it('captures actual run, config and original trigger in the same begin transaction, preserving the actual trimmed logical key',()=>{const f=fixture();try{
 save(f.store);const trigger={kind:'scheduled',logicalRunKey:'  original-key  ',requestSource:'agent',nested:{exact:'value'}};
 const begin=f.store.beginLoopRun('artifact-evidence-regression',trigger,3,1000,{requestSource:'scheduler'});expect(begin.status).toBe('started');if(begin.status!=='started')throw Error('start');
 const basis=f.store.getLoopRunPublicationBasis(begin.run.id)!;expect(basis).toMatchObject({runId:begin.run.id,requestSource:'scheduler',logicalRunKey:'original-key',contract:{objective:'原目标'}});
 expect(JSON.parse(basis.originalTriggerJson)).toEqual(trigger);expect(basis.sourceRows.run.id).toBe(begin.run.id);expect(basis.sourceRows.definition.active_run_id).toBe(begin.run.id);
 trigger.nested.exact='changed';save(f.store,{...builtin(),contract:{...builtin().contract,objective:'未来目标'}},'artifact-evidence-regression',1);
 expect(f.store.getLoopRunPublicationBasis(begin.run.id)).toEqual(basis);
 }finally{f.close();}});
it('never reads source from trigger and rolls back run allocation if the host omits it',()=>{const f=fixture();try{
 save(f.store);expect(()=>f.store.beginLoopRun('artifact-evidence-regression',{kind:'manual',requestSource:'user'},3,1000)).toThrow(/source/);
 expect(f.store.listLoopRuns('artifact-evidence-regression',100)).toEqual([]);expect(f.store.getLoopDefinition('artifact-evidence-regression')?.activeRunId).toBeUndefined();
 }finally{f.close();}});
it('ordinary runs without configuration retain their original behavior and do not gain an inferred basis',()=>{const f=fixture();try{
 const begin=f.store.beginLoopRun('artifact-evidence-regression',{kind:'manual'},3,1000);if(begin.status!=='started')throw Error('start');expect(f.store.getLoopRunPublicationBasis(begin.run.id)).toBeUndefined();
 }finally{f.close();}});
it('captures the actual user template contract and empty task-completion output fields',()=>{const f=fixture();try{
 f.store.createUserLoopTemplate({loopId:'template',kind:'task_completion',title:'原模板',prompt:'原完整提示',now:1});
 save(f.store,{version:1,contract:{kind:'user-template'},verificationDefinitions:{run:recipe,stages:{execute:recipe,verify:recipe}}},'template');
 const begin=f.store.beginLoopRun('template',{kind:'manual'},3,1000,{requestSource:'user'});if(begin.status!=='started')throw Error('start');const basis=f.store.getLoopRunPublicationBasis(begin.run.id)!;
 expect(basis.contract).toEqual({version:1,kind:'user-template',templateKind:'task_completion',prompt:'原完整提示',outputDirectory:'',outputFileName:'',loopContract:f.store.getUserLoopTemplate('template')!.contract});
 }finally{f.close();}});
it('captures actual assistant profile order and retains independent target text',()=>{const f=fixture();try{
 const loopId='personal-assistant-evening-reflection';f.store.ensureAssistantProfile({id:'default-personal-assistant',status:'active',locale:'zh',timeZone:'Asia/Shanghai',eveningTime:'20:00',morningTime:'08:00',workdays:[1],quietHours:{start:'22:00',end:'07:00'},dataScopes:['tasks','threads','tasks'],createdAt:1,updatedAt:1});f.store.setLoopStatus(loopId,'active',2);
 save(f.store,{version:1,contract:{kind:'assistant',assistantKind:'evening',objective:'助手原目标',completionCriterion:'助手原条件'},verificationDefinitions:{run:recipe,stages:{}}},loopId);
 const begin=f.store.beginLoopRun(loopId,{kind:'assistant'},3,1000,{requestSource:'scheduler'});if(begin.status!=='started')throw Error('start');expect(f.store.getLoopRunPublicationBasis(begin.run.id)?.contract).toMatchObject({profileId:'default-personal-assistant',locale:'zh',timeZone:'Asia/Shanghai',dataScopes:['tasks','threads','tasks'],objective:'助手原目标'});
 }finally{f.close();}});
it('rolls back both run and active pointer on basis write failure',()=>{const f=fixture();const db=new DatabaseSync(f.file);try{
 save(f.store);db.exec("CREATE TRIGGER fail_basis BEFORE INSERT ON loop_run_publication_basis BEGIN SELECT RAISE(ABORT,'basis disk failure'); END");
 expect(()=>f.store.beginLoopRun('artifact-evidence-regression',{kind:'manual'},3,1000,{requestSource:'user'})).toThrow('basis disk failure');expect(f.store.listLoopRuns('artifact-evidence-regression',100)).toEqual([]);expect(f.store.getLoopDefinition('artifact-evidence-regression')?.activeRunId).toBeUndefined();
 }finally{db.close();f.close();}});
it('independent: captures host source before trigger serialization can change the caller object',()=>{const f=fixture();try{
 save(f.store);const context:{requestSource:'user'|'scheduler'}={requestSource:'scheduler'};
 const trigger={kind:'scheduled',toJSON(){context.requestSource='user';return {kind:'scheduled'};}};
 let result:ReturnType<LoopStore['beginLoopRun']>;try{result=f.store.beginLoopRun('artifact-evidence-regression',trigger,3,1000,context);}catch{expect(context.requestSource).toBe('scheduler');expect(f.store.listLoopRuns('artifact-evidence-regression',100)).toEqual([]);return;}
 if(result.status!=='started')throw Error('start');
 expect(f.store.getLoopRunPublicationBasis(result.run.id)?.requestSource).toBe('scheduler');
 }finally{f.close();}});
it('independent: actual competing connections preserve config CAS and old run basis',()=>{const f=fixture();const other=new LoopStore(f.file);try{
 const first=save(f.store);const started=f.store.beginLoopRun('artifact-evidence-regression',{kind:'manual'},3,1000,{requestSource:'user'});if(started.status!=='started')throw Error('start');
 const basis=f.store.getLoopRunPublicationBasis(started.run.id);
 const second=other.saveLoopPublicationConfiguration({loopId:first.loopId,configuration:builtin(),expectedRevision:1,requestSource:'user',now:4});expect(second.revision).toBe(2);
 expect(()=>f.store.saveLoopPublicationConfiguration({loopId:first.loopId,configuration:builtin(),expectedRevision:1,requestSource:'user',now:4})).toThrow(/conflict/);
 expect(other.getLoopRunPublicationBasis(started.run.id)).toEqual(basis);
 }finally{other.close();f.close();}});
it('independent: rejects accessor host context without invoking it or allocating a run',()=>{const f=fixture();try{
 save(f.store);let calls=0;const context={get requestSource(){calls++;return 'user' as const;}};
 expect(()=>f.store.beginLoopRun('artifact-evidence-regression',{kind:'manual'},3,1000,context)).toThrow();
 expect(calls).toBe(0);expect(f.store.listLoopRuns('artifact-evidence-regression',100)).toEqual([]);
 }finally{f.close();}});
it('independent: history deletion cannot orphan a captured basis',()=>{const f=fixture();try{
 save(f.store);const started=f.store.beginLoopRun('artifact-evidence-regression',{kind:'manual'},3,1000,{requestSource:'user'});if(started.status!=='started')throw Error('start');
 const basis=f.store.getLoopRunPublicationBasis(started.run.id);f.store.finishLoopRunFailure(started.run.id,'executor_failed','historical terminal',[],4);
 expect(()=>f.store.clearLoopRunHistory('artifact-evidence-regression',['failed'])).toThrow();
 expect(f.store.getLoopRun(started.run.id)?.status).toBe('failed');expect(f.store.getLoopRunPublicationBasis(started.run.id)).toEqual(basis);
 }finally{f.close();}});
it('independent: configured run derives dedupe key and frozen trigger from the same captured value',()=>{const f=fixture();try{
 save(f.store);const trigger={kind:'manual',logicalRunKey:'key-before',toJSON(){return {kind:'manual',logicalRunKey:'key-after'};}};
 let result:ReturnType<LoopStore['beginLoopRun']>;try{result=f.store.beginLoopRun('artifact-evidence-regression',trigger,3,1000,{requestSource:'user'});}catch{expect(f.store.listLoopRuns('artifact-evidence-regression',100)).toEqual([]);return;}
 if(result.status!=='started')throw Error('start');const basis=f.store.getLoopRunPublicationBasis(result.run.id)!;
 expect(basis.logicalRunKey).toBe(JSON.parse(basis.originalTriggerJson).logicalRunKey.trim());
 }finally{f.close();}});
