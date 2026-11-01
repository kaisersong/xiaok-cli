import {z} from 'zod';
export const ASSISTANT_CALENDAR_MEMORY_SCHEMA=z.object({enabled:z.boolean(),revision:z.number().int().nonnegative()}).strict();
export const ASSISTANT_CALENDAR_MEMORY_INPUT_SCHEMA=z.object({enabled:z.boolean(),expectedRevision:z.number().int().nonnegative()}).strict();
export type AssistantCalendarMemorySettingsDto=z.infer<typeof ASSISTANT_CALENDAR_MEMORY_SCHEMA>;
export type AssistantCalendarMemoryInput=z.infer<typeof ASSISTANT_CALENDAR_MEMORY_INPUT_SCHEMA>;
