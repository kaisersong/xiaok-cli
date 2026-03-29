import type { SkillMeta } from '../ai/skills/loader.js';
export declare function getSlashCommands(skills: SkillMeta[]): Array<{
    cmd: string;
    desc: string;
}>;
export declare class InputReader {
    private history;
    private historyIdx;
    private menuOpen;
    private menuItems;
    private menuIdx;
    private skills;
    setSkills(skills: SkillMeta[]): void;
    read(prompt: string): Promise<string | null>;
}
