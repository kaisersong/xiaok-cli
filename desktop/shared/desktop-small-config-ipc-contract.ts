import { z } from 'zod';
export const SKILL_DEBUG_CONFIG_SCHEMA = z.object({ enabled: z.boolean() }).strict();
export const KSWARM_CONCURRENCY_CONFIG_SCHEMA = z.object({ maxConcurrentTasks: z.number().finite() }).strict();
export const SMALL_CONFIG_INPUT_SCHEMAS = Object.freeze({
  getSkillDebugConfig: z.tuple([]), saveSkillDebugConfig: z.tuple([SKILL_DEBUG_CONFIG_SCHEMA]),
  getKswarmConfig: z.tuple([]), saveKswarmConfig: z.tuple([KSWARM_CONCURRENCY_CONFIG_SCHEMA]),
});
export const SMALL_CONFIG_OUTPUT_SCHEMAS = Object.freeze({
  getSkillDebugConfig: SKILL_DEBUG_CONFIG_SCHEMA, saveSkillDebugConfig: SKILL_DEBUG_CONFIG_SCHEMA,
  getKswarmConfig: KSWARM_CONCURRENCY_CONFIG_SCHEMA, saveKswarmConfig: KSWARM_CONCURRENCY_CONFIG_SCHEMA,
});
export type DesktopSmallConfigMethod = keyof typeof SMALL_CONFIG_INPUT_SCHEMAS;
