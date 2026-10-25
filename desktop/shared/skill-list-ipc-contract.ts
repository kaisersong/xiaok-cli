import { z } from 'zod';
export const SKILL_LIST_INPUT_SCHEMA = z.tuple([]);
export const SKILL_LIST_OUTPUT_SCHEMA = z.array(z.object({
  name: z.string(), aliases: z.array(z.string()), description: z.string(), source: z.string(), tier: z.string(),
}).passthrough());
export type SkillListDto = z.infer<typeof SKILL_LIST_OUTPUT_SCHEMA>;
