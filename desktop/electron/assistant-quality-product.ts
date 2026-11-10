import {createHash} from 'node:crypto';
import type {AssistantAnalysisPort} from '../../src/runtime/assistant/analysis-port.js';
import type {QualityModelReader} from '../../src/runtime/assistant/quality-authorization.js';
import {readAssistantModelIdentity} from '../../src/runtime/assistant/model-identity.js';
import type {AssistantQualityPorts,AssistantQualityPopulation} from './assistant-quality-workflow.js';
import type {AssistantQualityStatus} from '../shared/assistant-quality-contract.js';
import type {AssistantDesktopSnapshot} from './assistant-desktop-snapshot.js';
import type {AssistantProfile} from './assistant-types.js';
import type {LoopStore} from './loop-store.js';
import {buildAssistantQualityPopulation} from './assistant-quality-population.js';
import {createAssistantQualityPredictor} from './assistant-quality-predictions.js';
const user=(input:{requestSource:'user'})=>{if(input?.requestSource!=='user')throw Error('assistant_quality_user_only');};
/** Composition only: state remains in the existing LoopStore and its workflow. */
export function createAssistantQualityProduct(options:{store:LoopStore;dataRoot:string;provider:()=>{port:AssistantAnalysisPort;readCurrentModel:QualityModelReader}|undefined;collect:(profile:AssistantProfile)=>Promise<AssistantDesktopSnapshot>;files:Pick<AssistantQualityPorts,'save'|'open'>;confirmHumanReview:AssistantQualityPorts['confirmHumanReview'];onCommitted:()=>void;knownSecrets?:()=>readonly string[];readCurrentModel?:QualityModelReader}){
 let population:AssistantQualityPopulation|undefined;let exporting=false;
 const currentProvider=()=>{const provider=options.provider();if(!provider)throw Error('assistant_quality_provider_unavailable');return provider;};
 const workflow=options.store.createAssistantQualityWorkflow({
  // Pure assessment opens a SQLite savepoint: never call the reconciling provider getter here.
  readCurrentModel:options.readCurrentModel??readAssistantModelIdentity,
  population:async()=>{if(!population)throw Error('assistant_quality_population_missing');return population;},
  save:options.files.save,open:options.files.open,confirmHumanReview:options.confirmHumanReview,
  predict:async(frozen,digest)=>{
   const provider=currentProvider(),profile=JSON.stringify(options.store.getAssistantProfile('default-personal-assistant')),model=JSON.stringify(provider.readCurrentModel());
   return createAssistantQualityPredictor({store:options.store,port:provider.port,isCurrent:()=>JSON.stringify(options.store.getAssistantProfile('default-personal-assistant'))===profile&&options.provider()?.port.contract.id===provider.port.contract.id&&JSON.stringify(provider.readCurrentModel())===model})(frozen,digest);
  },
 });
 let unavailable:AssistantQualityStatus['reason']=null;
 const status=():AssistantQualityStatus=>{
  const actual=workflow.status({requestSource:'user'});
  if(!options.provider())return {...actual,state:'unavailable',reason:'provider_unavailable'};
  if(unavailable)return {...actual,state:'unavailable',reason:unavailable};return actual;
 };
 return {
  status,
  quality(){const ready=workflow.readiness({requestSource:'scheduler'});if(!ready.qualityQualification||!ready.currentBinding)return undefined;return {token:ready.qualityQualification,currentBinding:()=>ready.currentBinding!};},
  async exportReview(input:{requestSource:'user'}){
   user(input);if(exporting)throw Error('assistant_quality_export_busy');exporting=true;try{unavailable=null;const provider=currentProvider();let review:ReturnType<typeof workflow.currentReview>;
   try{review=workflow.currentReview(input);}catch(error){if(!(error instanceof Error)||!['assistant_quality_binding_changed','assistant_quality_model_changed','assistant_quality_context_missing','assistant_quality_profile','assistant_quality_scopes_changed'].includes(error.message))throw error;review=undefined;}
   if(review?.phase==='assessed'){
    const report=workflow.report(input),frozenReport=JSON.stringify(report);
    const saved=await options.files.save(JSON.stringify({version:1,type:'assessment_report',report},null,2),()=>{if(JSON.stringify(workflow.report(input))!==frozenReport)throw Error('assistant_quality_binding_changed');});
    return {cancelled:!saved,status:status()};
   }
   if(!review||workflow.status(input).sampleCount<100){
    const profile=options.store.getAssistantProfile('default-personal-assistant');if(!profile||profile.status!=='active')throw Error('assistant_quality_profile_inactive');
    const identity=provider.readCurrentModel(),snapshot=await options.collect(profile);
    if(JSON.stringify(profile)!==JSON.stringify(options.store.getAssistantProfile(profile.id))||JSON.stringify(identity)!==JSON.stringify(provider.readCurrentModel()))throw Error('assistant_quality_binding_changed');
    const binding={profileId:profile.id,sourceId:'internal_snapshot_v1',accountScopeHash:createHash('sha256').update(JSON.stringify([options.dataRoot,profile.id,[...profile.dataScopes].sort()])).digest('hex'),grantEpoch:profile.updatedAt,window:{from:snapshot.from,to:snapshot.to}};
    population=buildAssistantQualityPopulation({binding,analysisContract:provider.port.contract.id,snapshot,knownSecrets:options.knownSecrets?.()});
    if(!population.population.complete){unavailable='source_unavailable';return {cancelled:false,status:status()};}
    options.store.syncAssistantQualityContext({binding,scopes:profile.dataScopes,analysisContract:provider.port.contract.id,...identity});
    await workflow.freeze(input);review=workflow.currentReview(input);
   }
   if(!review)throw Error('assistant_quality_review_missing');
   if(workflow.status(input).sampleCount<100&&review.riskCoverageComplete)return {cancelled:false,status:{...workflow.status(input),state:'unavailable' as const,reason:'insufficient_cases' as const}};
   if(review.phase==='frozen'&&review.riskCoverageComplete){
    await workflow.recordPredictions({...input,assessmentId:review.assessmentId,expectedDigest:review.digest});
   }
   return await workflow.export({...input,assessmentId:review.assessmentId});
   }finally{exporting=false;}
  },
  async importReview(input:{attestHumanReview:true;requestSource:'user'}){user(input);if(input.attestHumanReview!==true)throw Error('assistant_quality_human_confirmation_required');unavailable=null;const result=await workflow.import({requestSource:'user'});options.onCommitted();return result;},
  revoke(input:{requestSource:'user'}){user(input);unavailable=null;const result=workflow.revoke(input);options.onCommitted();return result;},
 };
}
