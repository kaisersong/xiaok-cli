import type { DevAppIdentity } from '../../auth/identity.js';
import type { ToolDefinition } from '../../types.js';
import type { CustomAgentDef } from '../agents/loader.js';
import type { SkillMeta } from '../skills/loader.js';
interface ContextOptions {
    enterpriseId: string | null;
    devApp: DevAppIdentity | null;
    cwd: string;
    budget: number;
    skills?: SkillMeta[];
    deferredTools?: Array<Pick<ToolDefinition, 'name' | 'description'>>;
    agents?: Array<Pick<CustomAgentDef, 'name' | 'model' | 'allowedTools'>>;
}
export declare function buildSystemPrompt(opts: ContextOptions): Promise<string>;
export {};
