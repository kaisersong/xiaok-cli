import {z} from 'zod';
import type {KimConfigPatch,KimConfigView,KimHealthView,KimJudgment} from '../../src/shared/kim-decision.js';
// Transport DTOs stay platform-neutral and use Desktop's Zod package. Domain
// client validation additionally checks calibration sums and top-label agreement.
const p=z.number().finite().min(0).max(1);
const ordinal=z.object({dist:z.array(p).length(5),expected:z.number().finite().min(1).max(5)}).strict();
const calibratedOrdinal=ordinal.refine(v=>Math.abs(v.dist.reduce((a,b)=>a+b,0)-1)<0.01
  &&Math.abs(v.dist.reduce((a,b,i)=>a+b*(i+1),0)-v.expected)<0.03);
const category=z.object({'求助/提问':p,'任务/待办':p,'决策/结论':p,'信息分享':p,'讨论观点':p,'闲聊寒暄':p,'无关/其他':p}).strict();
const categoryLabels=['求助/提问','任务/待办','决策/结论','信息分享','讨论观点','闲聊寒暄','无关/其他'] as const;
const scoresV3=z.object({
  category,category_top:z.enum(categoryLabels),
  sentiment:z.object({'积极':p,'中性':p,'消极':p}).strict(),sentiment_top:z.enum(['积极','中性','消极']),
  importance:ordinal,urgency:ordinal,intensity:ordinal,needs_attention:p,has_todo:p,
}).strict();
const scoresV4=scoresV3.extend({
  scoreVersion:z.literal(4),category:category.extend({unknown:p}),category_top:z.enum([...categoryLabels,'unknown']),
  unknown_prob:p,importance:calibratedOrdinal,urgency:calibratedOrdinal,intensity:calibratedOrdinal,
}).refine(v=>Math.abs(Object.values(v.category).reduce((a,b)=>a+b,0)-1)<0.01
  &&Math.abs(Object.values(v.sentiment).reduce((a,b)=>a+b,0)-1)<0.01
  &&v.category[v.category_top]>=Math.max(...Object.values(v.category))-0.0002
  &&v.sentiment[v.sentiment_top]>=Math.max(...Object.values(v.sentiment))-0.0002
  &&Math.abs(v.category.unknown-v.unknown_prob)<0.0002);
const scores=z.union([scoresV3,scoresV4]);
export const KIM_CONFIG_PATCH_SCHEMA:z.ZodType<KimConfigPatch>=z.object({enabled:z.boolean().optional(),baseUrl:z.string().max(200).optional(),attentionThreshold:z.number().finite().min(0.05).max(0.99).optional()}).strict();
export const KIM_CONFIG_VIEW_SCHEMA:z.ZodType<KimConfigView>=z.object({enabled:z.boolean(),baseUrl:z.string(),attentionThreshold:z.number().finite().min(0.05).max(0.99)}).strict();
export const KIM_HEALTH_VIEW_SCHEMA:z.ZodType<KimHealthView>=z.object({available:z.boolean(),model:z.literal('Songkai/K-IM-Deiction'),engine:z.string().max(30).optional(),latencyMs:z.number().finite().nonnegative().optional(),errorCode:z.string().max(80).optional()}).strict();
export const KIM_JUDGMENT_SCHEMA:z.ZodType<KimJudgment>=z.object({model:z.literal('Songkai/K-IM-Deiction'),scores,evaluatedAt:z.number().finite().nonnegative()}).strict();
export type {KimConfigPatch,KimConfigView,KimHealthView};
