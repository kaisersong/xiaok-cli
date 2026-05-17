import type { TaskSkillHints, TaskSkillMatch } from './types.js';
type TaskSkill = {
    name: string;
    description: string;
    whenToUse?: string;
    taskHints: TaskSkillHints;
};
export declare function matchSkillsForTask(query: string, skills: TaskSkill[], limit?: number): TaskSkillMatch[];
export {};
