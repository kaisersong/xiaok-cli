import {z} from 'zod/v3';
export const KIM_MODEL='Songkai/K-IM-Deiction';
export const KIM_CATEGORIES=['求助/提问','任务/待办','决策/结论','信息分享','讨论观点','闲聊寒暄','无关/其他'] as const;
export const KIM_SENTIMENTS=['积极','中性','消极'] as const;
const probability=z.number().finite().min(0).max(1);
const distribution=<T extends readonly [string,...string[]]>(names:T)=>z.object(Object.fromEntries(names.map(n=>[n,probability])) as Record<T[number],typeof probability>).strict().refine(d=>Math.abs(Object.values(d).reduce<number>((a,b)=>a+Number(b),0)-1)<0.01);
const ordinal=z.object({dist:z.array(probability).length(5),expected:z.number().finite().min(1).max(5)}).strict().refine(v=>Math.abs(v.dist.reduce((a,b)=>a+b,0)-1)<0.01&&Math.abs(v.dist.reduce((a,b,i)=>a+b*(i+1),0)-v.expected)<0.03);
export interface KimScores {category:Record<typeof KIM_CATEGORIES[number],number>;category_top:typeof KIM_CATEGORIES[number];sentiment:Record<typeof KIM_SENTIMENTS[number],number>;sentiment_top:typeof KIM_SENTIMENTS[number];importance:{dist:number[];expected:number};urgency:{dist:number[];expected:number};intensity:{dist:number[];expected:number};needs_attention:number;has_todo:number}
export const KIM_SCORES_SCHEMA:z.ZodType<KimScores>=z.object({category:distribution(KIM_CATEGORIES),category_top:z.enum(KIM_CATEGORIES),sentiment:distribution(KIM_SENTIMENTS),sentiment_top:z.enum(KIM_SENTIMENTS),importance:ordinal,urgency:ordinal,intensity:ordinal,needs_attention:probability,has_todo:probability}).strict().refine(v=>v.category[v.category_top]>=Math.max(...Object.values(v.category))-0.0002&&v.sentiment[v.sentiment_top]>=Math.max(...Object.values(v.sentiment))-0.0002);

export interface KimJudgment {model:typeof KIM_MODEL;scores:KimScores;evaluatedAt:number}
export const KIM_JUDGMENT_SCHEMA:z.ZodType<KimJudgment>=z.object({model:z.literal(KIM_MODEL),scores:KIM_SCORES_SCHEMA,evaluatedAt:z.number().finite().nonnegative()}).strict();

const message=z.object({sender:z.string().max(256),text:z.string().min(1).max(10000),sentAt:z.number().finite().nonnegative().optional(),id:z.string().max(256).optional()}).strict();
export const KIM_WINDOW_SCHEMA=z.object({group:z.string().max(200),target:message,context:z.array(message).max(100).optional()}).strict();
export type KimWindow=z.infer<typeof KIM_WINDOW_SCHEMA>;
export const KIM_CONFIG_PATCH_SCHEMA=z.object({enabled:z.boolean().optional(),baseUrl:z.string().max(200).optional(),attentionThreshold:z.number().finite().min(0.05).max(0.99).optional()}).strict();
export const KIM_CONFIG_VIEW_SCHEMA=z.object({enabled:z.boolean(),baseUrl:z.string(),attentionThreshold:z.number().finite().min(0.05).max(0.99)}).strict();
export const KIM_HEALTH_VIEW_SCHEMA=z.object({available:z.boolean(),model:z.literal(KIM_MODEL),engine:z.string().max(30).optional(),latencyMs:z.number().finite().nonnegative().optional(),errorCode:z.string().max(80).optional()}).strict();
export type KimConfigPatch=z.infer<typeof KIM_CONFIG_PATCH_SCHEMA>;
export type KimConfigView=z.infer<typeof KIM_CONFIG_VIEW_SCHEMA>;

export type KimHealthView=z.infer<typeof KIM_HEALTH_VIEW_SCHEMA>;
