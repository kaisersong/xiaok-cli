import { z } from 'zod';
// Preserve Unicode and interior spaces/namespace punctuation; do not silently coerce.
// A registry name is one argv operand, not a filesystem path or CLI option.
export const SKILL_MUTATION_NAME_SCHEMA = z.string().min(1).max(512).refine(name =>
  name === name.trim() && !name.startsWith('-') && name !== '.' && name !== '..'
  && !/[\\/\x00-\x1f\x7f]/.test(name) && !/^[A-Za-z]:/.test(name));
export const SKILL_MUTATION_INPUT_SCHEMA = z.tuple([SKILL_MUTATION_NAME_SCHEMA]);
export const SKILL_MUTATION_OUTPUT_SCHEMA = z.object({
  success: z.boolean(), message: z.string(),
}).passthrough();
export type DesktopSkillMutationResult = z.infer<typeof SKILL_MUTATION_OUTPUT_SCHEMA>;
export interface DesktopSkillMutationContext { requestSource: 'user' | 'agent' | 'scheduler' }
