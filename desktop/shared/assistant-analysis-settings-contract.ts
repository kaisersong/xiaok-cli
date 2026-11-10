import {z} from 'zod';
export const ASSISTANT_ANALYSIS_SETTINGS_SCHEMA=z.object({modelId:z.string().min(1).max(256),expectedRevision:z.number().int().nonnegative()}).strict();
export const ASSISTANT_ANALYSIS_STATUS_SCHEMA=z.object({revision:z.number().int().nonnegative(),selectedModelId:z.string().max(256).nullable(),models:z.array(z.object({modelId:z.string().min(1).max(256),label:z.string().max(200)}).strict()).max(50),state:z.enum(['not_configured','preparing','ready','unavailable']),reason:z.enum(['unsupported_model','resources_unavailable','config_changed','platform_unavailable']).nullable()}).strict();
export type AssistantAnalysisStatus=z.infer<typeof ASSISTANT_ANALYSIS_STATUS_SCHEMA>;
export type AssistantAnalysisSettingsInput=z.infer<typeof ASSISTANT_ANALYSIS_SETTINGS_SCHEMA>;
