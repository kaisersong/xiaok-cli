import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {join} from 'node:path';
import {tasks,plan,summarize} from './baseline-core.mjs';
export const contractAssets=['baseline-core.mjs','baseline-sandbox.mjs','baseline-sandbox.cjs'];
export const hashMap=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function formalPairedConfig(config){
 const copy=structuredClone(config),id=copy?.defaultModelId;
 if(typeof id!=='string'||!copy.models?.[id]||typeof copy.models[id].model!=='string')throw Error('paired-default-model-unavailable');
 copy.models[id].model='deepseek-flash';return copy;
}
export function createPairedPlan(){
 const cells=[...new Set(plan.map(e=>`${e.surface}/${e.taskId}`))].sort();
 return plan.flatMap((entry,pairIndex)=>{
  const first=(cells.indexOf(`${entry.surface}/${entry.taskId}`)+(entry.repeat-1))%2===0?'legacy':'candidate';
  return [first,first==='legacy'?'candidate':'legacy'].map((arm,position)=>({...entry,caseKey:entry.key,key:`${arm}--${entry.key}`,relativeDirectory:join(arm,entry.key),arm,pairIndex,position,mechanismAvailability:arm==='legacy'?'baseline':['cli','desktop'].includes(entry.surface)?'eligible':'not-ready'}));
 });
}
export function summarizePaired(records,comparison){
 const schedule=createPairedPlan(),known=new Map(schedule.map(e=>[e.key,e])),byKey=new Map();
 for(const record of records){if(!known.has(record.key))throw Error('unknown-record');if(byKey.has(record.key))throw Error('duplicate-record');byKey.set(record.key,record);}
 const result={scope:'engineering-discovery-only',admission:'inconclusive',comparisonValid:comparison?.comparisonValid??null,comparisonLimitation:comparison?.limitation??null};
 for(const arm of ['legacy','candidate']){
  const complete=schedule.filter(e=>e.arm===arm).map(e=>{const record=byKey.get(e.key);return {...record,...e,key:e.caseKey,pairedRunKey:e.key,passed:record?.passed===true,status:record?.status??'not-run'};});
  result[arm]={...summarize(complete),records:complete,wiringQualified:arm==='candidate'?complete.filter(e=>e.mechanismAvailability==='eligible'&&e.mechanism?.qualified===true).length:0,projectionActivated:arm==='candidate'?complete.filter(e=>e.mechanismAvailability==='eligible'&&e.mechanism?.qualified===true&&e.mechanism?.projection?.projectedRequests>0).length:0,recallActivated:arm==='candidate'?complete.filter(e=>e.mechanismAvailability==='eligible'&&e.mechanism?.qualified===true&&e.mechanism?.recallCompleted>0).length:0};
 }
 return result;
}
export function assertSameModel(...models){
 const identity=model=>({name:model?.name,harness:model?.harness??null});
 if(!models.length||models.some(model=>typeof model?.name!=='string'||!model.name))throw Error('model-identity-unavailable');
 if(models.some(model=>!isDeepStrictEqual(identity(model),identity(models[0]))))throw Error('model-mismatch');
}
export function assertFrozenContract(legacy,current){
 for(const key of contractAssets)if(typeof legacy[key]!=='string'||legacy[key]!==current[key])throw Error('frozen-task-scoring-contract-mismatch');
}
export function verifyPairedManifest(manifest,files){
 return manifest?.schemaVersion===9&&isDeepStrictEqual(manifest.schedule,createPairedPlan())
  &&manifest.taskSpecHash===hashMap(tasks)&&manifest.harnessHash===hashMap(files.harness)
  &&['legacy','candidate'].every(arm=>manifest.sourceHashes?.[arm]===hashMap(files[arm]));
}

export function validatePairedResult(entry,raw,exitStatus){
 const result=JSON.parse(raw);
 if(Object.keys(entry).some(key=>result[key]!==entry[key])||typeof result.passed!=='boolean')throw Error('result-identity');
 if(exitStatus!=='completed'){result.passed=false;result.status=exitStatus;result.reasons=[...(result.reasons??[]),'process-not-clean'];}
 return {...result,resultSha256:createHash('sha256').update(raw).digest('hex')};
}
export function assessSleepEnvironment(assertions,log,start,end){
 const assertionPresent=/(?:^|\n)\s*PreventSystemSleep\s+1\b/.test(assertions);
 const sleepEvents=log.split('\n').filter(line=>{const date=line.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}/)?.[0];const time=date?Date.parse(date):NaN;return Number.isFinite(time)&&time>=start&&time<=end&&/\bSleep\s+Entering Sleep\b/.test(line);});
 return {valid:assertionPresent&&sleepEvents.length===0,assertionPresent,sleepEvents};
}
