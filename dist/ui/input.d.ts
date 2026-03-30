import type { SkillMeta } from '../ai/skills/loader.js';
/** 向左找词边界（Ctrl+W / Alt+Left 用） */
export declare function wordBoundaryLeft(text: string, cursor: number): number;
/** 向右找词边界（Alt+Right 用） */
export declare function wordBoundaryRight(text: string, cursor: number): number;
export declare function getSlashCommands(skills: SkillMeta[]): Array<{
    cmd: string;
    desc: string;
}>;
export declare function truncateMenuDescription(desc: string, maxWidth: number): string;
export declare function getMenuClearSequence(lineCount: number): string;
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
