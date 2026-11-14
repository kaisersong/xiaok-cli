import {z} from 'zod/v3';
import {KIM_CATEGORIES,KIM_SENTIMENTS,KIM_SCORES_SCHEMA} from '../../shared/kim-decision.js';
const probability=z.number().finite().min(0).max(1);
const ordinalDist=z.object({'1':probability,'2':probability,'3':probability,'4':probability,'5':probability}).strict();
const category=z.object({...Object.fromEntries(KIM_CATEGORIES.map(k=>[k,probability])),unknown:probability}).strict();
/** Versioned transport adapter. The application's validated seven-head DTO stays stable. */
export const KIM_WIRE_SCORES_SCHEMA=z.union([KIM_SCORES_SCHEMA,z.object({
 category,category_top:z.enum(KIM_CATEGORIES),category_top_all:z.enum([...KIM_CATEGORIES,'unknown']),unknown_prob:probability,
 sentiment:z.object(Object.fromEntries(KIM_SENTIMENTS.map(k=>[k,probability]))).strict(),sentiment_top:z.enum(KIM_SENTIMENTS),
 importance:z.number().finite(),importance_dist:ordinalDist,urgency:z.number().finite(),urgency_dist:ordinalDist,
 sentiment_intensity:z.number().finite(),sentiment_intensity_dist:ordinalDist,needs_attention:probability,has_todo:probability,
 sig_used:z.object({t_at_user:z.boolean(),t_reply_user:z.boolean(),t_from_user:z.boolean(),ctx_user_spoke:z.boolean(),ctx_at_user_any:z.boolean(),sender_freq_bucket:z.number().int().min(0),group_user_share_bucket:probability}).strict(),
}).strict().superRefine((v,ctx)=>{
 const values=Object.values(v.category) as number[];
 if(Math.abs(values.reduce((a,b)=>a+b,0)-1)>=0.01||Number((v.category as Record<string,number>)[v.category_top])<Math.max(...KIM_CATEGORIES.map(k=>Number((v.category as Record<string,number>)[k])))-0.0002||Math.abs(v.category.unknown-v.unknown_prob)>0.0002)ctx.addIssue({code:'custom',message:'Unrepresentable category distribution'});
}).transform(v=>{
 return {category:v.category,category_top:v.category_top_all,unknown_prob:v.unknown_prob,sentiment:v.sentiment,sentiment_top:v.sentiment_top,
 importance:{dist:Object.values(v.importance_dist),expected:v.importance},urgency:{dist:Object.values(v.urgency_dist),expected:v.urgency},intensity:{dist:Object.values(v.sentiment_intensity_dist),expected:v.sentiment_intensity},needs_attention:v.needs_attention,has_todo:v.has_todo};
}).pipe(KIM_SCORES_SCHEMA)]);
