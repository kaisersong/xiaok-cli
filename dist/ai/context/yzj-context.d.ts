import type { DevAppIdentity } from '../../auth/identity.js';
import type { SkillMeta } from '../skills/loader.js';
interface ContextOptions {
    enterpriseId: string | null;
    devApp: DevAppIdentity | null;
    cwd: string;
    budget: number;
    skills?: SkillMeta[];
}
export declare function buildSystemPrompt(opts: ContextOptions): Promise<string>;
export {};
