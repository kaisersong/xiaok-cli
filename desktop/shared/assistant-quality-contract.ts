import {z} from 'zod';
const count=z.number().int().min(0).max(10000);
export const ASSISTANT_QUALITY_STATUS_SCHEMA=z.object({
 state:z.enum(['not_evaluated','review_required','passed','failed','stale','unavailable']),
 populationCount:count,sampleCount:count,needsAction:count,seriousMisses:count,
 precision:z.number().min(0).max(1).nullable(),recall:z.number().min(0).max(1).nullable(),unknownRate:z.number().min(0).max(1).nullable(),
 reason:z.enum(['source_unavailable','insufficient_cases','provider_unavailable','labels_required','binding_changed','quality_failed']).nullable(),
}).strict();
export type AssistantQualityStatus=z.infer<typeof ASSISTANT_QUALITY_STATUS_SCHEMA>;
export const ASSISTANT_QUALITY_IMPORT_SCHEMA=z.object({attestHumanReview:z.literal(true)}).strict();
export const ASSISTANT_QUALITY_RESULT_SCHEMA=z.object({cancelled:z.boolean(),status:ASSISTANT_QUALITY_STATUS_SCHEMA}).strict();
