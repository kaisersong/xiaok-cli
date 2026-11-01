// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {LoopStore} from '../../electron/loop-store.js';
import {createAssistantQualityProduct} from '../../electron/assistant-quality-product.js';
import {AssistantAnalysisSettings} from '../../electron/assistant-analysis-settings.js';
import {readAssistantModelIdentity} from '../../../src/runtime/assistant/model-identity.js';
import {readCurrentAssistantQualityAssessment,readAssistantQualityAuthorization,readQualityGeneration} from '../../../src/runtime/assistant/quality-authorization.js';
import {readAssistantQualityQualification} from '../../../src/runtime/assistant/quality-qualification.js';
const roots:string[]=[];const stores:LoopStore[]=[];const owners:DatabaseSync[]=[];
afterEach(()=>{for(const db of owners.splice(0))db.close();for(const store of stores.splice(0))store.close();vi.unstubAllEnvs();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const port={contract:{id:'synthetic-identity-contract',provider:'deepseek',model:'deepseek-flash',tokenizer:'synthetic',protocolOverheadMeasured:true as const,maxOutputTokensEnforced:true as const,usageIncludesReasoningAndProtocol:true as const},measureInput:()=>1,complete:async()=>({text:'',usage:'unknown' as const,finish:'complete' as const})};
function makeStore(file:string){const store=new LoopStore(file);stores.push(store);return store;}
async function assessed(){
 const root=mkdtempSync(join(tmpdir(),'assistant-persisted-identity-'));roots.push(root);vi.stubEnv('XIAOK_CONFIG_DIR',root);vi.stubEnv('XIAOK_DEEPSEEK_API_KEY','synthetic-env-key-a');
 writeFileSync(join(root,'config.json'),JSON.stringify({schemaVersion:2,defaultModelId:'selected',providers:{deepseek:{type:'first_party',protocol:'openai_legacy',apiKey:'synthetic-config-key',baseUrl:'https://api.deepseek.com'}},models:{selected:{provider:'deepseek',model:'deepseek-flash'}}}));
 const file=join(root,'quality.sqlite'),store=makeStore(file),identity=readAssistantModelIdentity();
 const profile=store.ensureAssistantProfile({id:'default-personal-assistant',status:'active',locale:'en',timeZone:'UTC',eveningTime:'22:30',morningTime:'08:30',workdays:[1],quietHours:{start:'23:00',end:'07:00'},dataScopes:['tasks'],createdAt:1,updatedAt:1});
 store.selectAssistantAnalysisModel({modelId:'selected',expectedRevision:0});
 const binding={profileId:profile.id,sourceId:'synthetic-tasks',accountScopeHash:'a'.repeat(64),grantEpoch:profile.updatedAt,window:{from:1,to:2}};
 store.syncAssistantQualityContext({binding,scopes:['tasks'],analysisContract:port.contract.id,...identity});
 let contents='';const workflow=store.createAssistantQualityWorkflow({readCurrentModel:readAssistantModelIdentity,population:async()=>({binding,population:{complete:true,ids:Array.from({length:100},(_,i)=>`case-${i}`)},protocol:{analysisContract:port.contract.id,version:'synthetic-v1',riskRulesDigest:'b'.repeat(64),firstAnnotator:'synthetic-a',secondAnnotator:'synthetic-b'},facts:Array.from({length:100},(_,i)=>({id:`case-${i}`,title:'Synthetic fixture only',status:'open',updatedAt:1,severe:false}))}),predict:async frozen=>frozen.cases.map((row,i)=>({id:row.id,prediction:i<30?'needs_action':'wait'})),save:async text=>{contents=text;return true;},open:async()=>contents,confirmHumanReview:async()=>({userId:'synthetic-user',text:'Synthetic fixture, not real pilot evidence'})});
 const frozen=await workflow.freeze({requestSource:'user'});await workflow.recordPredictions({requestSource:'user',assessmentId:frozen.assessmentId,expectedDigest:frozen.digest});await workflow.export({requestSource:'user',assessmentId:frozen.assessmentId});
 const pkg=JSON.parse(contents);contents=JSON.stringify({version:1,type:'action_review',assessmentId:pkg.assessmentId,digest:pkg.digest,labels:pkg.frozen.cases.map((row:{id:string;prediction:string})=>({id:row.id,firstLabel:row.prediction,secondLabel:row.prediction}))});
 expect((await workflow.import({requestSource:'user'})).status.state).toBe('passed');
 const oldOwner=new DatabaseSync(file);owners.push(oldOwner);const oldAuth=readAssistantQualityAuthorization(oldOwner,()=>identity)!;expect(oldAuth).toBeTruthy();
 return {file,store,identity,oldOwner,oldAuth};
}
function settings(store:LoopStore,onInvalidated=vi.fn(),bootstrap=vi.fn(async()=>({modelId:'selected',identity:readAssistantModelIdentity(),port,readCurrentModel:readAssistantModelIdentity}))) {
 return {service:new AssistantAnalysisSettings({store,models:()=>[{modelId:'selected',label:'Selected'}],bootstrap,onInvalidated}),onInvalidated,bootstrap};
}
it('preserves the same persisted human assessment and generation across reopen/restore',async()=>{
 const seed=await assessed(),generation=readQualityGeneration(seed.oldOwner);seed.store.close();stores.splice(stores.indexOf(seed.store),1);
 const next=makeStore(seed.file),s=settings(next);expect((await s.service.restore()).state).toBe('ready');
 expect(readQualityGeneration(seed.oldOwner)).toBe(generation);expect(readCurrentAssistantQualityAssessment(seed.oldOwner,()=>seed.identity)?.assessmentId).toBe(seed.oldAuth.assessmentId);expect(s.onInvalidated).not.toHaveBeenCalled();expect(readAssistantQualityQualification(seed.oldAuth.qualityQualification,seed.oldAuth.currentBinding)).toBeTruthy();
});
it('revokes the prior generation before async bootstrap when only the environment key changes after restart',async()=>{
 const seed=await assessed(),generation=readQualityGeneration(seed.oldOwner);seed.store.close();stores.splice(stores.indexOf(seed.store),1);vi.stubEnv('XIAOK_DEEPSEEK_API_KEY','synthetic-env-key-b');
 const next=makeStore(seed.file);let finish!:(value:never)=>void;const bootstrap=vi.fn(()=>new Promise<never>(resolve=>{finish=resolve;}));const s=settings(next,vi.fn(),bootstrap as never);
 const restoring=s.service.restore();
 expect(readCurrentAssistantQualityAssessment(seed.oldOwner,()=>seed.identity)).toBeUndefined();expect(readQualityGeneration(seed.oldOwner)).toBe(generation+1);expect(s.onInvalidated).toHaveBeenCalledOnce();
 finish({modelId:'selected',identity:readAssistantModelIdentity(),port,readCurrentModel:readAssistantModelIdentity} as never);await restoring;
 expect(readAssistantQualityQualification(seed.oldAuth.qualityQualification,seed.oldAuth.currentBinding)).toBeUndefined();
 vi.stubEnv('XIAOK_DEEPSEEK_API_KEY','synthetic-env-key-a');expect(readCurrentAssistantQualityAssessment(seed.oldOwner,()=>seed.identity)).toBeUndefined();
});
it('current drift durably revokes even an OS owner retaining the old environment and never auto-resurrects',async()=>{
 const seed=await assessed(),s=settings(seed.store);await s.service.restore();expect(s.service.current()).toBeTruthy();
 vi.stubEnv('XIAOK_DEEPSEEK_API_KEY','synthetic-env-key-b');expect(s.service.current()).toBeUndefined();expect(s.onInvalidated).toHaveBeenCalledOnce();expect(readCurrentAssistantQualityAssessment(seed.oldOwner,()=>seed.identity)).toBeUndefined();
 vi.stubEnv('XIAOK_DEEPSEEK_API_KEY','synthetic-env-key-a');expect(s.service.current()).toBeUndefined();expect(s.onInvalidated).toHaveBeenCalledOnce();
});
it('reconciles before a failed restore and clears old authority even when resources are unavailable',async()=>{
 const seed=await assessed();vi.stubEnv('XIAOK_DEEPSEEK_API_KEY','synthetic-env-key-b');const s=settings(seed.store,vi.fn(),vi.fn(async()=>{throw Error('resource fixture');}) as never);
 expect((await s.service.restore()).state).toBe('unavailable');expect(readCurrentAssistantQualityAssessment(seed.oldOwner,()=>seed.identity)).toBeUndefined();expect(s.onInvalidated).toHaveBeenCalledOnce();
});
it('invalidates context plus generation atomically and does not mutate matching identities',async()=>{
 const seed=await assessed(),db=(seed.store as unknown as {db:DatabaseSync}).db,generation=readQualityGeneration(db);
 expect(seed.store.invalidateAssistantQualityModelIdentity(seed.identity)).toBe(false);expect(readQualityGeneration(db)).toBe(generation);
 db.exec("CREATE TRIGGER fail_identity_revoke BEFORE UPDATE ON assistant_quality_state BEGIN SELECT RAISE(ABORT,'synthetic-revoke-fault'); END");
 expect(()=>seed.store.invalidateAssistantQualityModelIdentity({...seed.identity,configFingerprint:'d'.repeat(64)})).toThrow('synthetic-revoke-fault');expect(readQualityGeneration(db)).toBe(generation);expect(readCurrentAssistantQualityAssessment(seed.oldOwner,()=>seed.identity)).toBeTruthy();
 db.exec('DROP TRIGGER fail_identity_revoke');expect(seed.store.invalidateAssistantQualityModelIdentity({...seed.identity,configFingerprint:'d'.repeat(64)})).toBe(true);expect(readCurrentAssistantQualityAssessment(seed.oldOwner,()=>seed.identity)).toBeUndefined();expect(readQualityGeneration(db)).toBe(generation+1);
 expect(seed.store.invalidateAssistantQualityModelIdentity(null)).toBe(false);expect(readQualityGeneration(db)).toBe(generation+1);
});

it('same-clock and rollback pause/resume cannot restore an old quality grant epoch',async()=>{
 const seed=await assessed(),id='default-personal-assistant';const initial=seed.store.getAssistantProfile(id)!.updatedAt;
 seed.store.setAssistantProfileStatus(id,'paused',initial);seed.store.setAssistantProfileStatus(id,'active',initial);
 const resumed=seed.store.getAssistantProfile(id)!;expect(resumed.updatedAt).toBeGreaterThan(initial);expect(readCurrentAssistantQualityAssessment(seed.oldOwner,()=>seed.identity)).toBeUndefined();
 seed.store.setAssistantProfileStatus(id,'paused',initial-1000);seed.store.setAssistantProfileStatus(id,'active',initial-1000);
 expect(seed.store.getAssistantProfile(id)!.updatedAt).toBeGreaterThan(resumed.updatedAt);expect(readAssistantQualityQualification(seed.oldAuth.qualityQualification,seed.oldAuth.currentBinding)).toBeUndefined();
});

it('composes Settings + QualityProduct with a pure model reader and durably revokes outside the assessment savepoint',async()=>{
 const seed=await assessed(),s=settings(seed.store);await s.service.restore();const provider=vi.fn(()=>s.service.current());
 const product=createAssistantQualityProduct({store:seed.store,dataRoot:'/synthetic-composition',provider,collect:async()=>{throw Error('no new population in this test');},files:{save:async()=>true,open:async()=>null},confirmHumanReview:async()=>false,onCommitted:()=>{}});
 const qualified=product.quality();expect(qualified).toBeDefined();expect(provider).not.toHaveBeenCalled();expect(readAssistantQualityQualification(qualified!.token,qualified!.currentBinding())).toBeTruthy();
 vi.stubEnv('XIAOK_DEEPSEEK_API_KEY','synthetic-env-key-b');expect(product.quality()).toBeUndefined();expect(provider).not.toHaveBeenCalled();
 // Reconciliation is an outer operation, never hidden inside pure assessment reads.
 expect(s.service.current()).toBeUndefined();expect(readCurrentAssistantQualityAssessment(seed.oldOwner,()=>seed.identity)).toBeUndefined();
 expect(readAssistantQualityQualification(qualified!.token,qualified!.currentBinding())).toBeUndefined();
 vi.stubEnv('XIAOK_DEEPSEEK_API_KEY','synthetic-env-key-a');expect(product.quality()).toBeUndefined();
});
it('takes the matching-identity read-only fast path even inside an existing SQLite savepoint',async()=>{
 const seed=await assessed(),db=(seed.store as unknown as {db:DatabaseSync}).db;
 db.exec('SAVEPOINT synthetic_outer_assessment');try{expect(seed.store.invalidateAssistantQualityModelIdentity(seed.identity)).toBe(false);}finally{db.exec('RELEASE synthetic_outer_assessment');}
 expect(readCurrentAssistantQualityAssessment(seed.oldOwner,()=>seed.identity)).toBeTruthy();
});
it('persists revocation when the provider reader drifts even if the outer fixed reader still matches',async()=>{
 const seed=await assessed();let providerIdentity=seed.identity;
 const s=settings(seed.store,vi.fn(),vi.fn(async()=>({modelId:'selected',identity:seed.identity,port,readCurrentModel:()=>providerIdentity})));
 await s.service.restore();expect(s.service.current()).toBeTruthy();providerIdentity={...seed.identity,configFingerprint:'d'.repeat(64)};
 expect(s.service.current()).toBeUndefined();expect(readCurrentAssistantQualityAssessment(seed.oldOwner,()=>seed.identity)).toBeUndefined();expect(s.onInvalidated).toHaveBeenCalledOnce();
});
