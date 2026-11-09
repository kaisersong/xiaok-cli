import {createHash} from 'node:crypto';import {z} from 'zod';
const id=z.string().min(1).max(256),hash=z.string().regex(/^[a-f0-9]{64}$/),label=z.enum(['needs_action','wait','unknown']);
export const bindingSchema=z.object({profileId:z.literal('default-personal-assistant'),sourceId:id,accountScopeHash:hash,grantEpoch:z.number().int().positive(),window:z.object({from:z.number().int(),to:z.number().int()}).strict()}).strict();
export const dataSchema=z.object({binding:bindingSchema,population:z.object({complete:z.boolean(),ids:z.array(id).max(10000)}).strict(),protocol:z.object({analysisContract:id,version:id,riskRulesDigest:hash,firstAnnotator:id,secondAnnotator:id,samplingSeed:id.optional(),sampleSize:z.number().int().min(100).max(10000).optional()}).strict(),cases:z.array(z.object({id,firstLabel:label,secondLabel:label,userAdjudication:label.optional(),prediction:label,severe:z.boolean()}).strict()).max(10000)}).strict();
export type AssistantQualityDataset=z.infer<typeof dataSchema>;
export type AssistantQualityBinding=z.infer<typeof bindingSchema>;
const qualifications=new WeakMap<object,{reportDigest:string;binding:AssistantQualityBinding;analysisContract:string;isCurrent?:()=>boolean}>();
function proportion(numerator:number,denominator:number){
 if(!denominator)return {numerator,denominator,value:0,lower:0,upper:1};
 const value=numerator/denominator,z=1.959963984540054,zz=z*z,adjustment=1+zz/denominator,center=(value+zz/(2*denominator))/adjustment,half=z*Math.sqrt(value*(1-value)/denominator+zz/(4*denominator**2))/adjustment;
 return {numerator,denominator,value,lower:Math.max(0,center-half),upper:Math.min(1,center+half)};
}
/** Algorithm only. The main caller owns provenance of population and human labels. */
export function evaluateAssistantQuality(raw:unknown){
 const input=dataSchema.parse(raw),population=[...new Set(input.population.ids)],sampleSize=Math.min(population.length,input.protocol.sampleSize??100);
 const sample=new Set(sampleAssistantQuality(input));
 let tp=0,fp=0,fn=0,needsAction=0,unknownLabels=0,seriousMisses=0,wait=0,unknownPredictions=0;const seen=new Set<string>();
 let populationValid=input.population.complete&&population.length===input.population.ids.length&&sampleSize>=100&&input.cases.length===sampleSize&&input.protocol.firstAnnotator!==input.protocol.secondAnnotator&&input.binding.window.to>input.binding.window.from;
 for(const row of input.cases){
  if(seen.has(row.id)||!sample.has(row.id))populationValid=false;seen.add(row.id);
  const expected=row.userAdjudication??(row.firstLabel===row.secondLabel?row.firstLabel:'unknown');
  if(row.prediction==='unknown')unknownPredictions++;
  if(expected==='unknown'){unknownLabels++;if(row.prediction==='needs_action')fp++;continue;}
  if(expected==='needs_action'){needsAction++;if(row.prediction==='needs_action')tp++;else{fn++;if(row.severe)seriousMisses++;}}
  else{wait++;if(row.prediction==='needs_action')fp++;}
 }
 const precision=proportion(tp,tp+fp),recall=proportion(tp,tp+fn),unknown=proportion(unknownLabels,input.cases.length);
 const passed=populationValid&&input.cases.length>=100&&needsAction>=30&&unknown.value<=.1&&precision.value>=.9&&recall.value>=.95&&seriousMisses===0;
 return {passed,total:input.cases.length,populationCount:population.length,sampleSize,populationValid,needsAction,wait,tp,fp,fn,seriousMisses,unknownLabels,unknownPredictions,precision,recall,unknown};
}
/** Main-private issuer; not a renderer/model API, and never a claim of real data. */
export function issueAssistantQualityQualification(raw:unknown,isCurrent?:()=>boolean):object{
 const input=dataSchema.parse(raw),report=evaluateAssistantQuality(input);if(!report.passed)throw Error('assistant_quality_unverified');
 const token=Object.freeze(Object.create(null)),reportDigest=createHash('sha256').update(JSON.stringify({input,report})).digest('hex');qualifications.set(token,{reportDigest,binding:input.binding,analysisContract:input.protocol.analysisContract,isCurrent});return token;
}
export function readAssistantQualityQualification(token:unknown,currentBinding:AssistantQualityBinding):Readonly<{reportDigest:string;binding:AssistantQualityBinding;analysisContract:string}>|undefined{
 if(!token||typeof token!=='object')return undefined;const entry=qualifications.get(token);if(!entry)return undefined;
 try{if(entry.isCurrent&&!entry.isCurrent())return undefined;if(JSON.stringify(entry.binding)!==JSON.stringify(bindingSchema.parse(currentBinding)))return undefined;return Object.freeze({reportDigest:entry.reportDigest,binding:structuredClone(entry.binding),analysisContract:entry.analysisContract});}catch{return undefined;}
}

/** Shared deterministic sampling; preserves the existing scoring population semantics. */
export function sampleAssistantQuality(input: Pick<AssistantQualityDataset,'population'|'protocol'>):string[]{
 const population=[...new Set(input.population.ids)],size=Math.min(population.length,input.protocol.sampleSize??100),seed=input.protocol.samplingSeed??input.protocol.version;
 return population.map(id=>({id,order:createHash('sha256').update(JSON.stringify([seed,id])).digest('hex')})).sort((a,b)=>a.order.localeCompare(b.order)).slice(0,size).map(row=>row.id);
}
