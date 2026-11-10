import {z} from 'zod';
const revision=z.number().nonnegative().refine(Number.isSafeInteger);
export const ASSISTANT_CALENDAR_MEMORY_SCHEMA=z.object({enabled:z.boolean(),revision}).strict();
export const ASSISTANT_CALENDAR_MEMORY_INPUT_SCHEMA=z.object({enabled:z.boolean(),expectedRevision:revision.refine(value=>value<Number.MAX_SAFE_INTEGER)}).strict();
export type AssistantCalendarMemorySettingsDto=z.infer<typeof ASSISTANT_CALENDAR_MEMORY_SCHEMA>;
export type AssistantCalendarMemoryInput=z.infer<typeof ASSISTANT_CALENDAR_MEMORY_INPUT_SCHEMA>;
