import type { Tool } from '../../types.js';
import type { SkillCatalog, SkillMeta } from './loader.js';
export declare function formatSkillPayload(skill: SkillMeta): string;
export declare function createSkillTool(skills: SkillMeta[] | SkillCatalog): Tool;
