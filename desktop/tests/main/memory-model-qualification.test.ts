// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {DEFAULT_CONFIG,type Config} from '../../../src/types.js';
import {getProviderProfile,listProviderProfiles,resolveProviderModelVariant} from '../../../src/ai/providers/registry.js';
async function module(){return import('../../../src/ai/memory/configuration.js');}
function config():Config{return {...structuredClone(DEFAULT_CONFIG),defaultModelId:'text',providers:{fixture:{type:'custom',protocol:'openai_legacy'}},models:{text:{provider:'fixture',model:'synthetic-text',label:'Text',capabilities:['text_generation']}}};}
describe('actual pure memory configuration migration and qualification',()=>{
 it('does not turn a legacy embedding selection into cloud compaction, including second normalization',async()=>{
  const c=config();c.memory={modelId:'bge-small-zh-v1.5'};const before=structuredClone(c),m=await module();
  const first=m.normalizeMemoryConfiguration(c);
  expect(first).toMatchObject({embedding:{model:'bge-small-zh-v1.5'},legacyModelId:'bge-small-zh-v1.5',legacyModelUnresolved:true,compaction:{modelId:null}});
  expect(m.normalizeMemoryConfiguration({...c,memory:first})).toEqual(first);expect(c).toEqual(before);
  expect(m.memorySettingsSnapshot({...c,memory:first})).toMatchObject({warning:'legacy_model_unresolved',resolvedCompactionModelId:null});
 });
 it('preserves unknown legacy IDs rather than silently selecting default',async()=>{
  const c=config();c.memory={modelId:'unknown-old'};const m=await module(),first=m.normalizeMemoryConfiguration(c);
  expect(first).toMatchObject({legacyModelId:'unknown-old',legacyModelUnresolved:true});
  expect(m.normalizeMemoryConfiguration({...c,memory:first})).toEqual(first);
 });
 it('moves a known text legacy ID without changing explicit embedding or other config',async()=>{
  const c=config();c.memory={modelId:'text',embedding:{model:'bge-small-zh-v1.5'}};const m=await module();
  expect(m.normalizeMemoryConfiguration(c)).toMatchObject({embedding:{model:'bge-small-zh-v1.5'},compaction:{modelId:'text'}});expect(c.memory.modelId).toBe('text');
 });
 it('honors an explicit main or explicit invalid selection and never overwrites either',async()=>{
  const c=config(),m=await module();
  c.memory={modelId:'unknown-old',compaction:{modelId:null}} as Config['memory'];
  expect(m.normalizeMemoryConfiguration(c)).toMatchObject({legacyModelId:'unknown-old',legacyModelUnresolved:false,compaction:{modelId:null}});
  c.memory={modelId:'text',compaction:{modelId:'unknown-explicit'}} as Config['memory'];
  expect(m.memorySettingsSnapshot(c)).toMatchObject({compactionModelId:'unknown-explicit',resolvedCompactionModelId:null,warning:'invalid_model'});
 });
 it('explicit null means follow eligible main, not disable compaction',async()=>{
  const c=config(),m=await module();c.memory={compaction:{modelId:null}} as Config['memory'];
  expect(m.memorySettingsSnapshot(c)).toMatchObject({compactionModelId:null,resolvedCompactionModelId:'text',warning:null});
 });
 it('does not clear unresolved when a migrated null or text claim is reloaded',async()=>{
  const c=config(),m=await module();c.memory={legacyModelId:'old',legacyModelUnresolved:true,settingsVersion:1,compaction:{modelId:null}} as Config['memory'];
  expect(m.normalizeMemoryConfiguration(c)).toEqual(c.memory);expect(m.memorySettingsSnapshot(c).resolvedCompactionModelId).toBeNull();
 });
 it.each(['embedding','reranker','classification','decision','ASR','text_to_speech'])('negative %s beats explicit text output',async capability=>{
  const c=config(),m=await module();Object.assign(c.models.text,{capabilities:['text_generation',capability],outputModalities:['text']});
  expect(m.compactionModelQualification(c,'text')).toMatchObject({eligible:false,reason:'non_text_model',quality:'not_evaluated'});
 });
 it('requires positive text generation evidence, and respects explicit negative output and purpose',async()=>{
  const c=config(),m=await module();c.models.text.capabilities=['tools','image_in'];expect(m.isCompactionModel(c,'text')).toBe(false);
  Object.assign(c.models.text,{outputModalities:['text']});expect(m.isCompactionModel(c,'text')).toBe(true);
  Object.assign(c.models.text,{outputModalities:['image'],capabilities:['text_generation']});expect(m.isCompactionModel(c,'text')).toBe(false);
  Object.assign(c.models.text,{outputModalities:['text'],purpose:'decision'});expect(m.isCompactionModel(c,'text')).toBe(false);
 });
 it.each([{outputModalities:'text'},{outputModalities:null},{outputModalities:['text'],purpose:''}])('rejects malformed new explicit metadata %j rather than classifying it as text',async fields=>{
  const c=config(),m=await module();Object.assign(c.models.text,fields);expect(m.isCompactionModel(c,'text')).toBe(false);
 });
 it('uses exact firstparty wire evidence and keeps unknown context/quality honest',async()=>{
  const c=config(),m=await module();c.providers={deepseek:{type:'first_party',protocol:'openai_legacy'}};c.models.text={provider:'deepseek',model:'deepseek-v4-pro',label:'Custom alias'};
  expect(m.compactionModelQualification(c,'text')).toMatchObject({eligible:true,source:'provider_catalog',quality:'not_evaluated',contextLimit:1000000});
  c.models.text.model='unknown-wire';expect(m.isCompactionModel(c,'text')).toBe(false);
  c.models.text.model='deepseek-v4-pro';c.providers.deepseek.type='custom';expect(m.isCompactionModel(c,'text')).toBe(false);
 });
 it('annotates every maintained generation variant without changing same-wire identity',()=>{
  for(const profile of listProviderProfiles())for(const variant of [profile.defaultModel,...profile.availableModels??[]]){
   expect(variant).toMatchObject({outputModalities:['text'],purpose:'generation'});
   expect(resolveProviderModelVariant(profile,variant.model)).toMatchObject({model:variant.model,outputModalities:['text'],purpose:'generation'});
  }
 });
 it('detects same-wire output or purpose metadata ambiguity',()=>{
  for(const change of [{outputModalities:['image']},{purpose:'decision'}]){
   const profile=structuredClone(getProviderProfile('openai')!);profile.availableModels=[{...profile.defaultModel,modelId:'alias',...change}] as typeof profile.availableModels;
   let caught:unknown;try{resolveProviderModelVariant(profile,profile.defaultModel.model);}catch(raw){caught=raw;}
   expect(caught).toMatchObject({code:'MODEL_VARIANT_AMBIGUOUS'});expect(caught).toBeInstanceOf(Error);
  }
 });
});
