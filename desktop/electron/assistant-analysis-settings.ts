import type {DatabaseSync} from 'node:sqlite';
import type {AssistantAnalysisPort} from '../../src/runtime/assistant/analysis-port.js';
import type {QualityModelReader} from '../../src/runtime/assistant/quality-authorization.js';
import {readAssistantModelIdentity} from '../../src/runtime/assistant/model-identity.js';
import {ASSISTANT_ANALYSIS_STATUS_SCHEMA,ASSISTANT_ANALYSIS_SETTINGS_SCHEMA,type AssistantAnalysisStatus} from '../shared/assistant-analysis-settings-contract.js';
import type {LoopStore} from './loop-store.js';
export function migrateAssistantAnalysisSelection(db:DatabaseSync){db.exec('CREATE TABLE IF NOT EXISTS assistant_analysis_selection(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL,model_id TEXT NOT NULL)');}
export function readAssistantAnalysisSelection(db:DatabaseSync):{revision:number;modelId:string|null}{const row=db.prepare('SELECT revision,model_id FROM assistant_analysis_selection WHERE singleton=1').get();return row?{revision:Number(row.revision),modelId:String(row.model_id)}:{revision:0,modelId:null};}
export function selectAssistantAnalysisModel(db:DatabaseSync,input:{modelId:string;expectedRevision:number}){
 const parsed=ASSISTANT_ANALYSIS_SETTINGS_SCHEMA.parse(input),old=readAssistantAnalysisSelection(db);if(old.revision!==parsed.expectedRevision)throw Error('assistant_analysis_selection_conflict');
 db.prepare('INSERT INTO assistant_analysis_selection(singleton,revision,model_id) VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,model_id=excluded.model_id').run(old.revision+1,parsed.modelId);return readAssistantAnalysisSelection(db);
}
type Identity=ReturnType<QualityModelReader>;
type Provider={modelId:string;identity:Identity;port:AssistantAnalysisPort;readCurrentModel:QualityModelReader};
const sameIdentity=(a:Identity|null,b:Identity)=>!!a&&a.modelEpoch===b.modelEpoch&&a.configFingerprint===b.configFingerprint;
/** Explicit per-feature choice; identity reconciliation never rewrites the global config. */
export class AssistantAnalysisSettings{
 private provider?:Provider;private providerRevision?:number;private preparing=false;private reason:AssistantAnalysisStatus['reason']=null;
 constructor(private readonly options:{store:LoopStore;models:()=>AssistantAnalysisStatus['models'];bootstrap:(modelId:string,prepareResources:boolean)=>Promise<Provider>;onInvalidated:()=>void;readCurrentModel?:QualityModelReader}){}
 private actualIdentity():Identity|null{
  try{const identity=(this.options.readCurrentModel??readAssistantModelIdentity)();return Number.isSafeInteger(identity.modelEpoch)&&identity.modelEpoch>0&&/^[a-f0-9]{64}$/.test(identity.configFingerprint)?identity:null;}catch{return null;}
 }
 private clearProvider(){this.provider=undefined;this.providerRevision=undefined;this.reason='config_changed';}
 current(){
  const actual=this.actualIdentity();let drift=false,unreadableProvider=false;
  if(this.provider){
   try{const selection=this.options.store.getAssistantAnalysisSelection();unreadableProvider=!sameIdentity(this.provider.readCurrentModel(),this.provider.identity);drift=selection.modelId!==this.provider.modelId||selection.revision!==this.providerRevision||!sameIdentity(actual,this.provider.identity)||unreadableProvider;}
   catch{drift=true;unreadableProvider=true;}
  }
  if(drift)this.clearProvider();
  let invalidated:boolean;
  try{invalidated=this.options.store.invalidateAssistantQualityModelIdentity(unreadableProvider?null:actual);}
  catch{this.clearProvider();this.options.onInvalidated();throw Error('assistant_analysis_identity_invalidation_failed');}
  if(drift||invalidated){if(invalidated)this.reason='config_changed';this.options.onInvalidated();}
  return this.provider;
 }
 status():AssistantAnalysisStatus{const selected=this.options.store.getAssistantAnalysisSelection();let models:AssistantAnalysisStatus['models']=[];try{models=this.options.models().slice(0,50);}catch{}
  const ready=!!this.current();return ASSISTANT_ANALYSIS_STATUS_SCHEMA.parse({revision:selected.revision,selectedModelId:selected.modelId,models,state:this.preparing?'preparing':ready?'ready':selected.modelId?'unavailable':'not_configured',reason:this.preparing||ready?null:this.reason??(selected.modelId?'resources_unavailable':null)});
 }
 async restore(){if(this.preparing)return this.status();this.current();const selected=this.options.store.getAssistantAnalysisSelection();if(!selected.modelId)return this.status();return this.prepare(selected.modelId,false);}
 async configure(input:{modelId:string;expectedRevision:number;requestSource:'user'|'agent'|'scheduler'}){
  if(input?.requestSource!=='user')throw Error('assistant_analysis_user_only');const {modelId,expectedRevision}=input;ASSISTANT_ANALYSIS_SETTINGS_SCHEMA.parse({modelId,expectedRevision});
  if(this.preparing)throw Error('assistant_analysis_preparing');if(!this.options.models().some(row=>row.modelId===modelId))throw Error('assistant_analysis_model_unavailable');
  this.options.store.selectAssistantAnalysisModel({modelId,expectedRevision});this.clearProvider();this.options.onInvalidated();return this.prepare(modelId,true);
 }
 private async prepare(modelId:string,prepareResources:boolean){
  this.preparing=true;const revision=this.options.store.getAssistantAnalysisSelection().revision;
  try{
   const provider=await this.options.bootstrap(modelId,prepareResources),selection=this.options.store.getAssistantAnalysisSelection();
   if(provider.modelId!==modelId||selection.modelId!==modelId||selection.revision!==revision||!sameIdentity(this.actualIdentity(),provider.identity)||!sameIdentity(provider.readCurrentModel(),provider.identity))this.clearProvider();
   else{this.provider=provider;this.providerRevision=revision;this.reason=null;}
  }catch{this.clearProvider();this.reason='resources_unavailable';}
  finally{this.preparing=false;}
  return this.status();
 }
}
