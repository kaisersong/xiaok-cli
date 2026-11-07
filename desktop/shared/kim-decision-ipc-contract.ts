import {z} from 'zod';
import type {KimConfigPatch,KimConfigView,KimHealthView,KimJudgment} from '../../src/shared/kim-decision.js';
// Transport DTOs stay platform-neutral and use Desktop's Zod package. Domain
// client validation additionally checks calibration sums and top-label agreement.
const p=z.number().finite().min(0).max(1);
const ordinal=z.object({dist:z.array(p).length(5),expected:z.number().finite().min(1).max(5)}).strict();
const scores=z.object({category:z.object({'求助/提问':p,'任务/待办':p,'决策/结论':p,'信息分享':p,'讨论观点':p,'闲聊寒暄':p,'无关/其他':p}).strict(),category_top:z.enum(['求助/提问','任务/待办','决策/结论','信息分享','讨论观点','闲聊寒暄','无关/其他']),sentiment:z.object({'积极':p,'中性':p,'消极':p}).strict(),sentiment_top:z.enum(['积极','中性','消极']),importance:ordinal,urgency:ordinal,intensity:ordinal,needs_attention:p,has_todo:p}).strict();
export const KIM_CONFIG_PATCH_SCHEMA:z.ZodType<KimConfigPatch>=z.object({enabled:z.boolean().optional(),baseUrl:z.string().max(200).optional(),attentionThreshold:z.number().finite().min(0.05).max(0.99).optional()}).strict();
export const KIM_CONFIG_VIEW_SCHEMA:z.ZodType<KimConfigView>=z.object({enabled:z.boolean(),baseUrl:z.string(),attentionThreshold:z.number().finite().min(0.05).max(0.99)}).strict();
export const KIM_HEALTH_VIEW_SCHEMA:z.ZodType<KimHealthView>=z.object({available:z.boolean(),model:z.literal('Songkai/K-IM-Deiction'),engine:z.string().max(30).optional(),latencyMs:z.number().finite().nonnegative().optional(),errorCode:z.string().max(80).optional()}).strict();
export const KIM_JUDGMENT_SCHEMA:z.ZodType<KimJudgment>=z.object({model:z.literal('Songkai/K-IM-Deiction'),scores,evaluatedAt:z.number().finite().nonnegative()}).strict();
export type {KimConfigPatch,KimConfigView,KimHealthView};
